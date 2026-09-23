import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { fetchNYCRoadSpeeds, fetchOpenSkyAircraft, aisStreamSubscription, parseAISStreamPosition } from '../../lib/traffic/TrafficSources.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const bounds = [40.52, -74.25, 40.94, -73.68];
const ships = new Map();
const cache = { at: 0, roads: [], aircraft: [], errors: {} };
const port = Number(process.env.PORT || 4173);
const boundedFetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
let pending;
let token;
let tokenExpires = 0;

async function openSkyToken() {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return undefined;
  if (token && Date.now() < tokenExpires) return token;
  const response = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  if (!response.ok) throw new Error(`OpenSky token request failed: ${response.status}`);
  const data = await response.json();
  token = data.access_token;
  tokenExpires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
  return token;
}

async function refresh() {
  if (Date.now() - cache.at < 60_000) return;
  if (pending) return pending;
  pending = (async () => {
    const [roads, aircraft] = await Promise.allSettled([
      fetchNYCRoadSpeeds(boundedFetch),
      openSkyToken().then(auth => fetchOpenSkyAircraft(bounds, boundedFetch, auth)),
    ]);
    cache.errors = {};
    if (roads.status === 'fulfilled') cache.roads = roads.value;
    else cache.errors.roads = String(roads.reason);
    if (aircraft.status === 'fulfilled') cache.aircraft = aircraft.value;
    else cache.errors.aircraft = String(aircraft.reason);
    cache.at = Date.now();
  })().finally(() => { pending = undefined; });
  return pending;
}

function connectAIS() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return;
  const socket = new WebSocket('wss://stream.aisstream.io/v0/stream', { perMessageDeflate: true });
  socket.on('open', () => socket.send(JSON.stringify(aisStreamSubscription(key, bounds))));
  socket.on('message', data => {
    try {
      const vessel = parseAISStreamPosition(JSON.parse(data.toString()));
      if (vessel) ships.set(vessel.id, vessel);
    } catch (error) { console.warn('Invalid AIS message:', error); }
  });
  socket.on('error', error => console.warn('AISStream:', error.message));
  socket.on('close', () => setTimeout(connectAIS, 5_000));
}
connectAIS();

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://localhost:${port}`).pathname;
  if (pathname === '/api/traffic') {
    await refresh();
    const now = Date.now();
    for (const [id, ship] of ships) if (now - ship.observedAt > 10 * 60_000) ships.delete(id);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify({ roads: cache.roads, aircraft: cache.aircraft, ships: [...ships.values()], errors: cache.errors,
      sources: { roads: 'NYC DOT', aircraft: 'OpenSky', ships: process.env.AISSTREAM_API_KEY ? 'AISStream' : 'AISStream key required' },
      updatedAt: cache.at }));
    return;
  }
  const file = pathname === '/' ? 'index.html' : /^\/[\w.-]+\.app\.js$/.test(pathname) || pathname === '/app.js' ? `dist${pathname}` : null;
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    const contents = await readFile(join(root, file));
    response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    response.end(contents);
  } catch { response.writeHead(404); response.end('Run npm run build first.'); }
});
server.listen(port, () => console.log(`Traffic demo: http://localhost:${port}`));
