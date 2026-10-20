// Millennium Arena server: card data API, duel WebSocket, and (in production) the built browser app,
// all under one path prefix so it sits behind nginx like the other sites (e.g. /millenniumarena).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { UNRANKED_RULES, type ClientMessage, type ServerMessage, type Side, type Speed } from '@arena/shared';
import { sessionUser } from './auth/accounts.ts';
import { MAIL_READY } from './auth/mailer.ts';
import { accountRoutes, cookies, sameOrigin } from './auth/routes.ts';
import { AUTH_READY } from './auth/security.ts';
import { blocksPlay, deckBlocker, deckProblems, type SavedDeck } from '@arena/shared/decks';
import { loadBanlist } from './banlist.ts';
import { clientCardList, engineCode, loadCards, ruleCards } from './cards.ts';
import { serveImage } from './images.ts';
import { accountDeck, accountDecks, activeDeck } from './decks-api.ts';
import { recordMatch } from './history.ts';
import { cleanRules, PrivateMatch, RoomError, type Account, type MatchDeps } from './match.ts';
import { limited } from './auth/ratelimit.ts';
import { BASE, CLIENT_DIST, DEV, ENGINE_DATA, ENGINE_NAME, HOST, MAX_DUELS, PORT } from './config.ts';
import { loadDecks, summarise, type Deck } from './decks.ts';
import { DB_ENABLED, migrate } from './db/index.ts';
import { DuelRoom, type Viewer } from './duel/room.ts';
import { SCENARIOS, firstFor, luaFor, setupFor } from './duel/scenarios.ts';
import { setReportContext, standingOf, SUSPENDED } from './safety.ts';

const t0 = performance.now();
const cards = loadCards();
const cardList = clientCardList(cards);
const cardListTag = `"${createHash('sha1').update(cardList).digest('base64url').slice(0, 16)}"`;   // changes whenever the list does
const decks = loadDecks(cards);
const banlist = loadBanlist();
const ocgBanlist = loadBanlist(path.join(ENGINE_DATA, 'LFLists/OCG.lflist.conf'));
const ocgBanlistJson = JSON.stringify(ocgBanlist);
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
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
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
    "img-src 'self' data:", `connect-src 'self' wss://${host} ws://${host}`, "frame-ancestors 'none'", "base-uri 'self'",
    "form-action 'self'", "object-src 'none'",
  ].join('; '));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  securityHeaders(req, res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === BASE) { res.writeHead(301, { location: BASE + '/' + url.search }); res.end(); return; }
  if (!url.pathname.startsWith(BASE + '/')) { res.writeHead(302, { location: BASE + '/' }); res.end(); return; }
  const rel = url.pathname.slice(BASE.length);
  if (rel === '/api/health') return json(res, { ok: true, duels: rooms.size, maxDuels: MAX_DUELS, engine: ENGINE_NAME });
  if (rel === '/api/cards') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'cache-control': 'public, max-age=3600', etag: cardListTag });
    res.end(cardList); return;
  }
  if (rel === '/api/decks') return json(res, [...decks.values()].map(summarise));
  if (rel === '/api/banlist' || rel === '/api/banlist/ocg') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' });
    res.end(rel === '/api/banlist' ? banlistJson : ocgBanlistJson); return;
  }
  if (DB_ENABLED && await accountRoutes(req, res, rel)) return;
  if (rel.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
  // card pictures, re-hosted from YGOPRODeck (any card number the engine knows, by its official or engine number)
  if (rel.startsWith('/img/') && await serveImage(res, rel, code => cards.has(code) || cards.has(engineCode(code)))) return;
  serveClient(req, res, rel);
}
// a request that breaks something (a malformed address, say) gets an error; it never takes the server, and every duel on it, down
const server = createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(`http ${req.method} ${String(req.url).slice(0, 200)}: ${e?.stack ?? e}`);
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
    res.end();
  });
});

