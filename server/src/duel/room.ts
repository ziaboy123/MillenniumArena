// One duel: its worker thread, the people connected to it, and paced delivery of frames.
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { DuelInfo, Frame, ServerMessage, Side } from '@arena/shared';
import { ENGINE_NAME } from '../config.ts';
import type { Deck } from '../decks.ts';
import type { WorkerInput, WorkerOutput } from './duel-worker.ts';
import { frameFor } from './visibility.ts';

export interface Viewer { side: Side | null; send(msg: ServerMessage): void }

export class DuelRoom {
  readonly id = randomUUID().slice(0, 8);
  private worker: Worker;
  private viewers = new Set<Viewer>();
  private queue: Frame[] = [];
  private latest: Frame | null = null;
  private ending: Extract<ServerMessage, { type: 'end' }> | null = null;
  private timer: NodeJS.Timeout | null = null;
  readonly startedAt = Date.now();
  closed = false;

  constructor(private decks: [Deck, Deck], private players: [string, string], readonly fullView: boolean, seed: number, private onClose: () => void) {
    const input: WorkerInput = { decks: decks.map(d => ({ name: d.name, main: d.main, extra: d.extra })) as WorkerInput['decks'], players, seed };
    this.worker = new Worker(new URL('./duel-worker.ts', import.meta.url), { workerData: input, execArgv: ['--import', 'tsx'] });
    this.worker.on('message', (msg: WorkerOutput) => {
      if (msg.type === 'frame') { this.queue.push(msg.frame); this.pump(); }
      else if (msg.type === 'end') { this.ending = { type: 'end', winner: msg.winner, reason: msg.reason, turns: msg.turns }; this.pump(); }
      else this.broadcast({ type: 'error', message: `The duel engine hit a problem: ${msg.message}` });
    });
    this.worker.on('error', err => this.broadcast({ type: 'error', message: `The duel engine crashed: ${err.message}` }));
  }

  info(side: Side | null): DuelInfo {
    return { id: this.id, players: this.players, decks: [this.decks[0].name, this.decks[1].name], you: side, fullView: this.fullView, engine: ENGINE_NAME };
  }

  join(viewer: Viewer) {
    this.viewers.add(viewer);
    viewer.send({ type: 'duel', duel: this.info(viewer.side) });
    if (this.latest) viewer.send({ type: 'frame', frame: frameFor(this.latest, viewer.side, this.fullView) });
  }

  leave(viewer: Viewer) {
    this.viewers.delete(viewer);
    if (!this.viewers.size) this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.worker.terminate();
    this.onClose();
  }

  // frames arrive from the engine much faster than people can follow, so they're played out at a watchable pace
  private pump() {
    if (this.timer || this.closed) return;
    const next = this.queue.shift();
    if (!next) {
      if (this.ending) { this.broadcast(this.ending); this.ending = null; }
      return;
    }
    this.latest = next;
    for (const v of this.viewers) v.send({ type: 'frame', frame: frameFor(next, v.side, this.fullView) });
    const wait = next.lines.length ? 650 + 380 * Math.min(next.lines.length - 1, 4) : 260;
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait);
  }

  private broadcast(msg: ServerMessage) { for (const v of this.viewers) v.send(msg); }
}
