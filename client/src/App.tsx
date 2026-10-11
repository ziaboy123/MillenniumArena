// The test lobby while the real pages are built: duel the bot yourself (Milestone 2), or watch two bots duel.
import { useEffect, useState } from 'react';
import type { DeckSummary, DuelInfo, Frame, Prompt, PromptAnswer, ServerMessage } from '@arena/shared';
import { DuelScreen, type LogRow } from './duel/DuelScreen.tsx';
import { loadCards } from './lib/cards.ts';
import { useArenaSocket } from './lib/socket.ts';
import { Background, Eye, Stage, THEMES, useTheme } from './lib/ui.tsx';

type Ending = Extract<ServerMessage, { type: 'end' }>;
type Mode = 'play' | 'watch';
type First = 'me' | 'bot' | 'random';
interface LobbyChoices { mode: Mode; name: string; deck: string; botDeck: string; first: First; watch: [string, string] }

// the lobby remembers your last choices in this browser
function loadChoices(): LobbyChoices {
  const blank: LobbyChoices = { mode: 'play', name: '', deck: '', botDeck: '', first: 'random', watch: ['', ''] };
  try { return { ...blank, ...JSON.parse(localStorage.getItem('ma-lobby') ?? '{}') }; } catch { return blank; }
}

export function App() {
  const [theme, setTheme] = useTheme();
  const [cardsReady, setCardsReady] = useState(false);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [ch, setCh] = useState(loadChoices);
  const [duel, setDuel] = useState<DuelInfo | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [error, setError] = useState('');

  const { connected, send } = useArenaSocket(msg => {
    if (msg.type === 'decks') {
      setDecks(msg.decks);
      const ids = new Set(msg.decks.map(d => d.id)), def = msg.decks.find(d => d.source === 'mine')?.id ?? msg.decks[0]?.id ?? '';
      const ok = (id: string) => (ids.has(id) ? id : def);
      setCh(c => ({ ...c, deck: ok(c.deck), botDeck: ok(c.botDeck), watch: [ok(c.watch[0]), ok(c.watch[1])] }));
    } else if (msg.type === 'duel') { setDuel(msg.duel); setFrame(null); setPrompt(null); setLog([]); setEnding(null); setError(''); }
    else if (msg.type === 'frame') {
      setFrame(msg.frame);
      const f = msg.frame;
      if (f.lines.length) setLog(l => [...l, ...f.lines.map(text => ({ step: f.step, turn: f.turn, text, isTurn: text.startsWith('Turn ') }))]);
    } else if (msg.type === 'prompt') setPrompt(msg.prompt);
    else if (msg.type === 'end') { setEnding(msg); setPrompt(null); }
    else if (msg.type === 'error') setError(msg.message);
  });

  useEffect(() => { loadCards().then(() => setCardsReady(true)).catch(e => setError(`Couldn't load card data (${e.message}).`)); }, []);
  useEffect(() => { if (connected) send({ type: 'listDecks' }); }, [connected]);
  // a dropped connection ends the duel for now (rejoining a running duel comes later)
  useEffect(() => {
    if (!connected && duel && !ending) { setPrompt(null); setEnding({ type: 'end', winner: null, reason: 'The connection to the duel server was lost', turns: frame?.turn ?? 0 }); }
  }, [connected]);
  useEffect(() => { try { localStorage.setItem('ma-lobby', JSON.stringify(ch)); } catch {} }, [ch]);

  const answer = (a: PromptAnswer) => { if (prompt) { send({ type: 'answer', id: prompt.id, answer: a }); setPrompt(null); } };
  const surrender = () => { send({ type: 'leave' }); setPrompt(null); setEnding({ type: 'end', winner: 1, reason: 'You surrendered', turns: frame?.turn ?? 0 }); };
  const leave = () => { send({ type: 'leave' }); setDuel(null); setPrompt(null); };

  if (duel && cardsReady) return <DuelScreen duel={duel} frame={frame} log={log} ending={ending} prompt={prompt} onAnswer={answer} onSurrender={surrender} onLeave={leave} />;

  const ready = connected && cardsReady && decks.length > 0;
  const start = () => ch.mode === 'play'
    ? send({ type: 'play', deck: ch.deck, botDeck: ch.botDeck, first: ch.first, name: ch.name })
    : send({ type: 'watch', decks: ch.watch, fullView: true });
  return (
    <Stage>
      <Background />
      <div className="lobby">
        <div className="logo"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></div>
        <div className="panel lobby-card">
          <div className="lobby-tabs">
            <button className={ch.mode === 'play' ? 'on' : ''} onClick={() => setCh(c => ({ ...c, mode: 'play' }))}>Duel the bot</button>
            <button className={ch.mode === 'watch' ? 'on' : ''} onClick={() => setCh(c => ({ ...c, mode: 'watch' }))}>Watch two bots</button>
          </div>
          {ch.mode === 'play' ? <>
            <p>You against a simple bot on the real rules engine. It plays legally but not well yet.</p>
            <label className="lobby-row"><span>Name</span>
              <input value={ch.name} maxLength={16} placeholder="Duelist" onChange={e => setCh(c => ({ ...c, name: e.target.value }))} /></label>
            <label className="lobby-row"><span>Your deck</span><DeckSelect decks={decks} value={ch.deck} onChange={deck => setCh(c => ({ ...c, deck }))} /></label>
            <label className="lobby-row"><span>Bot's deck</span><DeckSelect decks={decks} value={ch.botDeck} onChange={botDeck => setCh(c => ({ ...c, botDeck }))} /></label>
            <div className="lobby-row"><span>First</span>
              <div className="seg">{([['me', 'You go first'], ['bot', 'Bot goes first'], ['random', 'Coin toss']] as [First, string][]).map(([k, label]) =>
                <button key={k} className={ch.first === k ? 'on' : ''} onClick={() => setCh(c => ({ ...c, first: k }))}>{label}</button>)}</div>
            </div>
          </> : <>
            <p>Two bots duel live on the real engine, with every card visible. Good for checking cards and the engine.</p>
            {(['Bot A', 'Bot B'] as const).map((who, i) => (
              <label key={who} className="lobby-row"><span>{who}</span>
                <DeckSelect decks={decks} value={ch.watch[i]} onChange={id => setCh(c => ({ ...c, watch: i === 0 ? [id, c.watch[1]] : [c.watch[0], id] }))} /></label>
            ))}
          </>}
          <button className="bigbtn" disabled={!ready} onClick={start}>{ch.mode === 'play' ? 'Start duel' : 'Watch duel'}</button>
          <div className="lobby-status">{error ? <span className="bad">{error}</span> : !connected ? 'Connecting to the duel server…' : !cardsReady ? 'Loading card data…' : `${decks.length} decks ready`}</div>
          <div className="lobby-themes">{THEMES.map(t => <button key={t.k} className={theme === t.k ? 'on' : ''} onClick={() => setTheme(t.k)}>{t.name}</button>)}</div>
        </div>
      </div>
    </Stage>
  );
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