// ---------- private rooms ----------
const matches = new Map<string, PrivateMatch>();   // by room code
const matchOf = new Map<string, PrivateMatch>();   // by account: one room at a time
// a report from the chat panel comes with the room it was made in and its recent chat
setReportContext(userId => { const m = matchOf.get(userId); return m && !m.closed ? { room: `${m.kind} room ${m.code}`, lines: m.recentChat(20) } : null; });
/** A deck to duel with in a room: one of the account's, or one of the bot's tournament decks to borrow (unranked). */
async function roomDeck(userId: string, id: string): Promise<SavedDeck | null> {
  const lent = decks.get(id);
  if (lent && lent.source !== 'account') return { id: lent.id, name: lent.name, format: 'ADVANCED', cover: lent.cover ?? lent.main[0] ?? null, updatedAt: '', main: lent.main, extra: lent.extra, side: [] };
  return accountDeck(userId, id);
}
const matchDeps: MatchDeps = {
  banlists: { TCG: banlist, OCG: ocgBanlist }, ruleCard, loadDeck: roomDeck, full: () => rooms.size >= MAX_DUELS,
  track: r => rooms.set(r.id, r), untrack: r => rooms.delete(r.id), record: recordMatch,
  closed: m => { matches.delete(m.code); for (const [user, x] of matchOf) if (x === m) matchOf.delete(user); },
};
const roomCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

// ---------- unranked: whoever is searching gets paired, longest wait first ----------
interface Searcher { me: Account; deck: string; since: number; viewer: Viewer; matched: (m: PrivateMatch) => void }
const queue = new Map<string, Searcher>();   // by account: one search at a time
const online = new Map<string, number>();    // accounts with the site open (tabs), for "N players online"
const queueStatus = (s: Searcher | null): ServerMessage => ({ type: 'queue', searching: !!s, since: s?.since ?? null, online: online.size });
/** Stop searching (starting something else, a dropped connection); tells the tab that was searching. */
function dequeue(userId: string | undefined, viewer?: Viewer) {
  const s = userId ? queue.get(userId) : undefined;
  if (!s || (viewer && s.viewer !== viewer)) return;
  queue.delete(s.me.id);
  s.viewer.send(queueStatus(null));
}
async function pairUp() {
  while (queue.size >= 2) {
    const [a, b] = [...queue.values()].sort((x, y) => x.since - y.since);
    queue.delete(a.me.id); queue.delete(b.me.id);
    const m = new PrivateMatch(PrivateMatch.newCode(c => matches.has(c)), UNRANKED_RULES, '', a.me, matchDeps, 'unranked');
    matches.set(m.code, m);
    // a deck that stopped being usable since the search began drops that player; the other keeps their place
    const drop = (who: Searcher, other: Searcher, e: unknown) => {
      m.close('The match could not be set up.');
      who.viewer.send({ type: 'error', message: e instanceof RoomError ? e.message : 'Your deck could not be used. Search again.' });
      who.viewer.send(queueStatus(null));
      queue.set(other.me.id, other);
    };
    try { await m.setDeck(a.me.id, a.deck); } catch (e) { drop(a, b, e); continue; }
    try { await m.join(b.me, b.viewer, '', b.deck); } catch (e) { drop(b, a, e); continue; }
    m.setReady(b.me.id, true);
    for (const s of [a, b]) { matchOf.set(s.me.id, m); s.matched(m); s.viewer.send(queueStatus(null)); }
    m.attach(a.me.id, a.viewer);
    m.start(a.me.id);   // straight to the coin toss
  }
}
// the online count moves while you wait
setInterval(() => { for (const s of queue.values()) s.viewer.send(queueStatus(s)); }, 10_000).unref();

/** One of your own decks, ready to duel with, or the reason it can't be used. */
async function ownDeck(userId: string | undefined, id: string): Promise<Deck | string | undefined> {
  if (!userId) return undefined;
  const d = await accountDeck(userId, id);
  if (!d) return undefined;
  const stop = deckProblems(d, ruleCard, banlist).find(blocksPlay);
  if (stop) return `${d.name} can't be used yet: ${stop.text[0].toLowerCase()}${stop.text.slice(1)}.`;
  return { id: `acct:${d.id}`, name: d.name, main: d.main, extra: d.extra, source: 'account', cover: d.cover ?? d.main[0] ?? null };
}

