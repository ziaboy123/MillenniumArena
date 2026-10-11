// Milestone 1: pick two decks, then watch two bots duel live on the real engine.
import { useEffect, useState } from 'react';
import type { DeckSummary, DuelInfo, Frame, ServerMessage } from '@arena/shared';
import { DuelScreen, type LogRow } from './duel/DuelScreen.tsx';
import { loadCards } from './lib/cards.ts';
import { useArenaSocket } from './lib/socket.ts';
import { Background, Eye, Stage, THEMES, useTheme } from './lib/ui.tsx';

type Ending = Extract<ServerMessage, { type: 'end' }>;

export function App() {
  const [theme, setTheme] = useTheme();
  const [cardsReady, setCardsReady] = useState(false);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [picks, setPicks] = useState<[string, string]>(['', '']);
  const [duel, setDuel] = useState<DuelInfo | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [error, setError] = useState('');

  const { connected, send } = useArenaSocket(msg => {
    if (msg.type === 'decks') {
      setDecks(msg.decks);
      const def = msg.decks.find(d => d.source === 'mine')?.id ?? msg.decks[0]?.id ?? '';
      setPicks(p => [p[0] || def, p[1] || def]);
    } else if (msg.type === 'duel') { setDuel(msg.duel); setFrame(null); setLog([]); setEnding(null); setError(''); }
    else if (msg.type === 'frame') {
      setFrame(msg.frame);
      const f = msg.frame;
      if (f.lines.length) setLog(l => [...l, ...f.lines.map(text => ({ step: f.step, turn: f.turn, text, isTurn: text.startsWith('Turn ') }))]);
    } else if (msg.type === 'end') setEnding(msg);
    else if (msg.type === 'error') setError(msg.message);
  });

  useEffect(() => { loadCards().then(() => setCardsReady(true)).catch(e => setError(`Couldn't load card data (${e.message}).`)); }, []);
  useEffect(() => { if (connected) send({ type: 'listDecks' }); }, [connected]);

  if (duel && cardsReady) return <DuelScreen duel={duel} frame={frame} log={log} ending={ending} onLeave={() => { send({ type: 'leave' }); setDuel(null); }} />;

  const label = (d: DeckSummary) => `${d.name} · ${d.main}+${d.extra}${d.source === 'tournament' ? ' · tournament' : ''}`;
  const groups = (['mine', 'tournament'] as const).map(src => decks.filter(d => d.source === src));
  return (
    <Stage>
      <Background />
      <div className="lobby">
        <div className="logo"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></div>
        <div className="panel lobby-card">
          <div className="eyebrow">Milestone 1 · engine test</div>
          <h1>Watch two bots duel</h1>
          <p>Pick a deck for each side. The real engine plays the whole duel live, with every card visible.</p>
          {(['Bot A', 'Bot B'] as const).map((who, i) => (
            <label key={who} className="lobby-row"><span>{who}</span>
              <select value={picks[i]} onChange={e => setPicks(p => (i === 0 ? [e.target.value, p[1]] : [p[0], e.target.value]))}>
                {groups.map((g, gi) => g.length > 0 && <optgroup key={gi} label={gi === 0 ? 'Our decks' : 'Recent tournament decks'}>{g.map(d => <option key={d.id} value={d.id}>{label(d)}</option>)}</optgroup>)}
              </select>
            </label>
          ))}
          <button className="bigbtn" disabled={!connected || !cardsReady || !picks[0]} onClick={() => send({ type: 'watch', decks: picks, fullView: true })}>Start duel</button>
          <div className="lobby-status">{error ? <span className="bad">{error}</span> : !connected ? 'Connecting to the duel server…' : !cardsReady ? 'Loading card data…' : `${decks.length} decks ready`}</div>
          <div className="lobby-themes">{THEMES.map(t => <button key={t.k} className={theme === t.k ? 'on' : ''} onClick={() => setTheme(t.k)}>{t.name}</button>)}</div>
        </div>
      </div>
    </Stage>
  );
}
