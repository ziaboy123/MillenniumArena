// Private rooms: a host picks the rules and gets a code, a friend joins with it, and they duel (best of 1, or best of
// 3 with side decking between games). Others can ask to watch; every duelist in the room has to say yes. Everyone
// must be logged in; people are known by their account, so a reload or a dropped connection finds the room again.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { DEFAULT_RULES, type ChatLine, type RoomPhase, type RoomPreview, type RoomRole, type RoomRules, type RoomView, type ServerMessage, type Side } from '@arena/shared';
import { deckBlocker, ZONE_MAX, type Banlist, type DeckLists, type RuleCard, type SavedDeck } from '@arena/shared/decks';
import { DuelRoom, type Viewer } from './duel/room.ts';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I to mix up
const AWAY_MS = 90_000;        // how long someone's place is kept after their last connection drops
const MAX_SPECTATORS = 12, MAX_CHAT = 200;

export interface MatchDeps {
  banlists: { TCG: Banlist | null; OCG: Banlist | null };
  ruleCard: (code: number) => RuleCard | undefined;
  /** One of this account's decks. */
  loadDeck: (userId: string, id: string) => Promise<SavedDeck | null>;
  /** The server is running as many duels as it can. */
  full: () => boolean;
  /** A duel started / finished (for the server's count of running duels), and the match closed. */
  track: (room: DuelRoom) => void;
  untrack: (room: DuelRoom) => void;
  closed: (match: PrivateMatch) => void;
}
/** Who's acting: a logged-in account with a username. */
export interface Account { id: string; name: string; smart: boolean }

interface Person { userId: string; name: string; viewers: Set<Viewer>; away?: NodeJS.Timeout }
interface Member extends Person {
  role: RoomRole; ready: boolean; smart: boolean; wins: number;
  deck: { id: string; name: string; cover: number | null; registered: DeckLists; current: DeckLists } | null;
  sided: boolean;
}
interface Request extends Person { accepted: Set<RoomRole> }

/** A problem to tell the person who asked (not a crash). */
export class RoomError extends Error {}

