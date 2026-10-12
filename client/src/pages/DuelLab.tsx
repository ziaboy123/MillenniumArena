// The duel lab: duel the bot yourself, or watch two bots duel (with test setups on the development server).
// It's the Duel page until the real one (solo and private duels) is built, and the whole site when accounts are off.
import { useCallback, useEffect, useState } from 'react';
import type { DeckSummary, DuelInfo, Frame, Prompt, PromptAnswer, Responses, ServerMessage, Speed } from '@arena/shared';
import { DuelScreen, type LogRow, type Reveal } from '../duel/DuelScreen.tsx';
import { loadCards } from '../lib/cards.ts';
import { navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { useArenaSocket } from '../lib/socket.ts';
import { Eye, Stage, THEMES, useTheme } from '../lib/ui.tsx';
import { Page } from './common.tsx';

type Ending = Extract<ServerMessage, { type: 'end' }>;
type Mode = 'play' | 'watch';
type First = 'me' | 'bot' | 'random';
interface LobbyChoices { mode: Mode; name: string; deck: string; botDeck: string; first: First; watch: [string, string]; speed: Speed; timer: number; responses: Responses }

// the seat you're playing, kept for this tab so a dropped connection or a reload rejoins the same duel
const SEAT_KEY = 'ma-seat';
const savedSeat = (): { duel: string; seat: string } | null => { try { return JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null'); } catch { return null; } };
const saveSeat = (v: { duel: string; seat: string } | null) => { try { if (v) sessionStorage.setItem(SEAT_KEY, JSON.stringify(v)); else sessionStorage.removeItem(SEAT_KEY); } catch {} };

// the lobby remembers your last choices in this browser
function loadChoices(): LobbyChoices {
  const blank: LobbyChoices = { mode: 'play', name: '', deck: '', botDeck: '', first: 'random', watch: ['', ''], speed: 'normal', timer: 90, responses: 'smart' };
  try { return { ...blank, ...JSON.parse(localStorage.getItem('ma-lobby') ?? '{}') }; } catch { return blank; }
}

export function DuelLab() {
  const { me } = useSession();
  // logged in, your name, responses and bot speed come from your account (they're changed in Settings, never here)
  const account = me?.username ? { name: me.username, responses: me.settings.responses ?? 'smart', speed: me.settings.speed ?? 'normal' } : null;
  const [cardsReady, setCardsReady] = useState(false);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([]);
  const [scenario, setScenario] = useState('');
  const [ch, setCh] = useState(loadChoices);
  const [duel, setDuel] = useState<DuelInfo | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptAt, setPromptAt] = useState(0);   // when the prompt arrived, for its countdown
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);

  const { connected, send } = useArenaSocket(msg => {
    if (msg.type === 'decks') {
      setDecks(msg.decks);
      setScenarios(msg.scenarios ?? []);
      const ids = new Set(msg.decks.map(d => d.id)), def = msg.decks.find(d => d.source === 'mine')?.id ?? msg.decks[0]?.id ?? '';
      const ok = (id: string) => (ids.has(id) ? id : def);
      setCh(c => ({ ...c, deck: ok(c.deck), botDeck: ok(c.botDeck), watch: [ok(c.watch[0]), ok(c.watch[1])] }));
    } else if (msg.type === 'duel') {
      setDuel(msg.duel); setFrame(null); setPrompt(null); setReveal(null); setLog([]); setEnding(null); setError(''); setReconnecting(false);
      saveSeat(msg.duel.seat ? { duel: msg.duel.id, seat: msg.duel.seat } : null);
    }
    else if (msg.type === 'backlog') setLog(msg.lines.map(r => ({ ...r, isTurn: r.text.startsWith('Turn ') })));
    else if (msg.type === 'gone') {
      // the duel finished (or the server restarted) while we were away
      saveSeat(null); setReconnecting(false); setPrompt(null);
      if (duel) setEnding(e => e ?? { type: 'end', winner: null, reason: 'The duel ended while you were disconnected', turns: frame?.turn ?? 0 });
    }
    else if (msg.type === 'frame') {
      setFrame(msg.frame);
      const f = msg.frame;
      if (f.lines.length) setLog(l => [...l, ...f.lines.map(text => ({ step: f.step, turn: f.turn, text, isTurn: text.startsWith('Turn ') }))]);
    } else if (msg.type === 'prompt') { setPrompt(msg.prompt); setPromptAt(Date.now()); }
    else if (msg.type === 'reveal') setReveal({ ...msg, at: Date.now() });
    else if (msg.type === 'end') { setEnding(msg); setPrompt(null); saveSeat(null); }
    else if (msg.type === 'error') setError(msg.message);
  });

  useEffect(() => { loadCards().then(() => setCardsReady(true)).catch(e => setError(`Couldn't load card data (${e.message}).`)); }, []);
  // on (re)connecting: fetch decks, and rejoin the duel this tab was playing, if any
  useEffect(() => {
    if (connected) {
      send({ type: 'listDecks' });
      const s = savedSeat();
      if (s) send({ type: 'resume', duel: s.duel, seat: s.seat });
    } else if (duel && !ending) { setReconnecting(true); setPrompt(null); }
  }, [connected]);
  useEffect(() => { try { localStorage.setItem('ma-lobby', JSON.stringify(ch)); } catch {} }, [ch]);
  // a glimpse of a revealed card closes itself; looking at hidden cards stays until closed
  useEffect(() => { if (!reveal?.brief) return; const t = setTimeout(() => setReveal(null), 3500); return () => clearTimeout(t); }, [reveal]);

  const closeReveal = useCallback(() => setReveal(null), []);
  const answer = (a: PromptAnswer) => { if (prompt) { send({ type: 'answer', id: prompt.id, answer: a }); setPrompt(null); } };
  const surrender = () => { send({ type: 'leave' }); saveSeat(null); setPrompt(null); setEnding({ type: 'end', winner: 1, reason: 'You surrendered', turns: frame?.turn ?? 0 }); };
  const leave = () => { send({ type: 'leave' }); saveSeat(null); setDuel(null); setPrompt(null); setReconnecting(false); if (account) navigate('/home'); };

  if (duel && cardsReady) return <DuelScreen duel={duel} frame={frame} log={log} ending={ending} prompt={prompt} promptAt={promptAt} onAnswer={answer}
    reveal={reveal} onCloseReveal={closeReveal} onSurrender={surrender} onLeave={leave} reconnecting={reconnecting} />;

  const ready = connected && cardsReady && decks.length > 0;
  const start = () => ch.mode === 'play'
    ? send({ type: 'play', deck: ch.deck, botDeck: ch.botDeck, first: ch.first, timer: ch.timer, ...(account ?? { name: ch.name, speed: ch.speed, responses: ch.responses }), ...(scenario ? { scenario } : {}) })
    : send({ type: 'watch', decks: ch.watch, fullView: true, speed: account?.speed ?? ch.speed });
  const seg = <T extends string | number>(value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="seg">{options.map(([k, label]) => <button key={String(k)} className={value === k ? 'on' : ''} onClick={() => set(k)}>{label}</button>)}</div>
  );
  const speedRow = !account && (
    <div className="lobby-row"><span>Bot speed</span>
      {seg<Speed>(ch.speed, [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], speed => setCh(c => ({ ...c, speed })))}</div>
  );
  const lobby = (
    <div className="panel lobby-card">
      <div className="lobby-tabs">
        <button className={ch.mode === 'play' ? 'on' : ''} onClick={() => setCh(c => ({ ...c, mode: 'play' }))}>Duel the bot</button>
        <button className={ch.mode === 'watch' ? 'on' : ''} onClick={() => setCh(c => ({ ...c, mode: 'watch' }))}>Watch two bots</button>
      </div>
      {ch.mode === 'play' ? <>
        <p>You against the bot on the real rules engine. It plays sensibly (good attacks, sensible targets) but doesn't know any deck's combos.</p>
        {!account && <label className="lobby-row"><span>Name</span>
          <input value={ch.name} maxLength={16} placeholder="Duelist" onChange={e => setCh(c => ({ ...c, name: e.target.value }))} /></label>}
        <label className="lobby-row"><span>Your deck</span><DeckSelect decks={decks} value={ch.deck} onChange={deck => setCh(c => ({ ...c, deck }))} /></label>
        <label className="lobby-row"><span>Bot's deck</span><DeckSelect decks={decks} value={ch.botDeck} onChange={botDeck => setCh(c => ({ ...c, botDeck }))} /></label>
        <div className="lobby-row"><span>First</span>
          {seg<First>(ch.first, [['me', 'You go first'], ['bot', 'Bot goes first'], ['random', 'Coin toss']], first => setCh(c => ({ ...c, first })))}</div>
        <div className="lobby-row"><span>Turn timer</span>
          {seg<number>(ch.timer, [[0, 'Off'], [60, '60 s'], [90, '90 s'], [180, '180 s']], timer => setCh(c => ({ ...c, timer })))}</div>
        {!account && <div className="lobby-row"><span>Responses</span>
          {seg<Responses>(ch.responses, [['smart', 'Smart: skip my own actions'], ['always', 'Always ask']], responses => setCh(c => ({ ...c, responses })))}</div>}
        {speedRow}
        {scenarios.length > 0 && <label className="lobby-row"><span>Test setup</span>
          <select value={scenario} onChange={e => setScenario(e.target.value)}><option value="">None (normal duel)</option>{scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      </> : <>
        <p>Two bots duel live on the real engine, with every card visible. Good for checking cards and the engine.</p>
        {(['Bot A', 'Bot B'] as const).map((who, i) => (
          <label key={who} className="lobby-row"><span>{who}</span>
            <DeckSelect decks={decks} value={ch.watch[i]} onChange={id => setCh(c => ({ ...c, watch: i === 0 ? [id, c.watch[1]] : [c.watch[0], id] }))} /></label>
        ))}
        {speedRow}
      </>}
      <button className="bigbtn" disabled={!ready} onClick={start}>{ch.mode === 'play' ? 'Start duel' : 'Watch duel'}</button>
      <div className="lobby-status">{error ? <span className="bad">{error}</span> : !connected ? 'Connecting to the duel server…' : !cardsReady ? 'Loading card data…' : `${decks.length} decks ready`}</div>
      {account ? <div className="lobby-status">Responses and bot speed come from Settings.</div> : <ThemeButtons />}
    </div>
  );
  if (account) return <Page back="/home" className="center">{lobby}</Page>;
  return (
    <Stage>
      <div className="lobby">
        <div className="logo"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></div>
        {lobby}
      </div>
    </Stage>
  );
}

function ThemeButtons() {
  const [theme, setTheme] = useTheme();
  return <div className="lobby-themes">{THEMES.map(t => <button key={t.k} className={theme === t.k ? 'on' : ''} onClick={() => setTheme(t.k)}>{t.name}</button>)}</div>;
}

function DeckSelect({ decks, value, onChange }: { decks: DeckSummary[]; value: string; onChange: (id: string) => void }) {
  const label = (d: DeckSummary) => `${d.name} · ${d.main}+${d.extra}`;
  const groups = (['mine', 'tournament'] as const).map(src => decks.filter(d => d.source === src));
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {groups.map((g, gi) => g.length > 0 && <optgroup key={gi} label={gi === 0 ? 'Our decks' : 'Recent tournament decks'}>{g.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}</optgroup>)}
    </select>
  );
}
