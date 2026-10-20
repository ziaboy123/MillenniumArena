// The duel on screen, kept up to date from the server's messages. Used by the Duel page and the duel lab.
import { useCallback, useEffect, useState } from 'react';
import type { DuelInfo, Frame, Prompt, ServerMessage, Side } from '@arena/shared';
import type { LogRow, Reveal } from './DuelScreen.tsx';

export type Ending = Extract<ServerMessage, { type: 'end' }>;
/** Duels between people: the player the duel is waiting on (not you), their clock when it was sent, and when that was. */
export type Waiting = { side: Side; time?: { left: number; turn: boolean }; at: number };

// a bot duel's seat, kept for this tab so a dropped connection or a reload rejoins it (private rooms find you by your login)
const SEAT_KEY = 'ma-seat';
export const savedSeat = (): { duel: string; seat: string } | null => { try { return JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null'); } catch { return null; } };
export const saveSeat = (v: { duel: string; seat: string } | null) => { try { if (v) sessionStorage.setItem(SEAT_KEY, JSON.stringify(v)); else sessionStorage.removeItem(SEAT_KEY); } catch {} };

/** `keepSeat`: remember the seat for this tab (bot duels; private rooms find you by your login instead). */
export function useDuel({ keepSeat }: { keepSeat: boolean | (() => boolean) }) {
  const keep = () => (typeof keepSeat === 'function' ? keepSeat() : keepSeat);
  const [duel, setDuel] = useState<DuelInfo | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptAt, setPromptAt] = useState(0);   // when the prompt arrived, for its countdown
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  /** Handles a duel message; false if it's something else. */
  const handle = (msg: ServerMessage): boolean => {
    switch (msg.type) {
      case 'duel':
        setDuel(msg.duel); setFrame(null); setPrompt(null); setReveal(null); setLog([]); setEnding(null); setReconnecting(false); setWaiting(null);
        if (keep()) saveSeat(msg.duel.seat ? { duel: msg.duel.id, seat: msg.duel.seat } : null);
        return true;
      case 'backlog': setLog(msg.lines.map(r => ({ ...r, isTurn: r.text.startsWith('Turn ') }))); return true;
      case 'gone':
        // the duel finished (or the server restarted) while we were away
        saveSeat(null); setReconnecting(false); setPrompt(null); setWaiting(null);
        if (duel) setEnding(e => e ?? { type: 'end', winner: null, reason: 'The duel ended while you were disconnected', turns: frame?.turn ?? 0 });
        return true;
      case 'frame': {
        const f = msg.frame;
        setFrame(f);
        if (f.lines.length) setLog(l => [...l, ...f.lines.map(text => ({ step: f.step, turn: f.turn, text, isTurn: text.startsWith('Turn ') }))]);
        return true;
      }
      case 'prompt': setPrompt(msg.prompt); setPromptAt(Date.now()); return true;
      case 'waiting': setWaiting(msg.side === null ? null : { side: msg.side, ...(msg.time ? { time: msg.time } : {}), at: Date.now() }); return true;
      case 'reveal': setReveal({ ...msg, at: Date.now() }); return true;
      case 'end': setEnding(msg); setPrompt(null); setWaiting(null); if (keep()) saveSeat(null); return true;
      default: return false;
    }
  };

  // a glimpse of a revealed card closes itself; looking at hidden cards stays until closed
  useEffect(() => { if (!reveal?.brief) return; const t = setTimeout(() => setReveal(null), 3500); return () => clearTimeout(t); }, [reveal]);
  const closeReveal = useCallback(() => setReveal(null), []);
  /** Off the duel screen (left, or back to the room). */
  const clear = () => { setDuel(null); setFrame(null); setPrompt(null); setReveal(null); setLog([]); setEnding(null); setReconnecting(false); setWaiting(null); };
  /** The connection dropped mid-duel: show it, and take back any prompt (it's asked again after rejoining). */
  const dropped = () => { if (duel && !ending) { setReconnecting(true); setPrompt(null); setWaiting(null); } };

  return { duel, frame, prompt, promptAt, reveal, log, ending, reconnecting, waiting, handle, clear, dropped, closeReveal, setPrompt, setEnding };
}
