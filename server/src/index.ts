// Millennium Arena server: card data API, duel WebSocket, and (in production) the built browser app,
// all under one path prefix so it sits behind nginx like the other sites (e.g. /millennium).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, Side } from '@arena/shared';
import { clientCardList, loadCards } from './cards.ts';
import { BASE, CLIENT_DIST, ENGINE_NAME, MAX_DUELS, PORT } from './config.ts';
import { loadDecks, summarise } from './decks.ts';
import { DuelRoom, type Viewer } from './duel/room.ts';

const t0 = performance.now();
const cards = loadCards();
const cardList = clientCardList(cards);
const decks = loadDecks(cards);
const rooms = new Set<DuelRoom>();
console.log(`${cards.size} cards, ${decks.size} decks, engine ${ENGINE_NAME} (${(performance.now() - t0).toFixed(0)} ms)`);

// ---------- HTTP ----------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon',
};
const json = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

function serveClient(req: IncomingMessage, res: ServerResponse, rel: string) {
  if (!existsSync(CLIENT_DIST)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('The browser app isn\'t built. In development use `npm run dev`; for production run `npm run build`.'); return; }
  let file = path.join(CLIENT_DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(CLIENT_DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(CLIENT_DIST, 'index.html');   // app routes
  const hashed = /[-.][A-Za-z0-9_]{8,}\.(js|css)$/.test(file);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(BASE)) { res.writeHead(302, { location: BASE + '/' }); res.end(); return; }
  const rel = url.pathname.slice(BASE.length) || '/';
  if (rel === '/api/health') return json(res, { ok: true, duels: rooms.size, maxDuels: MAX_DUELS, engine: ENGINE_NAME });
  if (rel === '/api/cards') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600', etag: `"${ENGINE_NAME}-${cards.size}"` });
    res.end(cardList); return;
  }
  if (rel === '/api/decks') return json(res, [...decks.values()].map(summarise));
  if (rel.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
  serveClient(req, res, rel);
});

// ---------- WebSocket: one connection per browser tab ----------
const wss = new WebSocketServer({ server, path: `${BASE}/ws`, maxPayload: 64 * 1024 });
wss.on('connection', (ws: WebSocket) => {
  let room: DuelRoom | null = null;
  const viewer: Viewer = { side: null, send: (msg: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } };
  const leave = () => { room?.leave(viewer); room = null; viewer.side = null; };
  const full = () => rooms.size >= MAX_DUELS && (viewer.send({ type: 'error', message: 'The server is running as many duels as it can right now. Try again in a minute.' }), true);

  ws.on('message', raw => {
    let msg: ClientMessage;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'listDecks') viewer.send({ type: 'decks', decks: [...decks.values()].map(summarise) });
    else if (msg.type === 'watch') {
      leave();
      const pair = msg.decks.map(id => decks.get(id));
      if (!pair[0] || !pair[1]) return viewer.send({ type: 'error', message: 'Unknown deck.' });
      if (full()) return;
      const mirror = pair[0].id === pair[1].id;
      const r = new DuelRoom([pair[0], pair[1]], mirror ? ['Bot A', 'Bot B'] : [`Bot (${pair[0].name})`, `Bot (${pair[1].name})`], [],
        msg.fullView ?? true, msg.seed ?? Math.floor(Math.random() * 1e9), () => rooms.delete(r));
      rooms.add(r);
      room = r;
      r.join(viewer);
    } else if (msg.type === 'play') {
      leave();
      const mine = decks.get(msg.deck), bot = decks.get(msg.botDeck);
      if (!mine || !bot) return viewer.send({ type: 'error', message: 'Unknown deck.' });
      if (full()) return;
      const name = String(msg.name ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16) || 'Duelist';
      const side: Side = msg.first === 'me' ? 0 : msg.first === 'bot' ? 1 : (Math.random() < 0.5 ? 0 : 1);   // side 0 goes first
      const r = new DuelRoom(side === 0 ? [mine, bot] : [bot, mine], side === 0 ? [name, 'Bot'] : ['Bot', name], [side],
        false, msg.seed ?? Math.floor(Math.random() * 1e9), () => rooms.delete(r));
      rooms.add(r);
      room = r;
      viewer.side = side;
      r.join(viewer);
    } else if (msg.type === 'answer') room?.answer(viewer, msg.id, msg.answer);
    else if (msg.type === 'leave') leave();
  });
  ws.on('close', leave);
});

server.listen(PORT, () => console.log(`Millennium Arena on http://localhost:${PORT}${BASE}/  (WebSocket ${BASE}/ws)`));
