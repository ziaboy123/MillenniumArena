// One duel: its worker thread, the people connected to it, paced delivery of frames, prompts for players and
// their clocks.
import { randomBytes, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { COIN_TOSS_MS, type DuelInfo, type Frame, type Prompt, type PromptAnswer, type Responses, type ServerMessage, type Side, type Speed } from '@arena/shared';
import { engineCode, officialCode } from '../cards.ts';
import { ENGINE_NAME, PACE } from '../config.ts';
import type { Deck } from '../decks.ts';
import type { BotLevel } from './bot.ts';
import type { WorkerCommand, WorkerInput, WorkerOutput } from './duel-worker.ts';
import { frameFor, seat, seatSide } from './visibility.ts';

/** Someone connected to the duel: `side` is the engine side they play, or null when watching. */
export interface Viewer { side: Side | null; send(msg: ServerMessage): void }

export interface RoomOptions {
  /** How fast the bot's moves play out. */
  speed?: Speed;
  /** Seconds each player gets per turn; 0 = no timer. */
  timer?: number;
  bots?: [BotLevel, BotLevel];
  /** For the people playing: when to ask them to respond. */
  responses?: Responses;
  /** Sides that only want to respond to the opponent's moves (overrides `responses`, for duels between people). */
  smart?: Side[];
  setup?: WorkerInput['setup'];
  setupLua?: string;
  /** Starting life points. */
  lp?: number;
  /** Duels between people: neither the log nor a spectator learns which deck someone is using. */
  hideDecks?: boolean;
  /** A coin toss decided who goes first: viewers see it land before the first move is shown. */
  coin?: boolean;
  /** Called once when the duel ends (with the winning engine side, 2 for a draw). */
  onEnd?: (end: Extract<ServerMessage, { type: 'end' }>) => void;
  /** Part of a match: the match decides when to close it, not the last person leaving. */
  managed?: boolean;
  /** Duels against the bot: stop (unrecorded) when the player hasn't answered for this long, even with the timer off,
   *  and close this long after the result, so abandoned duels don't hold the server's duel slots. */
  idleMs?: number;
  closeAfterEndMs?: number;
}

const SPEED: Record<Speed, number> = { slow: 1.7, normal: 1, fast: 0.45, instant: 0.12 };
/** On the opponent's turn each response has its own limit, so the turn's time is only spent on your own turn. */
const RESPONSE_MS = 30_000;
/** How long a player's seat is kept after their connection drops, so they can rejoin. */
const REJOIN_MS = 60_000;

type Reveal = Extract<ServerMessage, { type: 'reveal' }>;
type Queued = { frame: Frame } | { prompt: Prompt; side: Side } | { reveal: Reveal; side: Side | 'all' };

export class DuelRoom {
  readonly id = randomUUID().slice(0, 8);
  private worker: Worker;
  // each connection and its seat in THIS duel, fixed when it joins: a connection's Viewer.side can change later (it may
  // start a bot duel, or be in a match too), and that must never change what this duel shows it
  private viewers = new Map<Viewer, Side | null>();
  private queue: Queued[] = [];
  private latest: Frame | null = null;
  private pending: { prompt: Prompt; side: Side } | null = null;
  private ending: Extract<ServerMessage, { type: 'end' }> | null = null;
  private timer: NodeJS.Timeout | null = null;
  // turn clocks: time left in the current turn per side (ms), and the running clock of the prompt on screen
  private bank: [number, number] = [0, 0];
  private turn = 0;
  private turnPlayer: Side = 0;
  private clock: { id: number; side: Side; started: number; limit: number; turn: boolean; timeout: NodeJS.Timeout } | null = null;
  private readonly seconds: number;
  // rejoining: a secret key per player seat, the log so far (for a reloaded page), and seats whose connection dropped
  private readonly seats = new Map<Side, string>();
  private readonly log: { step: number; turn: number; text: string }[] = [];
  private readonly away = new Map<Side, NodeJS.Timeout>();
  private ended: Extract<ServerMessage, { type: 'end' }> | null = null;
  private readonly speed: number;
  readonly startedAt = Date.now();
  private readonly options: RoomOptions;
  /** Cards each side summoned, activated or Set: code → times. */
  readonly uses: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  closed = false;

  /** `decks` and `players` are in engine order: side 0 goes first. `humans` are the sides people play. */
  constructor(private decks: [Deck, Deck], private players: [string, string], private humans: Side[], readonly fullView: boolean, seed: number, private onClose: () => void, options: RoomOptions = {}) {
    this.seconds = Math.max(0, Math.min(600, Math.round(options.timer ?? 0)));
    this.speed = SPEED[options.speed ?? 'normal'] ?? 1;
    // the engine only knows brand-new cards by Project Ignis's temporary numbers
    const input: WorkerInput = { decks: decks.map(d => ({ name: d.name, main: d.main.map(engineCode), extra: d.extra.map(engineCode) })) as WorkerInput['decks'], players, humans, seed, bots: options.bots, setup: options.setup, setupLua: options.setupLua,
      smart: options.smart ?? (options.responses === 'always' ? [] : humans), lp: options.lp, hideDecks: options.hideDecks };
    this.options = options;
    // hold the queue while the coin toss plays out in the browser (the duel itself starts working straight away)
    if (options.coin && PACE) this.timer = setTimeout(() => { this.timer = null; this.pump(); }, COIN_TOSS_MS * PACE);
    for (const side of humans) this.seats.set(side, randomBytes(18).toString('base64url'));
    this.worker = new Worker(new URL('./duel-worker.ts', import.meta.url), { workerData: input, execArgv: ['--disable-warning=ExperimentalWarning', '--import', 'tsx'] });   // node:sqlite still warns it's experimental on Node 22
    this.worker.on('message', (msg: WorkerOutput) => {
      if (msg.type === 'frame') { this.queue.push({ frame: msg.frame }); this.pump(); }
      else if (msg.type === 'prompt') { this.queue.push({ prompt: msg.prompt, side: msg.side }); this.pump(); }
      else if (msg.type === 'reveal') { this.queue.push({ reveal: { type: 'reveal', title: msg.title, cards: msg.cards, brief: msg.brief }, side: msg.side }); this.pump(); }
      else if (msg.type === 'end') { this.ending = { type: 'end', winner: msg.winner, reason: msg.reason, turns: msg.turns }; this.pump(); }
      else if (msg.type === 'use') { const code = officialCode(msg.code); this.uses[msg.side].set(code, (this.uses[msg.side].get(code) ?? 0) + 1); }   // counted under the number that lasts
      else this.broadcast({ type: 'error', message: `The duel engine hit a problem: ${msg.message}` });
    });
    this.worker.on('error', err => this.broadcast({ type: 'error', message: `The duel engine crashed: ${err.message}` }));
  }

  info(side: Side | null, rejoining = false): DuelInfo {
    const key = side === null ? undefined : this.seats.get(side);
    // between people you only know your own deck's name
    const decks: [string, string] = this.options.hideDecks ? [side === 0 ? this.decks[0].name : '', side === 1 ? this.decks[1].name : ''] : [this.decks[0].name, this.decks[1].name];
    return { id: this.id, players: seat(this.players, side), decks: seat(decks, side), you: side === null ? null : 0, fullView: this.fullView, engine: ENGINE_NAME, timer: this.seconds, ...(key ? { seat: key } : {}),
      ...(this.humans.length > 1 ? { people: true } : {}),
      ...(this.seconds && this.turn ? { clock: { side: seatSide(this.turnPlayer, side) as Side, turn: this.turn, left: this.turnLeft() } } : {}),
      // side 0 goes first; the toss is only shown once, when the duel starts
      ...(this.options.coin && !rejoining ? { coin: { first: seatSide(0, side) as Side } } : {}) };
  }

  /** `rejoining`: also send the log so far (the page may have been reloaded). */
  join(viewer: Viewer, rejoining = false) {
    const side = viewer.side;
    this.viewers.set(viewer, side);
    viewer.send({ type: 'duel', duel: this.info(side, rejoining) });
    if (rejoining) viewer.send({ type: 'backlog', lines: this.log });
    if (this.latest) viewer.send({ type: 'frame', frame: frameFor(this.latest, side, this.fullView) });
    if (this.pending && this.pending.side === side) viewer.send({ type: 'prompt', prompt: this.timed(this.pending.prompt) });
    else if (this.pending) viewer.send(this.waitingFor(this.pending, side));
    if (this.ended) viewer.send({ ...this.ended, winner: seatSide(this.ended.winner, side) });
  }

  /** Back into a seat after a dropped connection; false if the key doesn't match. */
  rejoin(viewer: Viewer, key: string): boolean {
    const side = [...this.seats].find(([, k]) => k === key)?.[0];
    if (side === undefined || this.closed) return false;
    clearTimeout(this.away.get(side));
    this.away.delete(side);
    viewer.side = side;
    this.join(viewer, true);
    return true;
  }

  /** Back into the duel for someone a match has already identified by their login (a player's seat, or watching). */
  rejoinAs(viewer: Viewer, side: Side | null): boolean {
    if (this.closed) return false;
    if (side !== null) { clearTimeout(this.away.get(side)); this.away.delete(side); }
    viewer.side = side;
    this.join(viewer, true);
    return true;
  }

  /** `dropped`: the connection was lost (the seat is kept for a minute) rather than the player leaving. */
  leave(viewer: Viewer, dropped = false) {
    const side = this.viewers.get(viewer) ?? null;
    this.viewers.delete(viewer);
    if (dropped && side !== null && this.seats.has(side) && !this.ended && ![...this.viewers.values()].includes(side)) {
      this.away.set(side, setTimeout(() => {
        this.away.delete(side);
        // against a person, not coming back loses the duel; against the bot the duel just stops
        if (this.humans.length > 1) this.concede(side, `${this.players[side]} left the duel`);
        else if (![...this.viewers.values()].some(s => s !== null)) this.close();
      }, REJOIN_MS));
      return;
    }
    if (!this.viewers.size && !this.away.size && !this.options.managed) this.close();
  }

  /** The seat this connection has in this duel (null: watching, or not in it). */
  seatOf(viewer: Viewer): Side | null { return this.viewers.get(viewer) ?? null; }

  /** A player's answer to the prompt they were shown. Anything stale or from the wrong seat is ignored. */
  answer(viewer: Viewer, id: number, answer: PromptAnswer) {
    const side = this.viewers.get(viewer);
    if (!this.pending || side === undefined || side !== this.pending.side || id !== this.pending.prompt.id) return;
    this.pending = null;
    this.stopClock();
    this.clearIdle();
    for (const [v, s] of this.viewers) {
      if (s !== side) v.send({ type: 'waiting', side: null });
      else if (v !== viewer) v.send({ type: 'prompt', prompt: null });   // the same player in another tab
    }
    this.worker.postMessage({ type: 'answer', id, answer } satisfies WorkerCommand);
  }

  /** A player gives up (or left): the other side wins straight away. */
  concede(side: Side, reason: string) {
    if (this.closed || this.ended || this.ending) return;
    this.queue = [];
    this.pending = null;
    this.stopClock();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.worker.terminate();
    this.ending = { type: 'end', winner: (1 - side) as Side, reason, turns: this.turn };
    this.pump();
  }

  /** Who's connected to the duel right now. */
  get people() { return new Set(this.viewers.keys()); }
  /** The duel has a result (or is about to show it). */
  get finished() { return !!(this.ended || this.ending); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearIdle();
    if (this.timer) clearTimeout(this.timer);
    if (this.clock) clearTimeout(this.clock.timeout);
    for (const t of this.away.values()) clearTimeout(t);
    this.worker.terminate();
    this.onClose();
  }

  // frames arrive from the engine much faster than people can follow, so they're played out at a watchable pace;
  // a prompt waits its turn in the same queue, so it appears once everything before it has been shown
  private pump(): void {
    if (this.timer || this.closed) return;
    const next = this.queue.shift();
    if (!next) {
      if (this.ending) {
        const end = this.ending;
        this.ended = end;
        for (const [v, s] of this.viewers) v.send({ ...end, winner: seatSide(end.winner, s) });
        this.ending = null;
        for (const t of this.away.values()) clearTimeout(t);
        this.away.clear();
        if (!this.unrecorded) this.options.onEnd?.(end);
        this.clearIdle();
        // a finished duel against the bot closes a little later, freeing its slot (the result stays on screen)
        if (this.options.closeAfterEndMs) setTimeout(() => this.close(), this.options.closeAfterEndMs).unref();
      }
      return;
    }
    if ('reveal' in next) {
      for (const [v, s] of this.viewers) if (next.side === 'all' || s === next.side) v.send(next.reveal);
      return this.pump();
    }
    if ('prompt' in next) {
      this.pending = next;
      this.armIdle();
      this.startClock(next.prompt, next.side);
      // the player being asked gets the prompt; everyone else learns who the duel is waiting on, and their clock
      if (this.pending) for (const [v, s] of this.viewers) v.send(s === next.side ? { type: 'prompt', prompt: this.timed(next.prompt) } : this.waitingFor(next, s));
      return this.pump();
    }
    const f = next.frame;
    this.latest = f;
    for (const text of f.lines) this.log.push({ step: f.step, turn: f.turn, text });
    if (f.turn !== this.turn) { this.turn = f.turn; this.turnPlayer = f.turnPlayer; this.bank[f.turnPlayer] = this.seconds * 1000; }   // a fresh turn's time
    for (const [v, s] of this.viewers) v.send({ type: 'frame', frame: frameFor(f, s, this.fullView) });
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, this.pace(f) * PACE);
  }

  /** How long a frame stays up: watching bots is unhurried; with a person playing, their own turn moves quicker. Scaled by the chosen speed. */
  private pace(f: Frame) {
    const n = Math.min(f.lines.length, 5);
    const ms = !this.humans.length ? (n ? 650 + 380 * (n - 1) : 260) * this.speed
      : this.humans.includes(f.turnPlayer) ? (n ? 320 + 160 * (n - 1) : 90) * Math.min(this.speed, 1)
      : (n ? 520 + 300 * (n - 1) : 180) * this.speed;
    // an attack stays up long enough for the attacker's lunge to play out
    return f.attack ? Math.max(ms, 700 * Math.min(this.speed, 1)) : ms;
  }

  // ---------- clocks ----------
  /** Start timing a prompt: on your own turn it spends your turn's time, otherwise it has a response limit. */
  private startClock(prompt: Prompt, side: Side) {
    if (!this.seconds) return;
    const turn = side === this.turnPlayer, limit = turn ? this.bank[side] : RESPONSE_MS;
    if (limit <= 0) return this.expire(prompt.id, side);   // already out of time this turn
    this.clock = { id: prompt.id, side, started: Date.now(), limit, turn, timeout: setTimeout(() => this.expire(prompt.id, side), limit) };
  }
  private stopClock() {
    if (!this.clock) return;
    clearTimeout(this.clock.timeout);
    if (this.clock.turn) this.bank[this.clock.side] = Math.max(0, this.bank[this.clock.side] - (Date.now() - this.clock.started));
    this.clock = null;
  }
  /** Time's up: the worker makes the choice (pass, move to the End Phase, or the bot's pick). */
  private expire(id: number, side: Side) {
    if (!this.pending || this.pending.prompt.id !== id) return;
    this.stopClock();
    this.clearIdle();
    this.pending = null;
    for (const [v, s] of this.viewers) v.send(s === side ? { type: 'prompt', prompt: null } : { type: 'waiting', side: null });
    this.worker.postMessage({ type: 'timeout', id } satisfies WorkerCommand);
  }
  /** The turn player's turn time left right now (running if they're choosing, else paused). */
  private turnLeft() {
    const c = this.clock;
    return c?.turn && c.side === this.turnPlayer ? Math.max(0, c.limit - (Date.now() - c.started)) : this.bank[this.turnPlayer];
  }
  /** For someone other than the player being asked: who the duel is waiting on (from their seat), and that player's clock. */
  private waitingFor(pending: { prompt: Prompt; side: Side }, viewer: Side | null): ServerMessage {
    const time = this.timed(pending.prompt).time;
    return { type: 'waiting', side: seatSide(pending.side, viewer) as Side, ...(time ? { time } : {}) };
  }
  /** The prompt with the time left on its clock right now. */
  private timed(prompt: Prompt): Prompt {
    if (!this.clock || this.clock.id !== prompt.id) return prompt;
    return { ...prompt, time: { left: Math.max(0, this.clock.limit - (Date.now() - this.clock.started)), turn: this.clock.turn } };
  }

  // ---------- nobody moving ----------
  private idle: NodeJS.Timeout | null = null;
  private unrecorded = false;
  private armIdle() {
    if (!this.options.idleMs) return;
    this.clearIdle();
    this.idle = setTimeout(() => this.stop('The duel was closed after 10 minutes with no move'), this.options.idleMs);
    this.idle.unref();
  }
  private clearIdle() { if (this.idle) { clearTimeout(this.idle); this.idle = null; } }
  /** Ends the duel with no result and nothing recorded (an abandoned duel against the bot). */
  private stop(reason: string) {
    if (this.closed || this.ended || this.ending) return;
    this.unrecorded = true;
    this.queue = [];
    this.pending = null;
    this.stopClock();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.worker.terminate();
    this.ending = { type: 'end', winner: null, reason, turns: this.turn };
    this.pump();
  }

  private broadcast(msg: ServerMessage) { for (const v of this.viewers.keys()) v.send(msg); }
}
