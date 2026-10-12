// Millennium Arena server: card data API, duel WebSocket, and (in production) the built browser app,
// all under one path prefix so it sits behind nginx like the other sites (e.g. /millennium).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, Side, Speed } from '@arena/shared';
import { sessionUser } from './auth/accounts.ts';
import { MAIL_READY } from './auth/mailer.ts';
import { accountRoutes, cookies, sameOrigin } from './auth/routes.ts';
import { AUTH_READY } from './auth/security.ts';
import { blocksPlay, deckProblems } from '@arena/shared/decks';
import { loadBanlist } from './banlist.ts';
import { clientCardList, loadCards, ruleCards } from './cards.ts';
import { accountDeck, accountDecks, activeDeck } from './decks-api.ts';
import { BASE, CLIENT_DIST, DEV, ENGINE_NAME, MAX_DUELS, PORT } from './config.ts';
import { loadDecks, summarise, type Deck } from './decks.ts';
import { DB_ENABLED, migrate } from './db/index.ts';
import { DuelRoom, type Viewer } from './duel/room.ts';
import { SCENARIOS, firstFor, luaFor, setupFor } from './duel/scenarios.ts';

const t0 = performance.now();
const cards = loadCards();
const cardList = clientCardList(cards);
const cardListTag = `"${createHash('sha1').update(cardList).digest('base64url').slice(0, 16)}"`;   // changes whenever the list does
const decks = loadDecks(cards);
const banlist = loadBanlist();
const banlistJson = JSON.stringify(banlist);
const ruleCard = ruleCards(cards);
const rooms = new Map<string, DuelRoom>();
const SPEEDS = new Set<Speed>(['slow', 'normal', 'fast', 'instant']);
const speedOf = (s: unknown): Speed => (SPEEDS.has(s as Speed) ? (s as Speed) : 'normal');
const TIMERS = new Set([0, 60, 90, 180]);
console.log(`${cards.size} cards, ${decks.size} decks, banlist ${banlist?.name ?? 'none'}, engine ${ENGINE_NAME} (${(performance.now() - t0).toFixed(0)} ms)`);

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

/** Headers on every response: no sniffing, no framing, a strict content policy for the app's pages. */
function securityHeaders(req: IncomingMessage, res: ServerResponse) {
  const host = String(req.headers.host ?? '').replace(/[^\w.:-]/g, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://images.ygoprodeck.com", `connect-src 'self' wss://${host} ws://${host}`, "frame-ancestors 'none'", "base-uri 'self'",
    "form-action 'self'", "object-src 'none'",
  ].join('; '));
}

const server = createServer(async (req, res) => {
  securityHeaders(req, res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(BASE)) { res.writeHead(302, { location: BASE + '/' }); res.end(); return; }
  const rel = url.pathname.slice(BASE.length) || '/';
  if (rel === '/api/health') return json(res, { ok: true, duels: rooms.size, maxDuels: MAX_DUELS, engine: ENGINE_NAME });
  if (rel === '/api/cards') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600', etag: cardListTag });
    res.end(cardList); return;
  }
  if (rel === '/api/decks') return json(res, [...decks.values()].map(summarise));
  if (rel === '/api/banlist') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' }); res.end(banlistJson); return; }
  if (DB_ENABLED && await accountRoutes(req, res, rel)) return;
  if (rel.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
  serveClient(req, res, rel);
});

/** One of your own decks, ready to duel with, or the reason it can't be used. */
async function ownDeck(userId: string | undefined, id: string): Promise<Deck | string | undefined> {
  if (!userId) return undefined;
  const d = await accountDeck(userId, id);
  if (!d) return undefined;
  const stop = deckProblems(d, ruleCard, banlist).find(blocksPlay);
  if (stop) return `${d.name} can't be used yet: ${stop.text[0].toLowerCase()}${stop.text.slice(1)}.`;
  return { id: `acct:${d.id}`, name: d.name, main: d.main, extra: d.extra, source: 'account' };
}