const clean = (text: unknown, max: number) => String(text ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const hashPassword = (pw: string) => createHash('sha256').update(`arena-room:${pw}`).digest();
const multiset = (l: DeckLists) => [...l.main, ...l.extra, ...l.side].sort((a, b) => a - b).join(',');

export function cleanRules(r: unknown): RoomRules {
  const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const pick = <T>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
  return {
    bo: pick(Number(x.bo), [1, 3] as const, DEFAULT_RULES.bo),
    timer: pick(Number(x.timer), [0, 60, 90, 180] as const, DEFAULT_RULES.timer),
    banlist: pick(x.banlist, ['TCG', 'OCG', 'none'] as const, DEFAULT_RULES.banlist),
    lp: pick(Number(x.lp), [4000, 8000, 16000] as const, DEFAULT_RULES.lp),
    check: x.check === undefined ? DEFAULT_RULES.check : !!x.check,
    spectators: pick(x.spectators, ['ask', 'off'] as const, DEFAULT_RULES.spectators),
  };
}

export class PrivateMatch {
  phase: RoomPhase = 'lobby';
  room: DuelRoom | null = null;
  private guest: Member | null = null;
  private readonly host: Member;
  private readonly spectators = new Map<string, Person>();
  private readonly requests = new Map<string, Request>();
  private readonly password: Buffer | null;
  private game = 0;
  private toss: RoomRole | null = null;
  private chooser: RoomRole | null = null;
  private last: RoomView['last'] = null;
  private winner: RoomRole | null = null;
  private hostSide: Side = 0;
  private readonly chat: ChatLine[] = [];
  private readonly chatTimes = new Map<string, number[]>();
  closed = false;

  constructor(readonly code: string, readonly rules: RoomRules, password: string, host: Account, private deps: MatchDeps) {
    this.password = password ? hashPassword(password) : null;
    this.host = { userId: host.id, name: host.name, viewers: new Set(), role: 'host', ready: true, smart: host.smart, wins: 0, deck: null, sided: false };
  }

  static newCode(taken: (code: string) => boolean) {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!taken(code)) return code;
    }
  }

  // ---------- who's who ----------
  private members() { return [this.host, this.guest].filter(Boolean) as Member[]; }
  private member(userId: string) { return this.members().find(m => m.userId === userId) ?? null; }
  private mustBe(userId: string, role?: RoomRole) {
    const m = this.member(userId);
    if (!m || (role && m.role !== role)) throw new RoomError(role === 'host' ? 'Only the host can do that.' : "You're not playing in this room.");
    return m;
  }
  /** Everyone connected to the room: duelists, spectators and people asking to watch. */
  private everyone(): Person[] { return [...this.members(), ...this.spectators.values(), ...this.requests.values()]; }
  has(userId: string) { return this.everyone().some(p => p.userId === userId); }
  private sideOf(m: Member): Side { return (m.role === 'host' ? this.hostSide : 1 - this.hostSide) as Side; }
  private passwordOk(pw: unknown) {
    if (!this.password) return true;
    const given = hashPassword(String(pw ?? '').slice(0, 64));
    return timingSafeEqual(given, this.password);
  }

  preview(): RoomPreview {
    return { host: this.host.name, rules: this.rules, password: !!this.password, state: this.phase !== 'lobby' ? 'dueling' : this.guest ? 'full' : 'open' };
  }

  // ---------- coming and going ----------
  /** Someone connected (a new tab, a reload, or after a dropped connection). */
  attach(userId: string, viewer: Viewer) {
    const p = this.everyone().find(x => x.userId === userId);
    if (!p) return false;
    clearTimeout(p.away);
    p.away = undefined;
    p.viewers.add(viewer);
    if (!this.requests.has(userId)) viewer.send({ type: 'chat', lines: this.chat, reset: true });
    if (this.phase === 'dueling' && this.room && !this.requests.has(userId)) {
      const m = this.member(userId);
      this.room.rejoinAs(viewer, m ? this.sideOf(m) : null);
    }
    this.sync();
    return true;
  }

  /** A connection closed; if it was their last, their place is kept for a while before they count as gone. */
  detach(viewer: Viewer) {
    for (const p of this.everyone()) {
      if (!p.viewers.delete(viewer)) continue;
      this.room?.leave(viewer, true);
      if (!p.viewers.size) p.away = setTimeout(() => this.leave(p.userId, `${p.name} lost connection`), AWAY_MS);
      this.sync();
    }
  }

  async setDeck(userId: string, deckId: string) {
    const m = this.mustBe(userId);
    if (this.phase !== 'lobby') throw new RoomError('Decks can only be changed before the duel starts.');
    const d = await this.deps.loadDeck(userId, deckId);
    if (!d) throw new RoomError("That deck doesn't exist any more.");
    const why = this.deckProblem(d);
    if (why) throw new RoomError(why);
    const lists = { main: [...d.main], extra: [...d.extra], side: [...d.side] };
    m.deck = { id: d.id, name: d.name, cover: d.cover ?? d.main[0] ?? null, registered: lists, current: lists };
    if (m.role === 'guest') m.ready = false;   // a new deck needs a new "Ready"
    this.sync();
  }

  /** Why a deck can't be used under this room's rules (null if it can). */
  deckProblem(d: SavedDeck) { return deckBlocker(d, this.deps.ruleCard, this.deps.banlists, this.rules); }

  async join(me: Account, viewer: Viewer, password: unknown, deckId: string) {
    if (this.guest && this.guest.userId !== me.id) throw new RoomError('This room is full. You can ask to watch instead.');
    if (this.phase !== 'lobby') throw new RoomError('Their duel has already started. You can ask to watch instead.');
    if (!this.passwordOk(password)) throw new RoomError("That password isn't right.");
    const d = await this.deps.loadDeck(me.id, deckId);
    if (!d) throw new RoomError("That deck doesn't exist any more.");
    const why = this.deckProblem(d);
    if (why) throw new RoomError(why);
    if (this.guest) return this.attach(me.id, viewer);
    const lists = { main: [...d.main], extra: [...d.extra], side: [...d.side] };
    this.guest = { userId: me.id, name: me.name, viewers: new Set(), role: 'guest', ready: false, smart: me.smart, wins: 0, sided: false,
      deck: { id: d.id, name: d.name, cover: d.cover ?? d.main[0] ?? null, registered: lists, current: lists } };
    this.spectators.delete(me.id);
    this.requests.delete(me.id);
    this.system(`${me.name} joined the room`);
    this.attach(me.id, viewer);
  }

  askToWatch(me: Account, viewer: Viewer, password: unknown) {
    if (this.rules.spectators === 'off') throw new RoomError("This room doesn't allow spectators.");
    if (!this.passwordOk(password)) throw new RoomError("That password isn't right.");
    if (this.member(me.id)) return this.attach(me.id, viewer);
    if (this.spectators.size >= MAX_SPECTATORS) throw new RoomError('This room has as many spectators as it allows.');
    if (!this.requests.has(me.id) && !this.spectators.has(me.id)) this.requests.set(me.id, { userId: me.id, name: me.name, viewers: new Set(), accepted: new Set() });
    this.attach(me.id, viewer);
  }

  answerRequest(userId: string, requestId: string, accept: boolean) {
    const m = this.mustBe(userId), r = this.requests.get(String(requestId));
    if (!r) return;
    if (!accept) {
      this.requests.delete(r.userId);
      this.tell(r, { type: 'room.closed', reason: 'Your request to watch was declined.' });
      return this.sync();
    }
    r.accepted.add(m.role);
    if (this.members().every(x => r.accepted.has(x.role))) {
      this.requests.delete(r.userId);
      const s = { userId: r.userId, name: r.name, viewers: r.viewers };
      this.spectators.set(r.userId, s);
      this.tell(s, { type: 'chat', lines: this.chat, reset: true });
      this.system(`${r.name} is watching`);
      if (this.phase === 'dueling' && this.room) for (const v of r.viewers) this.room.rejoinAs(v, null);
    }
    this.sync();
  }

  kick(userId: string, spectatorId: string) {
    this.mustBe(userId);
    const s = this.spectators.get(String(spectatorId));
    if (!s) return;
    this.spectators.delete(s.userId);
    for (const v of s.viewers) this.room?.leave(v);
    this.tell(s, { type: 'room.closed', reason: 'You were removed from the room.' });
    this.sync();
  }

  /** Leaving: the host closes the room; a duelist leaving mid-match loses it; others just go. */
  leave(userId: string, reason?: string) {
    const m = this.member(userId);
    if (m?.role === 'host') return this.close(reason ? `${reason}, so the room closed.` : 'The host closed the room.', reason ? undefined : userId);
    if (m) {
      if (this.phase === 'dueling' && this.room) this.room.concede(this.sideOf(m), reason ?? `${m.name} left`);
      const midMatch = this.game > 0 && this.phase !== 'over';
      for (const v of m.viewers) this.room?.leave(v);
      this.tell(m, { type: 'room', room: null });
      this.guest = null;
      this.system(reason ?? `${m.name} left the room`);
      if (midMatch) { this.phase = 'over'; this.winner = 'host'; this.last = this.last ?? { winner: 'host', reason: reason ?? `${m.name} left` }; }
      else if (this.phase !== 'over') { this.phase = 'lobby'; this.toss = this.chooser = null; }
      return this.sync();
    }
    const p = this.spectators.get(userId) ?? this.requests.get(userId);
    if (!p) return;
    for (const v of p.viewers) this.room?.leave(v);
    this.spectators.delete(userId);
    this.requests.delete(userId);
    this.tell(p, { type: 'room', room: null });
    this.sync();
  }

  /** `by`: the host closing their own room (they don't need telling why). */
  close(reason: string, by?: string) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.everyone()) { clearTimeout(p.away); this.tell(p, p.userId === by ? { type: 'room', room: null } : { type: 'room.closed', reason }); }
    this.room?.close();
    this.room = null;
    this.deps.closed(this);
  }

  // ---------- getting ready and playing ----------
  setReady(userId: string, ready: boolean) {
    const m = this.mustBe(userId, 'guest');
    if (this.phase !== 'lobby') return;
    if (ready && !m.deck) throw new RoomError('Pick a deck first.');
    m.ready = ready;
    this.sync();
  }

  start(userId: string) {
    this.mustBe(userId, 'host');
    if (this.phase !== 'lobby') return;
    if (!this.guest) throw new RoomError('Wait for a friend to join.');
    if (!this.guest.ready) throw new RoomError(`Wait for ${this.guest.name} to be ready.`);
    if (!this.host.deck) throw new RoomError('Pick a deck first.');
    this.phase = 'toss';
    this.toss = this.chooser = randomInt(2) ? 'host' : 'guest';
    this.system(`${this.nameOf(this.toss)} won the coin toss`);
    this.sync();
  }

  choose(userId: string, first: boolean) {
    const m = this.mustBe(userId);
    if ((this.phase !== 'toss' && this.phase !== 'choose') || m.role !== this.chooser) return;
    const firstRole: RoomRole = first ? m.role : m.role === 'host' ? 'guest' : 'host';
    this.startGame(firstRole);
  }

  private startGame(first: RoomRole) {
    if (this.deps.full()) throw new RoomError('The server is running as many duels as it can right now. Try again in a minute.');
    const guest = this.guest!;
    this.room?.close();
    this.hostSide = first === 'host' ? 0 : 1;
    const bySide: [Member, Member] = this.hostSide === 0 ? [this.host, guest] : [guest, this.host];
    const deck = (m: Member) => ({ id: m.deck!.id, name: m.deck!.name, main: m.deck!.current.main, extra: m.deck!.current.extra, source: 'account' as const });
    this.game++;
    const room: DuelRoom = new DuelRoom([deck(bySide[0]), deck(bySide[1])], [bySide[0].name, bySide[1].name], [0, 1], false, randomInt(1e9), () => this.deps.untrack(room), {
      timer: this.rules.timer, lp: this.rules.lp, hideDecks: true, managed: true, speed: 'normal',
      smart: bySide.flatMap((m, side) => (m.smart ? [side as Side] : [])),
      onEnd: end => this.gameOver(room, end),
    });
    this.room = room;
    this.deps.track(room);
    this.phase = 'dueling';
    this.chooser = null;
    this.last = null;
    this.system(`Game ${this.game}${this.rules.bo === 3 ? ` of 3` : ''} · ${this.nameOf(first)} goes first`);
    for (const m of this.members()) for (const v of m.viewers) room.rejoinAs(v, this.sideOf(m));
    for (const s of this.spectators.values()) for (const v of s.viewers) room.rejoinAs(v, null);
    this.sync();
  }

  private gameOver(room: DuelRoom, end: Extract<ServerMessage, { type: 'end' }>) {
    if (room !== this.room || this.phase !== 'dueling') return;
    const winner: RoomRole | null = end.winner === 0 || end.winner === 1 ? (end.winner === this.hostSide ? 'host' : 'guest') : null;
    if (winner) this.member(winner === 'host' ? this.host.userId : this.guest!.userId)!.wins++;
    this.last = { winner, reason: end.reason };
    const need = this.rules.bo === 3 ? 2 : 1, top = this.members().find(m => m.wins >= need);
    if (top || this.game >= (this.rules.bo === 3 ? 5 : 1)) {
      // the match is decided (best of 3 stops after five games at most, in case of draws)
      this.phase = 'over';
      this.winner = top?.role ?? null;
      this.system(top ? `${top.name} wins the match${this.rules.bo === 3 ? ` ${this.host.wins}-${this.guest?.wins ?? 0}` : ''}` : 'The match is a draw');
    } else {
      // best of 3: side decking, then the loser of the game picks who goes first (after a draw, the same person picks again)
      this.phase = 'siding';
      this.chooser = winner ? (winner === 'host' ? 'guest' : 'host') : (this.chooser ?? this.toss);
      for (const m of this.members()) m.sided = false;
      this.system(winner ? `${this.nameOf(winner)} wins game ${this.game}` : `Game ${this.game} is a draw`);
    }
    this.sync();
  }

  /** Best of 3: a duelist's deck after side decking. Cards may only move between the Main/Extra Deck and the Side Deck. */
  side(userId: string, lists: unknown) {
    const m = this.mustBe(userId);
    if (this.phase !== 'siding' || !m.deck) return;
    const l = (lists && typeof lists === 'object' ? lists : {}) as Record<string, unknown>;
    const next: DeckLists = { main: [], extra: [], side: [] };
    for (const z of ['main', 'extra', 'side'] as const) {
      const v = l[z];
      if (!Array.isArray(v) || v.length > 90) throw new RoomError('That deck is not right.');
      next[z] = v.map(Number).filter(n => Number.isInteger(n) && n > 0);
    }
    const reg = m.deck.registered;
    if (multiset(next) !== multiset(reg)) throw new RoomError('Side decking can only swap cards between your Main or Extra Deck and your Side Deck.');
    if (next.side.length !== reg.side.length) throw new RoomError(`Your Side Deck has to keep ${reg.side.length} cards.`);
    if (next.main.length < 40 || next.main.length > ZONE_MAX.main) throw new RoomError('Your Main Deck needs 40 to 60 cards.');
    if (next.extra.length > ZONE_MAX.extra) throw new RoomError('Your Extra Deck can have 15 cards at most.');
    if (next.main.some(c => this.deps.ruleCard(c)?.extra) || next.extra.some(c => this.deps.ruleCard(c) && !this.deps.ruleCard(c)!.extra))
      throw new RoomError('Extra Deck monsters go in the Extra Deck, everything else in the Main Deck.');
    m.deck.current = next;
    m.sided = true;
    if (this.members().every(x => x.sided)) this.phase = 'choose';
    this.sync();
  }

  surrender(userId: string) {
    const m = this.mustBe(userId);
    if (this.phase === 'dueling' && this.room) this.room.concede(this.sideOf(m), `${m.name} surrendered`);
  }

  /** Host, after a match: back to the room with the same rules (everyone's decks as they registered them). */
  again(userId: string) {
    this.mustBe(userId, 'host');
    if (this.phase !== 'over') return;
    this.room?.close();
    this.room = null;
    this.phase = 'lobby';
    this.game = 0;
    this.toss = this.chooser = this.winner = null;
    this.last = null;
    for (const m of this.members()) { m.wins = 0; m.sided = false; m.ready = m.role === 'host'; if (m.deck) m.deck.current = m.deck.registered; }
    this.system('Back in the room for another match');
    this.sync();
  }

  // ---------- chat ----------
  say(userId: string, text: unknown) {
    const p = this.everyone().find(x => x.userId === userId);
    if (!p || this.requests.has(userId)) throw new RoomError('Only people in the room can chat.');
    const t = clean(text, 200);
    if (!t) return;
    const now = Date.now(), times = (this.chatTimes.get(userId) ?? []).filter(x => now - x < 10_000);
    if (times.length >= 8 || (times.length && now - times[times.length - 1] < 400)) throw new RoomError('Slow down a little.');
    this.chatTimes.set(userId, [...times, now]);
    const m = this.member(userId);
    this.post({ from: p.name, role: m ? m.role : 'spectator', text: t, at: now });
  }
  private system(text: string) { this.post({ from: '', role: 'system', text, at: Date.now() }); }
  private post(line: ChatLine) {
    this.chat.push(line);
    if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
    for (const p of this.everyone()) if (!this.requests.has(p.userId)) this.tell(p, { type: 'chat', lines: [line] });
  }

  // ---------- telling people ----------
  private nameOf(role: RoomRole) { return role === 'host' ? this.host.name : this.guest?.name ?? 'Your opponent'; }
  private tell(p: Person, msg: ServerMessage) { for (const v of p.viewers) v.send(msg); }

  /** Each person's view of the room (the opponent's deck stays private). */
  view(userId: string): RoomView {
    const me = this.member(userId);
    const asking = this.requests.has(userId);
    const player = (m: Member | null) => m && {
      name: m.name, role: m.role, you: m.userId === userId, ready: m.ready, connected: m.viewers.size > 0, wins: m.wins, hasDeck: !!m.deck,
      deck: m.userId === userId && m.deck ? { name: m.deck.name, cover: m.deck.cover } : null,
    };
    return {
      code: this.code, you: me ? me.role : asking ? 'asking' : 'spectator', rules: this.rules, password: !!this.password,
      players: [player(this.host)!, player(this.guest)], phase: this.phase, game: this.game, chooser: this.chooser, toss: this.toss,
      last: this.last, winner: this.winner,
      spectators: asking ? [] : [...this.spectators.values()].map(s => ({ id: s.userId, name: s.name })),
      requests: me ? [...this.requests.values()].map(r => ({ id: r.userId, name: r.name, accepted: r.accepted.has(me.role) })) : [],
      siding: me && this.phase === 'siding' && me.deck ? { ...me.deck.current, done: me.sided } : null,
    };
  }
  sync() { if (!this.closed) for (const p of this.everyone()) this.tell(p, { type: 'room', room: this.view(p.userId) }); }
}
