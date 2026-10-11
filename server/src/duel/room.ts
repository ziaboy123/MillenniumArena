// One duel: its worker thread, the people connected to it, paced delivery of frames, and prompts for players.
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { DuelInfo, Frame, Prompt, PromptAnswer, ServerMessage, Side } from '@arena/shared';
import { ENGINE_NAME, PACE } from '../config.ts';
import type { Deck } from '../decks.ts';
import type { WorkerCommand, WorkerInput, WorkerOutput } from './duel-worker.ts';
import { frameFor, seat, seatSide } from './visibility.ts';

/** Someone connected to the duel: `side` is the engine side they play, or null when watching. */
export interface Viewer { side: Side | null; send(msg: ServerMessage): void }

type Queued = { frame: Frame } | { prompt: Prompt; side: Side };

export class DuelRoom {
  readonly id = randomUUID().slice(0, 8);
  private worker: Worker;
  private viewers = new Set<Viewer>();
  private queue: Queued[] = [];
  private latest: Frame | null = null;
  private pending: { prompt: Prompt; side: Side } | null = null;
  private ending: Extract<ServerMessage, { type: 'end' }> | null = null;
  private timer: NodeJS.Timeout | null = null;
  readonly startedAt = Date.now();
  closed = false;

  /** `decks` and `players` are in engine order: side 0 goes first. `humans` are the sides people play. */
  constructor(private decks: [Deck, Deck], private players: [string, string], private humans: Side[], readonly fullView: boolean, seed: number, private onClose: () => void) {
    const input: WorkerInput = { decks: decks.map(d => ({ name: d.name, main: d.main, extra: d.extra })) as WorkerInput['decks'], players, humans, seed };
    this.worker = new Worker(new URL('./duel-worker.ts', import.meta.url), { workerData: input, execArgv: ['--import', 'tsx'] });
    this.worker.on('message', (msg: WorkerOutput) => {
      if (msg.type === 'frame') { this.queue.push({ frame: msg.frame }); this.pump(); }
      else if (msg.type === 'prompt') { this.queue.push({ prompt: msg.prompt, side: msg.side }); this.pump(); }
      else if (msg.type === 'end') { this.ending = { type: 'end', winner: msg.winner, reason: msg.reason, turns: msg.turns }; this.pump(); }
      else this.broadcast({ type: 'error', message: `The duel engine hit a problem: ${msg.message}` });
    });
    this.worker.on('error', err => this.broadcast({ type: 'error', message: `The duel engine crashed: ${err.message}` }));
  }

  info(side: Side | null): DuelInfo {
    return { id: this.id, players: seat(this.players, side), decks: seat([this.decks[0].name, this.decks[1].name], side), you: side === null ? null : 0, fullView: this.fullView, engine: ENGINE_NAME };
  }

  join(viewer: Viewer) {
    this.viewers.add(viewer);
    viewer.send({ type: 'duel', duel: this.info(viewer.side) });
    if (this.latest) viewer.send({ type: 'frame', frame: frameFor(this.latest, viewer.side, this.fullView) });
    if (this.pending && this.pending.side === viewer.side) viewer.send({ type: 'prompt', prompt: this.pending.prompt });
  }

  leave(viewer: Viewer) {
    this.viewers.delete(viewer);
    if (!this.viewers.size) this.close();
  }

  /** A player's answer to the prompt they were shown. Anything stale or from the wrong seat is ignored. */
  answer(viewer: Viewer, id: number, answer: PromptAnswer) {
    if (!this.pending || viewer.side !== this.pending.side || id !== this.pending.prompt.id) return;
    this.pending = null;
    for (const v of this.viewers) if (v.side === viewer.side && v !== viewer) v.send({ type: 'prompt', prompt: null });
    this.worker.postMessage({ type: 'answer', id, answer } satisfies WorkerCommand);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
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
        for (const v of this.viewers) v.send({ ...end, winner: seatSide(end.winner, v.side) });
        this.ending = null;
      }
      return;
    }
    if ('prompt' in next) {
      this.pending = next;
      for (const v of this.viewers) if (v.side === next.side) v.send({ type: 'prompt', prompt: next.prompt });
      return this.pump();
    }
    const f = next.frame;
    this.latest = f;
    for (const v of this.viewers) v.send({ type: 'frame', frame: frameFor(f, v.side, this.fullView) });
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, this.pace(f) * PACE);
  }

  /** How long a frame stays up: watching bots is unhurried; with a person playing, their own turn moves quicker. */
  private pace(f: Frame) {
    const n = Math.min(f.lines.length, 5);
    if (!this.humans.length) return n ? 650 + 380 * (n - 1) : 260;
    if (this.humans.includes(f.turnPlayer)) return n ? 320 + 160 * (n - 1) : 90;
    return n ? 520 + 300 * (n - 1) : 180;
  }

  private broadcast(msg: ServerMessage) { for (const v of this.viewers) v.send(msg); }
}
