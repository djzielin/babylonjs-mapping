import { aisStreamSubscription, parseAISStreamPosition } from '../../lib/traffic/TrafficSources.js';

export function createAISStream({ apiKey, bounds, createSocket, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  const ships = new Map();
  let socket;
  let retryTimer;
  let retryMs = 5_000;
  let stopped = false;
  let failed = false;
  let status = apiKey ? 'AISStream connecting…' : undefined;

  function fail(message) {
    failed = true;
    status = message;
  }

  function accepted() {
    failed = false;
    status = undefined;
    retryMs = 5_000;
  }

  function retry() {
    if (stopped || retryTimer !== undefined) return;
    retryTimer = schedule(() => {
      retryTimer = undefined;
      connect();
    }, retryMs);
    retryMs = Math.min(60_000, retryMs * 2);
  }

  function connect() {
    if (stopped || !apiKey) return;
    let connection;
    try {
      connection = createSocket();
    } catch {
      fail('AISStream connection failed; retrying.');
      retry();
      return;
    }
    socket = connection;
    const current = () => !stopped && socket === connection;
    connection.on('open', () => {
      if (!current()) return;
      // A WebSocket opening does not confirm that AISStream accepted the key.
      if (!failed) status = 'AISStream awaiting subscription confirmation…';
      try {
        connection.send(JSON.stringify(aisStreamSubscription(apiKey, bounds)));
      } catch {
        fail('AISStream subscription could not be sent; retrying.');
        connection.terminate();
      }
    });
    connection.on('message', data => {
      if (!current()) return;
      try {
        const message = JSON.parse(data.toString());
        if (message && typeof message === 'object' && ('error' in message || 'Error' in message || message.MessageType === 'Error')) {
          // Never echo provider payloads: they may include the subscription key.
          fail('AISStream rejected the subscription; check the API key and connection limits.');
          connection.terminate();
          return;
        }
        if (message?.MessageType === 'SubscriptionConfirmation') accepted();
        const vessel = parseAISStreamPosition(message, now());
        if (vessel) {
          accepted();
          ships.set(vessel.id, vessel);
        }
      } catch {
        fail('AISStream sent an invalid message.');
      }
    });
    connection.on('error', () => {
      if (current()) fail('AISStream connection failed; retrying.');
    });
    connection.on('close', () => {
      if (!current()) return;
      socket = undefined;
      if (!failed) fail('AISStream disconnected; retrying.');
      retry();
    });
  }

  connect();
  return {
    snapshot() {
      for (const [id, ship] of ships) if (now() - ship.observedAt > 10 * 60_000) ships.delete(id);
      return {
        ships: [...ships.values()],
        errors: status ? { ships: status } : {},
        sources: { ships: apiKey ? 'AISStream' : 'AISStream key required' },
      };
    },
    stop() {
      stopped = true;
      if (retryTimer !== undefined) cancel(retryTimer);
      socket?.terminate();
      socket = undefined;
    },
  };
}