// ---------- WebSocket: one connection per browser tab ----------
// only pages from this site may connect (stops other sites opening a connection with a visitor's login cookie)
const wss = new WebSocketServer({ server, path: `${BASE}/ws`, maxPayload: 64 * 1024, verifyClient: ({ req }: { req: IncomingMessage }) => sameOrigin(req) });
// Cloudflare closes a WebSocket that's been quiet for 100 s, so every connection is pinged (the browser answers by
// itself) every 30 s. One that didn't answer the last ping has gone, and is closed (its seat waits a minute for it).
const answered = new WeakSet<WebSocket>();
setInterval(() => {
  for (const ws of wss.clients) {
    if (!answered.has(ws)) { ws.terminate(); continue; }
    answered.delete(ws);
    ws.ping();
  }
}, 30_000).unref();
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  answered.add(ws);
  ws.on('pong', () => answered.add(ws));
  // a frame that's too big or isn't valid text closes this connection (ws does that); without a listener it would crash the server
  ws.on('error', e => console.warn(`ws: ${e.message}`));
  // who's connected (if logged in); messages wait for this
  const who = DB_ENABLED ? sessionUser(cookies(req).ma_session).catch(() => null) : Promise.resolve(null);
  who.then(me => { if (me?.username) online.set(me.id, (online.get(me.id) ?? 0) + 1); });
  let room: DuelRoom | null = null;
  let match: PrivateMatch | null = null;   // the private room this tab is in
  const viewer: Viewer = { side: null, send: (msg: ServerMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); } };
  let playerName = '';
  const leave = (dropped = false) => {
    // leaving a duel against the bot before it's over counts as a loss (a dropped connection gets a minute to come back)
    if (!dropped && room && viewer.side !== null && !room.finished) room.concede(viewer.side, `${playerName} left the duel`);
    room?.leave(viewer, dropped); room = null; viewer.side = null;
  };
  const full = () => rooms.size >= MAX_DUELS && (viewer.send({ type: 'error', message: 'The server is running as many duels as it can right now. Try again in a minute.' }), true);

  /** Leave whatever private room this account is in (before creating or joining another). */
  const leaveRooms = (userId: string) => { matchOf.get(userId)?.leave(userId); matchOf.delete(userId); match = null; };
  async function roomMessage(msg: ClientMessage, me: Account) {
    const busy = (key: string, max: number, ms: number) => { if (limited(`${key}:${me.id}`, max, ms)) throw new RoomError('Too many tries. Wait a minute and try again.'); };
    // chatting and playing other people needs an account in good standing that has agreed to the Terms
    if (msg.type === 'chat' || msg.type === 'queue.join' || msg.type === 'room.create' || msg.type === 'room.join' || msg.type === 'room.watch') {
      const standing = await standingOf(me.id);
      if (standing.suspended) throw new RoomError(SUSPENDED);
      if (!standing.terms) throw new RoomError("Confirm you're 13 or older and agree to the Terms first: reload the page to see them.");
    }
    switch (msg.type) {
      case 'room.resume': {
        const m = matchOf.get(me.id);
        if (m && !m.closed && m.attach(me.id, viewer)) match = m; else viewer.send({ type: 'room', room: null });
        return;
      }
      case 'queue.join': {
        busy('queue', 30, 60_000);
        const deck = String(msg.deck).slice(0, 80), d = await roomDeck(me.id, deck);
        if (!d) throw new RoomError("That deck doesn't exist any more.");
        const why = deckBlocker(d, ruleCard, { TCG: banlist, OCG: ocgBanlist }, UNRANKED_RULES);
        if (why) throw new RoomError(why);
        leave(); leaveRooms(me.id);
        const before = queue.get(me.id);
        if (before && before.viewer !== viewer) before.viewer.send(queueStatus(null));   // searching in another tab: this one takes over
        const s: Searcher = { me, deck, since: before?.since ?? Date.now(), viewer, matched: m => { match = m; } };
        queue.set(me.id, s);
        viewer.send(queueStatus(s));
        return pairUp();
      }
      case 'queue.leave': dequeue(me.id); return viewer.send(queueStatus(null));
      case 'room.create': {
        busy('room-create', 20, 600_000);
        leave(); leaveRooms(me.id); dequeue(me.id);
        const m = new PrivateMatch(PrivateMatch.newCode(c => matches.has(c)), cleanRules(msg.rules), String(msg.password ?? '').slice(0, 64), me, matchDeps);
        matches.set(m.code, m);
        try { await m.setDeck(me.id, String(msg.deck)); } catch (e) { m.close('The room could not be set up.'); throw e; }
        matchOf.set(me.id, m);
        match = m;
        m.attach(me.id, viewer);
        return;
      }
      case 'room.peek': {
        busy('room-peek', 40, 60_000);
        const code = roomCode(msg.code), m = matches.get(code);
        return viewer.send({ type: 'room.preview', code, preview: m && !m.closed ? m.preview() : null });
      }
      case 'room.join': case 'room.watch': {
        busy('room-join', 20, 60_000);
        const m = matches.get(roomCode(msg.code));
        if (!m || m.closed) throw new RoomError('No room has that code. Check it with your friend.');
        if (matchOf.get(me.id) !== m) { leave(); leaveRooms(me.id); dequeue(me.id); }
        if (msg.type === 'room.join') await m.join(me, viewer, msg.password, String(msg.deck));
        else m.askToWatch(me, viewer, msg.password);
        matchOf.set(me.id, m);
        match = m;
        return;
      }
    }
    // everything else happens inside your room
    const m = match ?? matchOf.get(me.id) ?? null;
    if (!m || m.closed || !m.has(me.id)) { viewer.send({ type: 'room', room: null }); return; }
    switch (msg.type) {
      case 'room.deck': return m.setDeck(me.id, String(msg.deck));
      case 'room.ready': return m.setReady(me.id, !!msg.ready);
      case 'room.start': return m.start(me.id);
      case 'room.choose': return m.choose(me.id, !!msg.first);
      case 'room.side': return m.side(me.id, msg);
      case 'room.request': return m.answerRequest(me.id, String(msg.id), !!msg.accept);
      case 'room.kick': return m.kick(me.id, String(msg.id));
      case 'room.surrender': return m.surrender(me.id);
      case 'room.again': return m.again(me.id);
      case 'room.leave': m.leave(me.id); matchOf.delete(me.id); match = null; return;
      case 'chat': busy('chat', 60, 60_000); return m.say(me.id, msg.text);
    }
  }

  async function onMessage(raw: unknown) {
    let msg: ClientMessage;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const me = await who;
    if (typeof msg?.type === 'string' && (msg.type.startsWith('room.') || msg.type.startsWith('queue.') || msg.type === 'chat')) {
      if (!me?.username) return viewer.send({ type: 'error', message: 'Log in to play with friends.' });
      try { await roomMessage(msg, { id: me.id, name: me.username, smart: (me.settings.responses ?? 'smart') !== 'always' }); }
      catch (e: any) {
        if (e instanceof RoomError) viewer.send({ type: 'error', message: e.message });
        else { console.error(`room: ${e?.stack ?? e}`); viewer.send({ type: 'error', message: 'Something went wrong. Try again in a moment.' }); }
      }
      return;
    }
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
      if (DB_ENABLED && !DEV) return viewer.send({ type: 'error', message: 'Watching bots is only on the test server.' });
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
      leave(); dequeue(me?.id);
      const mine = String(msg.deck).startsWith('acct:') ? await ownDeck(me?.id, String(msg.deck).slice(5)) : decks.get(msg.deck), bot = decks.get(msg.botDeck);
      if (typeof mine === 'string') return viewer.send({ type: 'error', message: mine });
      if (!mine || !bot) return viewer.send({ type: 'error', message: 'Unknown deck.' });
      if (full()) return;
      // logged in: your username; otherwise the name typed in the lobby (cleaned up)
      const name = me?.username ?? (String(msg.name ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16) || 'Duelist');
      playerName = name;
      const first = (DEV && firstFor(msg.scenario)) || msg.first;
      const tossed = first !== 'me' && first !== 'you' && first !== 'bot';   // a coin toss, which the player gets to watch
      const side: Side = first === 'me' || first === 'you' ? 0 : first === 'bot' ? 1 : (Math.random() < 0.5 ? 0 : 1);   // side 0 goes first
      const r = new DuelRoom(side === 0 ? [mine, bot] : [bot, mine], side === 0 ? [name, 'Bot'] : ['Bot', name], [side],
        false, msg.seed ?? Math.floor(Math.random() * 1e9), () => rooms.delete(r.id),
        { speed: speedOf(msg.speed), timer: TIMERS.has(Number(msg.timer)) ? Number(msg.timer) : 90, responses: msg.responses === 'always' ? 'always' : 'smart', coin: tossed, setup: DEV ? setupFor(msg.scenario, side) : undefined, setupLua: DEV ? luaFor(msg.scenario, side) : undefined,
          // logged in, a finished duel goes into your match history (test setups don't)
          onEnd: me?.username && !(DEV && msg.scenario) ? end => {
            const won = end.winner === side, lost = end.winner === 1 - side;
            recordMatch({ kind: 'bot', bo: 1, games: 1, turns: end.turns, reason: end.reason, startedAt: r.startedAt, players: [{
              userId: me.id, opponent: 'Bot', opponentId: null, deckName: mine.name, deckId: mine.source === 'account' ? mine.id.slice(5) : null, cover: mine.cover ?? mine.main[0] ?? null,
              result: won ? 'win' : lost ? 'loss' : 'draw', scoreFor: won ? 1 : 0, scoreAgainst: lost ? 1 : 0, uses: r.uses[side] }] });
          } : undefined });
      rooms.set(r.id, r);
      room = r;
      viewer.side = side;
      r.join(viewer);
    } else if (msg.type === 'answer') (room ?? match?.room)?.answer(viewer, msg.id, msg.answer);
    else if (msg.type === 'surrender') { if (room && viewer.side !== null) room.concede(viewer.side, `${playerName} surrendered`); }
    else if (msg.type === 'resume') {
      // back into a duel after a dropped connection or a page reload
      leave();
      const r = rooms.get(String(msg.duel));
      if (r && r.rejoin(viewer, String(msg.seat))) room = r;
      else viewer.send({ type: 'gone' });
    } else if (msg.type === 'leave') leave();
  }
  // like requests, a message that breaks something is logged and dropped
  ws.on('message', raw => { onMessage(raw).catch(e => console.error(`ws: ${e?.stack ?? e}`)); });
  ws.on('close', () => {
    leave(true); match?.detach(viewer);
    who.then(me => {
      if (!me?.username) return;
      dequeue(me.id, viewer);
      const n = (online.get(me.id) ?? 1) - 1;
      if (n > 0) online.set(me.id, n); else online.delete(me.id);
    });
  });
});

// a promise something forgot to catch is a bug to log, not a reason to end every duel on the server
process.on('unhandledRejection', e => console.error(`unhandled: ${(e as any)?.stack ?? e}`));

if (DB_ENABLED) {
  // duels against the bot don't need the database, so the server starts anyway and keeps trying to reach it
  const connect = () => migrate().then(() => console.log('database ready'))
    .catch(e => { console.error(`database unreachable (${e.message}): accounts won't work until it's back; trying again in 30 s`); setTimeout(connect, 30_000).unref(); });
  connect();
  if (!AUTH_READY) console.error('ARENA_SECRET is missing (64 hex characters): signing up and logging in are off');
  if (!MAIL_READY) console.error('RESEND_API_KEY / ARENA_MAIL_FROM are missing: no email can be sent, so signing up and logging in are off');
} else console.warn('No database configured (PGDATABASE): accounts are off');
server.listen(PORT, HOST, () => console.log(`Millennium Arena on http://${HOST ?? 'localhost'}:${PORT}${BASE}/  (WebSocket ${BASE}/ws)`));
