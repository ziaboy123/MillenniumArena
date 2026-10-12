// The Duel page (from design/duel.html): Private duels (host a room, or join one with its code or invite link),
// Solo vs the bot, and Ranked/Unranked as "coming soon". In a room it shows the room (Room.tsx); in a game, the duel
// screen. The connection to the duel server lives here, so a reload finds your room or bot duel again.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_RULES, type ChatLine, type DeckSummary, type PromptAnswer, type RoomPreview, type RoomRules, type RoomView } from '@arena/shared';
import { deckBlocker, type Banlist, type SavedDeck } from '@arena/shared/decks';
import { DuelScreen } from '../duel/DuelScreen.tsx';
import { saveSeat, savedSeat, useDuel } from '../duel/useDuel.ts';
import { api } from '../lib/api.ts';
import { loadCards } from '../lib/cards.ts';
import { loadBanlists, ruleCard } from '../lib/decks.ts';
import { navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { useArenaSocket } from '../lib/socket.ts';
import { Icon, Page, useToast } from './common.tsx';
import { DeckPicker } from './DeckPicker.tsx';
import { message, type DeckData } from './Decks.tsx';
import { RoomScreen, RuleChips } from './Room.tsx';

type View = 'menu' | 'solo' | 'host';
type Banlists = { TCG: Banlist | null; OCG: Banlist | null };
const stored = <T,>(key: string, fallback: T): T => { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return fallback; } };
const store = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };

