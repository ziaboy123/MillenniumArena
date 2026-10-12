// One duel: its worker thread, the people connected to it, paced delivery of frames, prompts for players and
// their clocks.
import { randomBytes, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { DuelInfo, Frame, Prompt, PromptAnswer, Responses, ServerMessage, Side, Speed } from '@arena/shared';
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
  setup?: WorkerInput['setup'];
  setupLua?: string;
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
  private viewers = new Set<Viewer>();
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
  closed = false;

  /** `decks` and `players` are in engine order: side 0 goes first. `humans` are the sides people play. */
  constructor(private decks: [Deck, Deck], private players: [string, string], private humans: Side[], readonly fullView: boolean, seed: number, private onClose: () => void, options: RoomOptions = {}) {
    this.seconds = Math.max(0, Math.min(600, Math.round(options.timer ?? 0)));
    this.speed = SPEED[options.speed ?? 'normal'] ?? 1;
    const input: WorkerInput = { decks: decks.map(d => ({ name: d.name, main: d.main, extra: d.extra })) as WorkerInput['decks'], players, humans, seed, bots: options.bots, setup: options.setup, setupLua: options.setupLua,
      smart: options.responses === 'always' ? [] : humans };
    for (const side of humans) this.seats.set(side, randomBytes(18).toString('base64url'));
    this.worker = new Worker(new URL('./duel-worker.ts', import.meta.url), { workerData: input, execArgv: ['--import', 'tsx'] });
    this.worker.on('message', (msg: WorkerOutput) => {
      if (msg.type === 'frame') { this.queue.push({ frame: msg.frame }); this.pump(); }
      else if (msg.type === 'prompt') { this.queue.push({ prompt: msg.prompt, side: msg.side }); this.pump(); }
      else if (msg.type === 'reveal') { this.queue.push({ reveal: { type: 'reveal', title: msg.title, cards: msg.cards, brief: msg.brief }, side: msg.side }); this.pump(); }
      else if (msg.type === 'end') { this.ending = { type: 'end', winner: msg.winner, reason: msg.reason, turns: msg.turns }; this.pump(); }
      else this.broadcast({ type: 'error', message: `The duel engine hit a problem: ${msg.message}` });
    });
    this.worker.on('error', err => this.broadcast({ type: 'error', message: `The duel engine crashed: ${err.message}` }));
  }

  info(side: Side | null): DuelInfo {
    const key = side === null ? undefined : this.seats.get(side);
    return { id: this.id, players: seat(this.players, side), decks: seat([this.decks[0].name, this.decks[1].name], side), you: side === null ? null : 0, fullView: this.fullView, engine: ENGINE_NAME, timer: this.seconds, ...(key ? { seat: key } : {}) };
  }

  /** `rejoining`: also send the log so far (the page may have been reloaded). */
  join(viewer: Viewer, rejoining = false) {
    this.viewers.add(viewer);
    viewer.send({ type: 'duel', duel: this.info(viewer.side) });
    if (rejoining) viewer.send({ type: 'backlog', lines: this.log });
    if (this.latest) viewer.send({ type: 'frame', frame: frameFor(this.latest, viewer.side, this.fullView) });
    if (this.pending && this.pending.side === viewer.side) viewer.send({ type: 'prompt', prompt: this.timed(this.pending.prompt) });
    if (this.ended) viewer.send({ ...this.ended, winner: seatSide(this.ended.winner, viewer.side) });
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

  /** `dropped`: the connection was lost (the seat is kept for a minute) rather than the player leaving. */
  leave(viewer: Viewer, dropped = false) {
    this.viewers.delete(viewer);
    const side = viewer.side;
    if (dropped && side !== null && this.seats.has(side) && !this.ended && ![...this.viewers].some(v => v.side === side)) {
      this.away.set(side, setTimeout(() => { this.away.delete(side); if (![...this.viewers].some(v => v.side !== null)) this.close(); }, REJOIN_MS));
      return;
    }
    if (!this.viewers.size && !this.away.size) this.close();
  }

  /** A player's answer to the prompt they were shown. Anything stale or from the wrong seat is ignored. */
  answer(viewer: Viewer, id: number, answer: PromptAnswer) {
    if (!this.pending || viewer.side !== this.pending.side || id !== this.pending.prompt.id) return;
    this.pending = null;
    this.stopClock();
    for (const v of this.viewers) if (v.side === viewer.side && v !== viewer) v.send({ type: 'prompt', prompt: null });
    this.worker.postMessage({ type: 'answer', id, answer } satisfies WorkerCommand);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
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
        for (const v of this.viewers) v.send({ ...end, winner: seatSide(end.winner, v.side) });
        this.ending = null;
      }
      return;
    }
    if ('reveal' in next) {
      for (const v of this.viewers) if (next.side === 'all' || v.side === next.side) v.send(next.reveal);
      return this.pump();
    }
    if ('prompt' in next) {
      this.pending = next;
      this.startClock(next.prompt, next.side);
      if (this.pending) for (const v of this.viewers) if (v.side === next.side) v.send({ type: 'prompt', prompt: this.timed(next.prompt) });
      return this.pump();
    }
    const f = next.frame;
    this.latest = f;
    for (const text of f.lines) this.log.push({ step: f.step, turn: f.turn, text });
    if (f.turn !== this.turn) { this.turn = f.turn; this.turnPlayer = f.turnPlayer; this.bank[f.turnPlayer] = this.seconds * 1000; }   // a fresh turn's time
    for (const v of this.viewers) v.send({ type: 'frame', frame: frameFor(f, v.side, this.fullView) });
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
    this.pending = null;
    for (const v of this.viewers) if (v.side === side) v.send({ type: 'prompt', prompt: null });
    this.worker.postMessage({ type: 'timeout', id } satisfies WorkerCommand);
  }
  /** The prompt with the time left on its clock right now. */
  private timed(prompt: Prompt): Prompt {
    if (!this.clock || this.clock.id !== prompt.id) return prompt;
    return { ...prompt, time: { left: Math.max(0, this.clock.limit - (Date.now() - this.clock.started)), turn: this.clock.turn } };
  }

  private broadcast(msg: ServerMessage) { for (const v of this.viewers) v.send(msg); }
}
