import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAISStream } from '../examples-local/live-traffic/ais-stream.mjs';

class FixtureSocket extends EventEmitter {
  send = vi.fn();
  terminate = vi.fn(() => this.emit('close'));
  message(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}

const bounds = [40.52, -74.25, 40.94, -73.68];
const position = {
  MessageType: 'PositionReport',
  MetaData: { MMSI: 123456789, ShipName: 'FIXTURE VESSEL', Latitude: 40.7, Longitude: -74 },
  Message: { PositionReport: { Sog: 12, Cog: 90 } },
};
const clients = [];

function fixture(apiKey = 'fixture-only-key') {
  vi.useFakeTimers();
  const sockets = [];
  const createSocket = vi.fn(() => {
    const socket = new FixtureSocket();
    sockets.push(socket);
    return socket;
  });
  const client = createAISStream({ apiKey, bounds, createSocket });
  clients.push(client);
  return { client, createSocket, sockets };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
  vi.useRealTimers();
});

describe('AISStream proxy status (fixture sockets, no live reception)', () => {
  it('labels a missing key without connecting', () => {
    const { client, createSocket } = fixture('');
    expect(createSocket).not.toHaveBeenCalled();
    expect(client.snapshot()).toEqual({ ships: [], errors: {}, sources: { ships: 'AISStream key required' } });
  });

  it('does not report live data until the subscription is accepted', () => {
    const { client, sockets } = fixture();
    expect(client.snapshot().errors.ships).toContain('connecting');
    sockets[0].emit('open');
    expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toMatchObject({ APIKey: 'fixture-only-key' });
    expect(client.snapshot().errors.ships).toContain('awaiting subscription confirmation');
    sockets[0].message({ MessageType: 'SubscriptionConfirmation', Message: { CompressionEnabled: true } });
    expect(client.snapshot().errors).toEqual({});
    expect(client.snapshot().ships).toEqual([]);
  });

  it('exposes transport failures and preserves them until recovery', () => {
    const { client, sockets } = fixture();
    sockets[0].emit('error', new Error('fixture-only-key must not be exposed'));
    sockets[0].emit('close');
    expect(client.snapshot().errors.ships).toBe('AISStream connection failed; retrying.');
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(2);
    sockets[1].emit('open');
    expect(client.snapshot().errors.ships).toContain('connection failed');
    sockets[1].message(position);
    expect(client.snapshot().errors).toEqual({});
    expect(client.snapshot().ships).toHaveLength(1);
    expect(JSON.stringify(client.snapshot())).not.toContain('fixture-only-key');
  });

  it.each([
    { error: 'API Key Is Invalid: fixture-only-key' },
    { Error: 'Invalid subscription' },
    { MessageType: 'Error', Message: 'Connection limit exceeded' },
  ])('exposes subscription rejection without echoing the provider payload: %j', envelope => {
    const { client, sockets } = fixture();
    sockets[0].emit('open');
    sockets[0].message(envelope);
    expect(client.snapshot().errors.ships).toBe('AISStream rejected the subscription; check the API key and connection limits.');
    expect(client.snapshot().ships).toEqual([]);
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
    expect(JSON.stringify(client.snapshot())).not.toContain('fixture-only-key');
    vi.advanceTimersByTime(5_000);
    sockets[1].emit('open');
    expect(client.snapshot().errors.ships).toContain('rejected');
  });

  it('backs off across rejected connections, resetting only after an accepted subscription', () => {
    const { client, sockets } = fixture();
    sockets[0].emit('open');
    sockets[0].message({ error: 'Invalid key' });
    vi.advanceTimersByTime(5_000);
    sockets[1].emit('open');
    sockets[1].message({ error: 'Invalid key' });
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(3);
    sockets[2].emit('open');
    sockets[2].message({ MessageType: 'SubscriptionConfirmation' });
    sockets[2].emit('close');
    expect(client.snapshot().errors.ships).toBe('AISStream disconnected; retrying.');
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(4);
  });

  it('ignores delayed messages and errors from a closed socket', () => {
    const { client, sockets } = fixture();
    sockets[0].emit('close');
    vi.advanceTimersByTime(5_000);
    sockets[1].message({ MessageType: 'SubscriptionConfirmation' });
    sockets[0].message(position);
    sockets[0].message({ error: 'Old failure' });
    sockets[0].emit('error', new Error('Old transport failure'));
    expect(client.snapshot().errors).toEqual({});
    expect(client.snapshot().ships).toEqual([]);
  });

  it('reports malformed messages and recovers on a valid position, expiring stale ships', () => {
    const { client, sockets } = fixture();
    sockets[0].emit('message', Buffer.from('{invalid JSON'));
    expect(client.snapshot().errors.ships).toBe('AISStream sent an invalid message.');
    sockets[0].message(position);
    expect(client.snapshot().errors).toEqual({});
    expect(client.snapshot().ships).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(client.snapshot().ships).toEqual([]);
  });

  it('reports send failures and stops pending retries on shutdown', () => {
    const { client, sockets } = fixture();
    sockets[0].send.mockImplementation(() => { throw new Error('Send failed'); });
    sockets[0].emit('open');
    expect(client.snapshot().errors.ships).toBe('AISStream subscription could not be sent; retrying.');
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});