export function DuelPage({ joinCode }: { joinCode?: string }) {
  const { me } = useSession();
  const roomRef = useRef<RoomView | null>(null);
  const d = useDuel({ keepSeat: () => !roomRef.current });   // bot duels keep their seat for a reload; rooms find you by your login
  const [room, setRoomState] = useState<RoomView | null>(null);
  const setRoom = (r: RoomView | null) => { roomRef.current = r; setRoomState(r); };
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [preview, setPreview] = useState<{ code: string; preview: RoomPreview | null } | null>(null);
  const [view, setView] = useState<View>('menu');
  const [notice, setNotice] = useState('');
  const [showDuel, setShowDuel] = useState(true);
  const leaving = useRef(false);   // you asked to leave the room (so its going away needs no explanation)
  const leaveRoom = () => { leaving.current = true; send({ type: 'room.leave' }); };
  const [toast, showToast] = useToast();
  const [data, setData] = useState<DeckData | null>(null);
  const [banlists, setBanlists] = useState<Banlists | null>(null);
  const [botDecks, setBotDecks] = useState<DeckSummary[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadCards(), loadBanlists()]).then(([, b]) => setBanlists(b)).catch(() => setNotice("Couldn't load the card data. Refresh to try again."));
    api<DeckData>('decks/list').then(setData).catch(e => setNotice(message(e)));
  }, []);
  const decks = data?.decks ?? [];
  const blockerFor = (rules: Pick<RoomRules, 'banlist' | 'check'> | null) => (x: SavedDeck) => (banlists ? deckBlocker(x, ruleCard, banlists, rules) : null);
  // your deck: "Dueling with" if it can be used against the bot, else the first that can
  useEffect(() => {
    if (!data || !banlists || deckId) return;
    const ok = (x?: SavedDeck) => x && !blockerFor(null)(x);
    setDeckId((ok(data.decks.find(x => x.id === data.active)) ? data.active : data.decks.find(x => ok(x))?.id) ?? data.decks[0]?.id ?? null);
  }, [data, banlists]);   // eslint-disable-line react-hooks/exhaustive-deps

  const { connected, send } = useArenaSocket(msg => {
    if (d.handle(msg)) { if (msg.type === 'duel') setShowDuel(true); return; }
    switch (msg.type) {
      case 'decks': setBotDecks(msg.decks.filter(x => x.source !== 'account')); break;
      case 'room':
        if (!msg.room && roomRef.current) {
          d.clear(); setChat([]); setView('menu');
          if (!leaving.current) setNotice("That room isn't open any more.");
        }
        if (msg.room) leaving.current = false;
        setRoom(msg.room);
        if (msg.room) setPreview(null);
        break;
      case 'room.preview': setPreview({ code: msg.code, preview: msg.preview }); break;
      case 'room.closed': setRoom(null); d.clear(); setChat([]); setNotice(msg.reason); setView('menu'); break;
      case 'chat': setChat(c => (msg.reset ? msg.lines : [...c, ...msg.lines])); break;
      case 'error': showToast(msg.message); break;
    }
  });
  // on (re)connecting: the bot decks, then back into your room or bot duel (if any), or look up an invite link's room
  useEffect(() => {
    if (!connected) { d.dropped(); return; }
    send({ type: 'listDecks' });
    send({ type: 'room.resume' });
    const s = savedSeat();
    if (s) send({ type: 'resume', duel: s.duel, seat: s.seat });
    if (joinCode) send({ type: 'room.peek', code: joinCode });
  }, [connected]);   // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (a: PromptAnswer) => { if (d.prompt) { send({ type: 'answer', id: d.prompt.id, answer: a }); d.setPrompt(null); } };

  // ---------- in a game ----------
  if (d.duel && banlists && showDuel && (!room || room.phase === 'dueling' || d.ending)) {
    if (room) {
      const [host, guest] = room.players;
      const line = room.rules.bo === 3 ? `Game ${room.game} of 3 · ${host.name} ${host.wins}-${guest?.wins ?? 0} ${guest?.name ?? ''}` : 'Private duel';
      return <DuelScreen duel={d.duel} frame={d.frame} log={d.log} ending={d.ending} prompt={d.prompt} promptAt={d.promptAt} onAnswer={answer}
        reveal={d.reveal} onCloseReveal={d.closeReveal} reconnecting={d.reconnecting} matchLine={line}
        chat={{ lines: chat, name: me?.username ?? '', onSend: text => send({ type: 'chat', text }) }}
        leaveText={room.rules.bo === 3 ? 'Leaving the room ends the match, and counts as a loss.' : 'Leaving the room ends the duel, and counts as a loss.'}
        onSurrender={() => send({ type: 'room.surrender' })}
        onLeave={() => { leaveRoom(); d.clear(); navigate('/home'); }}
        endAction={{ label: room.phase === 'over' ? 'See the result' : 'Continue', run: () => setShowDuel(false) }} />;
    }
    return <DuelScreen duel={d.duel} frame={d.frame} log={d.log} ending={d.ending} prompt={d.prompt} promptAt={d.promptAt} onAnswer={answer}
      reveal={d.reveal} onCloseReveal={d.closeReveal} reconnecting={d.reconnecting}
      onSurrender={() => { send({ type: 'surrender' }); d.setPrompt(null); }}
      onLeave={() => { send({ type: 'leave' }); saveSeat(null); d.clear(); navigate('/home'); }}
      endAction={{ label: 'Back to Solo', run: () => { send({ type: 'leave' }); d.clear(); setView('solo'); } }} />;
  }

  // ---------- in a room ----------
  if (room) {
    const mine = room.players.find(p => p?.you)?.deck?.name;
    const roomDeck = decks.find(x => x.name === mine)?.id ?? deckId;
    const sendRoom: typeof send = m => { if (m.type === 'room.leave') leaving.current = true; send(m); };
    return <RoomScreen room={room} decks={decks} deckId={roomDeck} blocker={blockerFor(room.rules)} send={sendRoom} toast={toast} showToast={showToast} />;
  }

  const picker = (rules: Pick<RoomRules, 'banlist' | 'check'> | null) => <DeckPicker decks={decks} value={deckId} onChange={setDeckId} blocker={blockerFor(rules)} />;
  const ready = !!data && !!banlists && connected;
  if (view === 'solo') return <SoloView picker={picker(null)} deck={decks.find(x => x.id === deckId) ?? null} blocked={!!(deckId && decks.find(x => x.id === deckId) && blockerFor(null)(decks.find(x => x.id === deckId)!))}
    botDecks={botDecks} ready={ready} onBack={() => setView('menu')} toast={toast}
    onStart={(botDeck, first, timer) => send({ type: 'play', deck: `acct:${deckId}`, botDeck, first, timer, speed: me?.settings.speed ?? 'normal', responses: me?.settings.responses ?? 'smart' })} />;
  if (view === 'host') return <HostView decks={decks} deckId={deckId} setDeckId={setDeckId} blockerFor={blockerFor} ready={ready} onBack={() => setView('menu')} toast={toast}
    onCreate={(rules, password) => deckId && send({ type: 'room.create', rules, password, deck: deckId })} />;
  return <MenuView picker={picker(null)} ready={ready} notice={notice} preview={preview} joinCode={joinCode} toast={toast}
    blockerFor={blockerFor} deck={decks.find(x => x.id === deckId) ?? null}
    onHost={() => { setNotice(''); setView('host'); }} onSolo={() => { setNotice(''); setView('solo'); }}
    onPeek={code => { setNotice(''); send({ type: 'room.peek', code }); }} onClearPreview={() => setPreview(null)}
    onJoin={(code, password) => deckId && send({ type: 'room.join', code, password, deck: deckId })}
    onWatch={(code, password) => send({ type: 'room.watch', code, password })} />;
}