// ---------- WebSocket: one connection per browser tab ----------
// only pages from this site may connect (stops other sites opening a connection with a visitor's login cookie)
const wss = new WebSocketServer({ server, path: `${BASE}/ws`, maxPayload: 64 * 1024, verifyClient: ({ req }: { req: IncomingMessage }) => sameOrigin(req) });
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // who's connected (if logged in); messages wait for this
  const who = DB_ENABLED ? sessionUser(cookies(req).ma_session).catch(() => null) : Promise.resolve(null);
  let room: DuelRoom | null = null;
  const viewer: Viewer = { side: null, send: (msg: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } };
  const leave = (dropped = false) => { room?.leave(viewer, dropped); room = null; viewer.side = null; };
  const full = () => rooms.size >= MAX_DUELS && (viewer.send({ type: 'error', message: 'The server is running as many duels as it can right now. Try again in a minute.' }), true);

  ws.on('message', async raw => {
    let msg: ClientMessage;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const me = await who;
    if (msg.type === 'listDecks') {
      // logged in: your own decks first (from the Decks page), then ours and the tournament decks
      const own = me?.username ? (await accountDecks(me.id)).map(d => {
        const problems = deckProblems(d, ruleCard, banlist);
        return { id: `acct:${d.id}`, name: d.name, main: d.main.length, extra: d.extra.length, source: 'account' as const, legal: !problems.length, playable: !problems.some(blocksPlay) };
      }) : [];
      const active = me?.username ? await activeDeck(me.id) : null;
      viewer.send({ type: 'decks', decks: [...own, ...[...decks.values()].map(summarise)], active: active && `acct:${active}`,
        ...(DEV ? { scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, name: s.name })) } : {}) });
    }
    else if (msg.type === 'watch') {
      leave();
      const pair = msg.decks.map(id => decks.get(id));
      if (!pair[0] || !pair[1]) return viewer.send({ type: 'error', message: 'Unknown deck.' });
      if (full()) return;
      const mirror = pair[0].id === pair[1].id;
      const r = new DuelRoom([pair[0], pair[1]], mirror ? ['Bot A', 'Bot B'] : [`Bot (${pair[0].name})`, `Bot (${pair[1].name})`], [],
        msg.fullView ?? true, msg.seed ?? Math.floor(Math.random() * 1e9), () => rooms.delete(r.id), { speed: speedOf(msg.speed) });
      rooms.set(r.id, r);
      room = r;
      r.join(viewer);
    } else if (msg.type === 'play') {
      leave();
      const mine = String(msg.deck).startsWith('acct:') ? await ownDeck(me?.id, String(msg.deck).slice(5)) : decks.get(msg.deck), bot = decks.get(msg.botDeck);
      if (typeof mine === 'string') return viewer.send({ type: 'error', message: mine });
      if (!mine || !bot) return viewer.send({ type: 'error', message: 'Unknown deck.' });
      if (full()) return;
      // logged in: your username; otherwise the name typed in the lobby (cleaned up)
      const name = me?.username ?? (String(msg.name ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16) || 'Duelist');
      const first = (DEV && firstFor(msg.scenario)) || msg.first;
      const side: Side = first === 'me' || first === 'you' ? 0 : first === 'bot' ? 1 : (Math.random() < 0.5 ? 0 : 1);   // side 0 goes first
      const r = new DuelRoom(side === 0 ? [mine, bot] : [bot, mine], side === 0 ? [name, 'Bot'] : ['Bot', name], [side],
        false, msg.seed ?? Math.floor(Math.random() * 1e9), () => rooms.delete(r.id),
        { speed: speedOf(msg.speed), timer: TIMERS.has(Number(msg.timer)) ? Number(msg.timer) : 90, responses: msg.responses === 'always' ? 'always' : 'smart', setup: DEV ? setupFor(msg.scenario, side) : undefined, setupLua: DEV ? luaFor(msg.scenario, side) : undefined });
      rooms.set(r.id, r);
      room = r;
      viewer.side = side;
      r.join(viewer);
    } else if (msg.type === 'answer') room?.answer(viewer, msg.id, msg.answer);
    else if (msg.type === 'resume') {
      // back into a duel after a dropped connection or a page reload
      leave();
      const r = rooms.get(String(msg.duel));
      if (r && r.rejoin(viewer, String(msg.seat))) room = r;
      else viewer.send({ type: 'gone' });
    } else if (msg.type === 'leave') leave();
  });
  ws.on('close', () => leave(true));
});

if (DB_ENABLED) {
  await migrate();
  if (!AUTH_READY) console.error('ARENA_SECRET is missing (64 hex characters): accounts will not work');
  if (!MAIL_READY) console.error('RESEND_API_KEY / ARENA_MAIL_FROM are missing: no email can be sent');
} else console.warn('No database configured (PGDATABASE): accounts are off');
server.listen(PORT, () => console.log(`Millennium Arena on http://localhost:${PORT}${BASE}/  (WebSocket ${BASE}/ws)`));