// ---------- the menu: Private duels (host / join), Solo vs bot, coming soon ----------
function MenuView({ picker, ready, notice, preview, joinCode, toast, blockerFor, deck, onHost, onSolo, onPeek, onClearPreview, onJoin, onWatch }: {
  picker: React.ReactNode; ready: boolean; notice: string; preview: { code: string; preview: RoomPreview | null } | null; joinCode?: string; toast: React.ReactNode;
  blockerFor: (rules: Pick<RoomRules, 'banlist' | 'check'> | null) => (d: SavedDeck) => string | null; deck: SavedDeck | null;
  onHost: () => void; onSolo: () => void; onPeek: (code: string) => void; onClearPreview: () => void;
  onJoin: (code: string, password: string) => void; onWatch: (code: string, password: string) => void;
}) {
  const [code, setCode] = useState(joinCode?.toUpperCase().slice(0, 6) ?? '');
  const [password, setPassword] = useState('');
  const found = preview && preview.code === code && preview.preview;
  const why = found && deck ? blockerFor(found.rules)(deck) : null;
  return (
    <Page back="/home" className="duelpage" over={toast}>
      <div className="dhead"><div className="head"><div className="eyebrow">Play</div><h1>Duel</h1></div></div>
      {notice && <div className="panel notice">{notice}</div>}
      <div className="dgrid2 menu">
        <div className="panel private">
          <span className="live"><i />Private duels</span>
          <h2>Play with friends</h2>
          <p className="d">Host a room and send your friend the code, or join their room with theirs.</p>
          <div className="split">
            <div className="col">
              <div className="ico"><Icon name="crown" /></div>
              <h3 className="t">Host a room</h3>
              <p className="d">Pick the rules (best of 3, turn timer, banlist and more), then send your friend the code.</p>
              <button className="bigbtn" disabled={!ready} onClick={onHost}>Host a room</button>
            </div>
            <div className="or"><span>or</span></div>
            <div className="col join">
              {!found ? <>
                <div className="ico"><Icon name="join" /></div>
                <h3 className="t">Join a room</h3>
                <p className="d">Enter the 6-character code your friend sent you.</p>
                <form className="codeform" onSubmit={e => { e.preventDefault(); if (code.length === 6) onPeek(code); }}>
                  <input className="roomcode" value={code} maxLength={6} spellCheck={false} autoComplete="off" placeholder="K7Q2XM" aria-label="Room code"
                    onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); onClearPreview(); }} />
                  <button className="bigbtn ghost" disabled={!ready || code.length !== 6}>Find room</button>
                </form>
                <div className={`msg ${preview?.code === code && !preview.preview ? 'bad' : ''}`}>
                  {preview?.code === code && !preview.preview ? 'No room has that code. Check it with your friend.' : 'If their duel has already started, you can ask to watch instead.'}
                </div>
              </> : <>
                <div className="eyebrow">Room found · {code}</div>
                <h3 className="t">{found.host}'s room</h3>
                <p className="d">{found.state === 'open' ? "Waiting for an opponent. These are the host's rules:" : found.state === 'full' ? 'This room already has two duelists.' : 'Their duel has already started.'}</p>
                <RuleChips rules={found.rules} password={found.password} />
                {found.password && <input className="sinput" type="password" placeholder="Room password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" />}
                {found.state === 'open' && why && <div className="msg bad">{why}</div>}
                <div className="line">
                  {found.state === 'open'
                    ? <button className="bigbtn" disabled={!deck || !!why || (found.password && !password)} onClick={() => onJoin(code, password)}>Join room</button>
                    : found.rules.spectators === 'ask'
                      ? <button className="bigbtn" disabled={found.password && !password} onClick={() => onWatch(code, password)}>Ask to watch</button>
                      : <span className="msg">This room doesn't allow spectators.</span>}
                  <button className="bigbtn ghost" onClick={() => { onClearPreview(); setCode(''); }}>Back</button>
                </div>
              </>}
            </div>
          </div>
          <div className="deckbar"><span className="lbl">Dueling with</span>{picker}</div>
        </div>

        <div className="col-stack">
          <button className="panel modetile live-tile" disabled={!ready} onClick={onSolo}>
            <div className="ico"><Icon name="bot" /></div>
            <div><h3 className="t">Solo vs bot</h3><p className="d">Practise a deck against the AI, any time. It plays sensibly but doesn't know any deck's combos.</p></div>
            <span className="badge live">Play</span>
          </button>
          <div className="panel modetile"><div className="ico"><Icon name="trophy" /></div><div><h3 className="t">Ranked</h3><p className="d">Rated matchmaking. Climb the ladder and earn your rank.</p></div><span className="badge">Coming soon</span></div>
          <div className="panel modetile"><div className="ico"><Icon name="swords" /></div><div><h3 className="t">Unranked</h3><p className="d">Quick matchmaking against anyone, no rating on the line.</p></div><span className="badge">Coming soon</span></div>
        </div>
      </div>
    </Page>
  );
}

// ---------- solo vs the bot ----------
type First = 'me' | 'bot' | 'random';
function SoloView({ picker, deck, blocked, botDecks, ready, onBack, onStart, toast }: {
  picker: React.ReactNode; deck: SavedDeck | null; blocked: boolean; botDecks: DeckSummary[]; ready: boolean; toast: React.ReactNode;
  onBack: () => void; onStart: (botDeck: string, first: First, timer: number) => void;
}) {
  const [opts, setOpts] = useState(() => stored('ma-solo', { botDeck: '', first: 'random' as First, timer: 90 }));
  useEffect(() => store('ma-solo', opts), [opts]);
  const botDeck = botDecks.some(x => x.id === opts.botDeck) ? opts.botDeck : botDecks.find(x => x.source === 'mine')?.id ?? botDecks[0]?.id ?? '';
  const seg = <T extends string | number>(value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="seg">{options.map(([k, label]) => <button key={String(k)} className={value === k ? 'on' : ''} onClick={() => set(k)}>{label}</button>)}</div>
  );
  return (
    <Page back="/home" className="duelpage" over={toast}>
      <div className="dhead"><div className="head"><button className="crumb" onClick={onBack}>← Duel</button><h1>Solo vs bot</h1></div></div>
      <div className="dgrid2">
        <div className="panel rules">
          <div className="eyebrow">The duel</div>
          <div className="srow"><div className="l"><b>Your deck</b><span>Any of your decks that's the right size.</span></div><div className="r">{picker}</div></div>
          <div className="srow"><div className="l"><b>The bot's deck</b><span>Our decks and recent tournament decks.</span></div>
            <div className="r"><select className="sinput" value={botDeck} onChange={e => setOpts(o => ({ ...o, botDeck: e.target.value }))}>
              {(['mine', 'tournament'] as const).map(src => {
                const list = botDecks.filter(x => x.source === src);
                return list.length > 0 && <optgroup key={src} label={src === 'mine' ? 'Our decks' : 'Recent tournament decks'}>{list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>;
              })}
            </select></div></div>
          <div className="srow"><div className="l"><b>Who goes first</b><span>A coin toss, or pick.</span></div><div className="r">{seg<First>(opts.first, [['random', 'Coin toss'], ['me', 'You'], ['bot', 'The bot']], first => setOpts(o => ({ ...o, first })))}</div></div>
          <div className="srow"><div className="l"><b>Turn timer</b><span>Time you get per turn.</span></div><div className="r">{seg<number>(opts.timer, [[0, 'Off'], [60, '60s'], [90, '90s'], [180, '180s']], timer => setOpts(o => ({ ...o, timer })))}</div></div>
          <p className="d">Responses and the bot's speed come from Settings.</p>
        </div>
        <div className="panel summary">
          <div className="eyebrow">Ready?</div>
          <p className="d">{deck ? `${deck.name} against the bot.` : 'Pick a deck first.'}</p>
          <button className="bigbtn" disabled={!ready || !deck || blocked || !botDeck} onClick={() => onStart(botDeck, opts.first, opts.timer)}>Start duel</button>
        </div>
      </div>
    </Page>
  );
}

// ---------- hosting: the room's rules ----------
function HostView({ decks, deckId, setDeckId, blockerFor, ready, onBack, onCreate, toast }: {
  decks: SavedDeck[]; deckId: string | null; setDeckId: (id: string) => void; ready: boolean; toast: React.ReactNode;
  blockerFor: (rules: Pick<RoomRules, 'banlist' | 'check'> | null) => (d: SavedDeck) => string | null;
  onBack: () => void; onCreate: (rules: RoomRules, password: string) => void;
}) {
  const [rules, setRules] = useState<RoomRules>(() => stored('ma-room-rules', DEFAULT_RULES));
  const [password, setPassword] = useState('');
  useEffect(() => store('ma-room-rules', rules), [rules]);
  const set = <K extends keyof RoomRules>(k: K, v: RoomRules[K]) => setRules(r => ({ ...r, [k]: v }));
  const deck = decks.find(x => x.id === deckId) ?? null;
  const why = useMemo(() => (deck ? blockerFor(rules)(deck) : null), [deck, rules, blockerFor]);
  const seg = <K extends keyof RoomRules>(k: K, options: [RoomRules[K], string][]) => (
    <div className="seg">{options.map(([v, label]) => <button key={String(v)} className={rules[k] === v ? 'on' : ''} onClick={() => set(k, v)}>{label}</button>)}</div>
  );
  const summary: [string, string][] = [['Match', rules.bo === 3 ? 'Best of 3' : 'Best of 1'], ['Turn timer', rules.timer ? `${rules.timer} seconds` : 'Off'],
    ['Banlist', rules.banlist === 'none' ? 'None' : rules.banlist], ['Life points', rules.lp.toLocaleString('en-GB')], ['Deck check', rules.check ? 'On' : 'Off'],
    ['Spectators', rules.spectators === 'ask' ? 'Ask me' : 'Off'], ['Password', password ? 'Yes' : 'None']];
  return (
    <Page back="/home" className="duelpage" over={toast}>
      <div className="dhead"><div className="head"><button className="crumb" onClick={onBack}>← Duel</button><h1>Host a room</h1></div></div>
      <div className="dgrid2">
        <div className="panel rules">
          <div className="eyebrow">Room rules</div>
          <p className="d">Your friend sees these before they join.</p>
          <div className="srow"><div className="l"><b>Match</b><span>Best of 3 adds side decking between games.</span></div><div className="r">{seg('bo', [[1, 'Best of 1'], [3, 'Best of 3']])}</div></div>
          <div className="srow"><div className="l"><b>Turn timer</b><span>Time each player gets per turn.</span></div><div className="r">{seg('timer', [[0, 'Off'], [60, '60s'], [90, '90s'], [180, '180s']])}</div></div>
          <div className="srow"><div className="l"><b>Banlist</b><span>Which Forbidden &amp; Limited list applies.</span></div><div className="r">{seg('banlist', [['TCG', 'TCG'], ['OCG', 'OCG'], ['none', 'No banlist']])}</div></div>
          <div className="srow"><div className="l"><b>Starting life points</b><span>8000 is standard.</span></div><div className="r">{seg('lp', [[4000, '4000'], [8000, '8000'], [16000, '16000']])}</div></div>
          <div className="srow"><div className="l"><b>Deck check</b><span>Off lets friends test decks that break the banlist.</span></div><div className="r"><button className={`tog ${rules.check ? 'on' : ''}`} aria-label="Deck check" onClick={() => set('check', !rules.check)} /></div></div>
          <div className="srow"><div className="l"><b>Spectators</b><span>Everyone playing must accept each watch request.</span></div><div className="r">{seg('spectators', [['ask', 'Ask me'], ['off', 'Off']])}</div></div>
          <div className="srow"><div className="l"><b>Room password</b><span>Optional. Only people with it can join or watch.</span></div><div className="r"><input className="sinput" type="text" placeholder="None" maxLength={64} autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></div></div>
        </div>
        <div className="panel summary">
          <div className="eyebrow">Your deck</div>
          <DeckPicker decks={decks} value={deckId} onChange={setDeckId} blocker={blockerFor(rules)} />
          <div className="eyebrow">Summary</div>
          <ul className="sumlist">{summary.map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
          <div className="msg bad">{why ? `${why} Pick another deck${rules.check ? ' or turn off Deck check' : ''}.` : ''}</div>
          <button className="bigbtn" disabled={!ready || !deck || !!why} onClick={() => onCreate(rules, password)}>Create room</button>
        </div>
      </div>
    </Page>
  );
}
