// The duel screen: field + interface panels. You play from the bottom (side 0); when you're only watching,
// both sides are bots. Prompts from the engine light up the cards you can use.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COIN_TOSS_MS, type ChatLine, type DuelInfo, type Frame, type Prompt, type PromptAnswer, type ServerMessage, type Side, type SummonKind, type ZoneRef } from '@arena/shared';
import { bigImage, card, cardName, imageFallback, smallImage } from '../lib/cards.ts';
import { Coin, initial } from '../lib/coin.tsx';
import { Background, Eye, EyeSvg, Stage } from '../lib/ui.tsx';
import { Field, cellIndex, pileCell, type CellFx, type Mark, type PileKind } from './Field.tsx';
import { ActionMenu, CardPicker, PositionPicker, PromptPanel, actionsByCard, type CardActions, type MenuItem } from './prompt-ui.tsx';
import { CardNamePicker, CounterPicker, DeclarePicker, SortPicker, SumPicker } from './rare-pickers.tsx';

const PHASES = ['DP', 'SP', 'M1', 'BP', 'M2', 'EP'] as const;
const FACEDOWN = 0xa, FACEUP = 0x5;
const PILE_NAMES: Record<PileKind, string> = { gy: 'Graveyard', ban: 'Banished', extra: 'Extra Deck', deck: 'Deck' };

export interface LogRow { step: number; turn: number; text: string; isTurn: boolean }
type Ending = Extract<ServerMessage, { type: 'end' }>;
/** Cards the engine showed you, and when they arrived. */
export type Reveal = Extract<ServerMessage, { type: 'reveal' }> & { at: number };
/** Each response on the opponent's turn has this long (the server's limit). */
const RESPONSE_MS = 30_000;

/** The current time, refreshed every `ms` while `ms` > 0. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!ms) return; const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
const clockText = (ms: number) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

type Menu = { x: number; y: number; below: boolean; title?: string; items: MenuItem[] };
const sameZone = (a: ZoneRef, b: ZoneRef) => a.p === b.p && a.loc === b.loc && a.seq === b.seq;

/** The big summons get a banner across the screen. */
const BANNERS: Partial<Record<SummonKind, string>> = { xyz: 'Xyz Summon', synchro: 'Synchro Summon', link: 'Link Summon', fusion: 'Fusion Summon', ritual: 'Ritual Summon' };

/** Short-lived things (damage numbers, effects, banners): added now, removed after `ms`. Removal isn't cancelled by the
 *  next frame (it used to be, so damage numbers piled up in the page). */
function useFleeting<T extends { id: number }>(ms: number) {
  const [items, setItems] = useState<T[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const add = useCallback((fresh: T[]) => {
    if (!fresh.length) return;
    setItems(x => [...x, ...fresh]);
    const ids = new Set(fresh.map(f => f.id));
    const t = setTimeout(() => { timers.current.delete(t); setItems(x => x.filter(i => !ids.has(i.id))); }, ms);
    timers.current.add(t);
  }, [ms]);
  return [items, add] as const;
}

/** Duels between people: the chat, which shares the bottom-right panel with the duel log. */
export interface DuelChat { lines: ChatLine[]; name: string; onSend: (text: string) => void }

export function DuelScreen({ duel, frame, log, ending, prompt, promptAt, onAnswer, reveal, onCloseReveal, onSurrender, onLeave, reconnecting, embedded, initialDetail, chat, matchLine, leaveText, endAction }: {
  duel: DuelInfo; frame: Frame | null; log: LogRow[]; ending: Ending | null;
  prompt: Prompt | null; promptAt: number; onAnswer: (a: PromptAnswer) => void;
  reveal: Reveal | null; onCloseReveal: () => void; onSurrender: () => void; onLeave: () => void; reconnecting?: boolean;
  /** Shown as a picture inside another page (the Welcome page's preview): no window scaling, no clicks. */
  embedded?: boolean;
  /** The card shown in the detail panel before anything is hovered. */
  initialDetail?: number;
  chat?: DuelChat;
  /** A match between people, e.g. "Game 2 of 3 · 1-0". */
  matchLine?: string;
  /** What leaving the duel means here. */
  leaveText?: string;
  /** The main button when the duel is over (default: back to the lobby). */
  endAction?: { label: string; run: () => void };
}) {
  const [detail, setDetail] = useState<number | null>(initialDetail ?? null);
  const [pile, setPile] = useState<[Side, PileKind] | null>(null);
  const [showEnd, setShowEnd] = useState(true);
  const [pops, addPops] = useFleeting<{ id: number; p: Side; amount: number; cost?: boolean }>(1500);
  const [fx, addFx] = useFleeting<CellFx>(1300);
  const [banners, addBanner] = useFleeting<{ id: number; title: string; code: number; theirs: boolean }>(1700);
  const lastFrameAt = useRef(Date.now());
  const [menu, setMenu] = useState<Menu | null>(null);
  const [zones, setZones] = useState<ZoneRef[]>([]);
  const [confirm, setConfirm] = useState<'home' | 'surrender' | null>(null);
  const playing = duel.you === 0 && !ending;
  const closeMenu = useCallback(() => setMenu(null), []);
  // every card seen face-up this duel (newest first), offered first when declaring a card name
  const seen = useRef<number[]>([]);
  useEffect(() => {
    if (!frame) return;
    const codes = frame.board.flatMap(s => [...s.m, ...s.s].filter(c => c && c[0]).map(c => c![0]).concat(s.gy, s.ban.map(b => b[0]))).concat(frame.chain.map(c => c.code));
    for (const c of codes) if (c && !seen.current.includes(c)) seen.current.unshift(c);
  }, [frame?.step]);
  useEffect(() => { setMenu(null); setZones([]); }, [prompt?.id]);

  // turn timer: the prompt's clock counts down while it's on screen; between prompts your turn's time is paused
  const now = useNow(prompt?.time ? 250 : !prompt && !ending ? 500 : 0);
  // nothing to answer and nothing new for a while: the engine (or the bot) is working something out
  const thinking = !!frame && !prompt && !ending && !reconnecting && now - lastFrameAt.current > 2200;
  const left = prompt?.time ? prompt.time.left - (now - promptAt) : null;
  const bank = useRef(duel.timer * 1000);
  if (prompt?.time?.turn && left !== null) bank.current = Math.max(0, left);
  const myTurn = frame?.turnPlayer === 0 && duel.you === 0;
  useEffect(() => { if (myTurn) bank.current = duel.timer * 1000; }, [frame?.turn]);   // a fresh turn's time
  const clock = duel.timer && duel.you === 0 ? (myTurn ? bank.current : null) : null;

  // what you can click right now: cards with actions (glow), zones you can choose, and choices with no card on screen
  const byCard = useMemo(() => actionsByCard(prompt), [prompt]);
  const { marks, cellActions, handActions, pileActions, loose } = useMemo(() => {
    const marks = new Map<number, Mark>(), cellActions = new Map<number, CardActions>(), handActions = new Map<number, CardActions>();
    const pileActions = new Map<string, CardActions>(), loose: CardActions[] = [];
    for (const entry of byCard.values()) {
      const c = entry.card;
      if (c.p === 0 && c.loc === 'hand' && !c.mat) handActions.set(c.seq, entry);
      else if (c.mat || c.loc === 'm' || c.loc === 's') {
        const i = cellIndex({ p: c.p, loc: c.mat ? 'm' : c.loc as 'm' | 's', seq: c.seq });
        if (i >= 0) { marks.set(i, 'can'); cellActions.set(i, entry); } else loose.push(entry);
      } else if (c.loc === 'gy' || c.loc === 'ban' || c.loc === 'extra') { marks.set(pileCell(c.p, c.loc), 'can'); pileActions.set(`${c.p}:${c.loc}:${c.seq}`, entry); }
      else loose.push(entry);
    }
    if (prompt?.kind === 'place') for (const z of prompt.zones) { const i = cellIndex(z); if (i >= 0) marks.set(i, zones.some(p => sameZone(p, z)) ? 'picked' : 'pick'); }
    return { marks, cellActions, handActions, pileActions, loose };
  }, [byCard, prompt, zones]);

  const answer = (a: PromptAnswer) => { setMenu(null); setPile(null); onAnswer(a); };
  /** Open a menu just above (or below, near the top) the element that was clicked, in stage coordinates. */
  const openMenu = (el: HTMLElement, title: string | undefined, items: MenuItem[]) => {
    const stage = el.closest('.stage')!.getBoundingClientRect(), r = el.getBoundingClientRect(), k = stage.width / 1600;
    const top = (r.top - stage.top) / k, bottom = (r.bottom - stage.top) / k, below = top < 240;
    setMenu({ x: Math.min(1460, Math.max(140, (r.left + r.width / 2 - stage.left) / k)), y: below ? bottom + 10 : top - 10, below, title, items });
  };
  const openActions = (el: HTMLElement, entry: CardActions) =>
    openMenu(el, entry.card.code ? cardName(entry.card.code) : undefined, entry.actions.map(a => ({ label: a.label, sub: a.sub, run: () => answer(a.answer) })));

  const onCell = (i: number, el: HTMLElement) => {
    if (prompt?.kind === 'place') {
      const z = prompt.zones.find(z => cellIndex(z) === i);
      if (!z) return;
      const next = zones.some(p => sameZone(p, z)) ? zones.filter(p => !sameZone(p, z)) : [...zones, z];
      if (next.length >= prompt.count) answer({ kind: 'place', zones: next.slice(0, prompt.count) });
      else setZones(next);
      return;
    }
    const entry = cellActions.get(i);
    if (entry) openActions(el, entry);
  };
  const onPile = (p: Side, kind: PileKind, el: HTMLElement) => {
    if (kind === 'deck' && p === 0 && playing) {
      openMenu(el, `Your Deck · ${frame?.board[0].deck ?? 0} cards`, [{ label: 'Surrender', danger: true, run: () => { setMenu(null); setConfirm('surrender'); } }]);
      return;
    }
    setPile([p, kind]);
  };
  const autoZone = () => {
    if (prompt?.kind !== 'place') return;
    // fill the remaining picks with the free zones nearest the middle of your own side
    const order = [...prompt.zones].sort((a, b) => a.p - b.p || (a.loc === b.loc ? 0 : a.loc === 'm' ? -1 : 1) || Math.abs(a.seq - 2) - Math.abs(b.seq - 2));
    answer({ kind: 'place', zones: [...zones, ...order.filter(z => !zones.some(p => sameZone(p, z)))].slice(0, prompt.count) });
  };

  // each step's moments: damage numbers off the life-point panels, summon bursts, cards leaving the field, big-summon banners
  useEffect(() => {
    if (!frame) return;
    lastFrameAt.current = Date.now();
    const id = frame.step * 100;
    addPops(frame.damage.map((d, i) => ({ ...d, id: id + i })));
    addFx([
      ...frame.summons.map((x, i): CellFx => ({ id: id + 10 + i, kind: 'summon', cell: cellIndex(x.zone), summon: x.kind })),
      ...frame.leaves.map((x, i): CellFx => ({ id: id + 50 + i, kind: 'leave', cell: cellIndex(x.zone), code: x.code, to: x.to, theirs: x.zone.p === 1 })),
    ].filter(f => f.cell >= 0));
    addBanner(frame.summons.filter(x => BANNERS[x.kind]).slice(0, 1).map(x => ({ id, title: BANNERS[x.kind]!, code: x.code, theirs: x.zone.p === 1 })));
  }, [frame?.step]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPile(null); setConfirm(null); onCloseReveal(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onCloseReveal]);

  const onHover = (e: React.MouseEvent) => {
    const code = Number((e.target as HTMLElement).closest<HTMLElement>('[data-code]')?.dataset.code);
    if (code) setDetail(code);
  };

  const Wrap = embedded ? EmbeddedStage : Stage;
  return (
    <Wrap>
      <div onMouseOver={onHover} onMouseDown={e => { if (menu && !(e.target as HTMLElement).closest('.actmenu')) setMenu(null); }}>
        <section className="layer layer-3d">
          {frame ? <Field frame={frame} onPile={onPile} marks={marks} onCell={onCell} fx={fx} /> : <div className="loadmsg">Waiting for the duel to start…</div>}
        </section>

        <section className="layer layer-ui">
          <button className="homebtn" onClick={() => (playing ? setConfirm('home') : onLeave())}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>Home
          </button>
          <div className="logo"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></div>
          <CardDetail code={detail} />
          {frame && <>
            <LifePanel side={1} duel={duel} frame={frame} />
            <LifePanel side={0} duel={duel} frame={frame} clock={clock} />
            <Hands frame={frame} can={handActions} onHand={(i, el) => { const e = handActions.get(i); if (e) openActions(el, e); }} />
            <PhaseBar duel={duel} frame={frame} />
            <div className="rightcol">
              {prompt?.time && left !== null && <TimerBar left={left} full={prompt.time.turn ? duel.timer * 1000 : RESPONSE_MS} turn={prompt.time.turn} />}
              {thinking && <div className="panel thinking"><span className="dots"><i /><i /><i /></span>{frame.turnPlayer === 0 && duel.you === 0 ? 'Working it out…' : `${duel.players[frame.turnPlayer]} is thinking…`}</div>}
              <ChainPanel duel={duel} frame={frame} />
              {prompt && <PromptPanel key={prompt.id} prompt={prompt} phase={frame.phase} loose={loose} zonesLeft={prompt.kind === 'place' ? prompt.count - zones.length : 0} onAnswer={answer} onAutoZone={autoZone} />}
            </div>
            {(prompt?.kind === 'cards' || prompt?.kind === 'unselect') && <CardPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'position' && <PositionPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'sum' && <SumPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'counters' && <CounterPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'sort' && <SortPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'declare' && <DeclarePicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'cardname' && <CardNamePicker key={prompt.id} prompt={prompt} seen={seen.current} onAnswer={answer} />}
            {pops.map(d => <div key={d.id} className={`dmg ${d.cost ? 'cost' : ''}`} style={{ left: d.p === 0 ? 174 : 1406, top: d.p === 0 ? 730 : 110 }}>−{d.amount}</div>)}
            {pile && <PileViewer duel={duel} frame={frame} pile={pile} setPile={setPile} actions={pileActions} onAct={openActions} />}
            {reveal && <RevealPanel reveal={reveal} onClose={onCloseReveal} />}
            {banners.map(b => (
              <div key={b.id} className={`summon-banner ${b.theirs ? 'theirs' : ''}`}><span>{b.title}</span><b>{cardName(b.code)}</b></div>
            ))}
            {reconnecting && <div className="panel reconnecting"><span className="dots"><i /><i /><i /></span>Connection lost. Reconnecting to the duel…</div>}
          </>}
          {chat ? <TalkPanel log={log} step={frame?.step ?? -1} chat={chat} matchLine={matchLine} /> : <LogPanel log={log} step={frame?.step ?? -1} duel={duel} />}
          {duel.coin && <CoinToss key={duel.id} duel={duel} />}
          {menu && <ActionMenu {...menu} onClose={closeMenu} />}
          {confirm && (
            <div className="confirm on" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}><div className="panel">
              <div className="eyebrow">{confirm === 'home' ? 'Leave the duel' : 'Surrender'}</div>
              <h3>{confirm === 'home' ? 'Return to Home?' : 'Surrender this duel?'}</h3>
              <p>{confirm === 'home' ? leaveText ?? 'Leaving ends the duel and counts as a surrender.' : `The duel ends here and ${duel.players[1]} wins.`}</p>
              <div className="line">
                <button className="bigbtn ghost" autoFocus onClick={() => setConfirm(null)}>{confirm === 'home' ? 'Stay' : 'Keep playing'}</button>
                <button className="bigbtn danger" onClick={() => { setConfirm(null); if (confirm === 'home') onLeave(); else onSurrender(); }}>{confirm === 'home' ? 'Leave duel' : 'Surrender'}</button>
              </div>
            </div></div>
          )}
          {ending && showEnd && (
            <div className={`ending on ${duel.you === 0 ? (ending.winner === 0 ? 'victory' : ending.winner === 1 ? 'defeat' : '') : ''}`}><div className="panel">
              <div className="eyebrow">Duel over · {ending.turns} {ending.turns === 1 ? 'turn' : 'turns'}</div>
              <h2>{duel.you === 0 ? (ending.winner === 0 ? 'Victory' : ending.winner === 1 ? 'Defeat' : ending.winner === 2 ? 'Draw' : 'Duel ended')
                : ending.winner === 0 || ending.winner === 1 ? `${duel.players[ending.winner]} wins` : ending.winner === 2 ? 'Draw' : 'Stopped'}</h2>
              <p>{ending.reason} · {matchLine ?? (duel.decks[0] === duel.decks[1] ? `${duel.decks[0]} mirror` : duel.decks.join(' vs '))}</p>
              <div className="line"><button className="bigbtn" onClick={endAction?.run ?? onLeave}>{endAction?.label ?? 'Back to the lobby'}</button><button className="bigbtn ghost" onClick={() => setShowEnd(false)}>Look at the board</button></div>
            </div></div>
          )}
        </section>
      </div>
    </Wrap>
  );
}

/** The duel screen at its full 1600×900, for a page to scale down and show (it can't be clicked). */
/** "Coin toss" against the bot: the coin lands on whoever goes first, says so, then fades just before the first move
 *  (the server holds the duel back for COIN_TOSS_MS). */
function CoinToss({ duel }: { duel: DuelInfo }) {
  const [stage, setStage] = useState<'flip' | 'landed' | 'out' | 'gone'>('flip');
  const shown = useRef(Date.now());
  useEffect(() => {
    // fade out in time for the first move, however quickly the coin landed (it doesn't flip at all with reduced motion)
    if (stage === 'landed') { const t = setTimeout(() => setStage('out'), Math.max(0, shown.current + COIN_TOSS_MS - 400 - Date.now())); return () => clearTimeout(t); }
    if (stage === 'out') { const t = setTimeout(() => setStage('gone'), 350); return () => clearTimeout(t); }
  }, [stage]);
  if (!duel.coin || stage === 'gone') return null;
  const first = duel.coin.first, them = duel.players[1];
  return (
    <div className={`overlay cointoss ${stage === 'out' ? 'out' : ''}`}><div className="coinstack">
      <Coin faces={[{ mark: initial(duel.players[0]), label: 'You' }, { mark: '⚙', label: them }]} winner={first} flipping={stage === 'flip'} onLanded={() => setStage('landed')} />
      <div className="panel modal toss">
        <div className="eyebrow">Coin toss</div>
        <h3>{stage === 'flip' ? 'Tossing…' : first === 0 ? 'You go first' : `${them} goes first`}</h3>
        <p className="d">{stage === 'flip' ? '' : first === 0 ? 'You won the toss.' : `${them} won the toss. You'll draw on your first turn.`}</p>
      </div>
    </div></div>
  );
}

const EmbeddedStage = ({ children }: { children: React.ReactNode }) => <div className="stage embedded-stage" inert><Background />{children}</div>;

function CardDetail({ code }: { code: number | null }) {
  const c = code ? card(code) : undefined;
  if (!code || !c) return <div className="panel detail"><div style={{ margin: 'auto', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Hover any card to see it here.</div></div>;
  const meta = c.frame === 'spell' || c.frame === 'trap' ? c.typeLine
    : [c.attribute, c.frame === 'link' ? `Link ${c.level}` : c.frame.startsWith('xyz') ? `Rank ${c.level}` : `Level ${c.level}`, c.typeLine].filter(Boolean).join(' · ');
  return (
    <div className="panel detail">
      <div className="img"><img src={bigImage(code)} alt="" onError={e => imageFallback(e, code)} /></div>
      <h2>{c.name}</h2>
      <div className="meta">{meta}</div>
      {c.atk !== null && <div className="stats"><div><span>ATK</span>{c.atk}</div>{c.def !== null && <div><span>DEF</span>{c.def}</div>}</div>}
      <p style={{ whiteSpace: 'pre-line' }}>{c.text}</p>
    </div>
  );
}

function TimerBar({ left, full, turn }: { left: number; full: number; turn: boolean }) {
  return (
    <div className={`panel timerbar ${left < 10_000 ? 'low' : ''}`}>
      <span>{turn ? 'Your turn' : 'Respond within'}</span><b>{clockText(left)}</b>
      <div className="timer"><i style={{ width: `${Math.min(100, (100 * left) / Math.max(full, 1))}%` }} /></div>
    </div>
  );
}

function RevealPanel({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  return (
    <div className={`panel pileview on reveal ${reveal.brief ? 'brief' : ''}`}>
      <div className="pv-head"><h3>{reveal.title}</h3><span className="n">{reveal.cards.length}</span>
        <span className="note">{reveal.brief ? '' : 'Shown to you by a card effect'}</span>
        <button className="pv-close" onClick={onClose} title="Close (Esc)">×</button></div>
      <div className="pv-grid">
        {reveal.cards.map((code, i) => <div key={i} className="pv-card" data-code={code || undefined}>
          {code ? <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} /> : <div className="card back" style={{ position: 'absolute', inset: 0 }}><EyeSvg /></div>}
        </div>)}
      </div>
    </div>
  );
}

/** Life points count down (or up) to their new value instead of jumping, and the panel flinches when they drop. */
function useCountTo(target: number, ms = 700) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(), a = from.current;
    if (a === target) return;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms), v = Math.round(a + (target - a) * (1 - (1 - k) ** 3));
      from.current = v; setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function LifePanel({ side, duel, frame, clock }: { side: Side; duel: DuelInfo; frame: Frame; clock?: number | null }) {
  const lp = frame.board[side].lp, name = duel.players[side];
  const shown = useCountTo(lp);
  const hit = shown > lp;   // still counting down
  return (
    <div className={`panel ${side === 0 ? 'me' : 'opp'} ${hit ? 'hit' : ''}`}>
      <div className="av">{name[0]}</div>
      <div className="who">
        <div className="name">{name} <span className={`rank ${clock !== undefined && clock !== null && clock < 10_000 ? 'low' : ''}`}>
          {frame.turnPlayer === side ? (duel.you === side ? 'Your turn' : 'Their turn') : ''}{clock !== undefined && clock !== null ? ` · ${clockText(clock)}` : ''}</span></div>
        <div className="lp"><small>LP</small>{shown}</div>
        <div className="bar"><i style={{ width: `${Math.min(100, shown / 80)}%` }} /></div>
      </div>
    </div>
  );
}

function Hands({ frame, can, onHand }: { frame: Frame; can: Map<number, CardActions>; onHand: (i: number, el: HTMLElement) => void }) {
  const mine = frame.board[0].hand, theirs = frame.board[1].hand;
  return <>
    <div className="hand">{mine.map((code, i) => {
      const off = i - (mine.length - 1) / 2;
      return <div key={i} className={`hcard ${code ? '' : 'back'} ${can.has(i) ? 'can' : ''}`} data-code={code || undefined} onClick={can.has(i) ? e => onHand(i, e.currentTarget) : undefined}
        style={{ '--x': `${off * Math.min(112, 560 / Math.max(mine.length, 1))}px`, '--y': `${off * off * 6}px`, '--a': `${off * 4}deg` } as React.CSSProperties}>
        {code ? <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} /> : <EyeSvg />}
      </div>;
    })}</div>
    <div className="opp-hand">{theirs.map((code, i) => {
      const off = i - (theirs.length - 1) / 2;
      return <div key={i} className={`card ${code ? '' : 'back'}`} data-code={code || undefined} style={{ transform: `translate(${off * 44}px, ${-Math.abs(off) * 4}px) rotate(${180 - off * 4}deg)` }}>
        {code ? <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} /> : <EyeSvg />}
      </div>;
    })}</div>
  </>;
}

function PhaseBar({ duel, frame }: { duel: DuelInfo; frame: Frame }) {
  return (
    <div className="panel phase">
      <div className="turn">Turn<b>{frame.turn}</b><span className="whose" style={{ color: frame.turnPlayer ? 'var(--atk)' : 'var(--accent)' }}>{duel.players[frame.turnPlayer]}</span></div>
      {PHASES.map(p => <div key={p} className={`ph ${p === frame.phase ? 'on' : ''}`}>{p}</div>)}
    </div>
  );
}

function ChainPanel({ duel, frame }: { duel: DuelInfo; frame: Frame }) {
  if (!frame.chain.length) return null;
  return (
    <div className="panel chain on">
      <div className="eyebrow">Chain</div>
      {frame.chain.map((c, i) => (
        <div key={i} className={`row ${frame.solving === i + 1 ? 'solving' : ''}`} data-code={c.code}><div className="n">{i + 1}</div>
          <div><b>{cardName(c.code)}</b><div className="sub">{duel.players[c.p]}{frame.solving === i + 1 ? ' · resolving' : ''}</div></div></div>
      ))}
    </div>
  );
}

function LogPanel({ log, step, duel }: { log: LogRow[]; step: number; duel: DuelInfo }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [log.length]);
  return (
    <div className="panel rlog">
      <div className="ctrls"><span className="eyebrow">Duel log</span><span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{duel.fullView ? 'Watching · all cards visible' : duel.you === 0 ? `${duel.decks[0]} vs ${duel.decks[1]}` : 'Watching'}</span></div>
      <div className="lines" ref={box}>
        {log.map((r, k) => <div key={k} className={`ln ${r.isTurn ? 'turn' : ''} ${r.step === step ? 'now' : ''}`}>
          {r.isTurn ? r.text : <><i>T{r.turn}</i><span>{r.text}</span></>}
        </div>)}
      </div>
    </div>
  );
}

const QUICK = ['GG', 'Good luck!', 'Nice play', 'Thinking…'];

/** Chat and the duel log as two tabs. Mute hides what the opponent and spectators say. */
function TalkPanel({ log, step, chat, matchLine }: { log: LogRow[]; step: number; chat: DuelChat; matchLine?: string }) {
  const [tab, setTab] = useState<'chat' | 'log'>('chat');
  const [muted, setMuted] = useState(false);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(chat.lines.length);
  const chatBox = useRef<HTMLDivElement>(null), logBox = useRef<HTMLDivElement>(null);
  const mine = (l: ChatLine) => l.role !== 'system' && l.from === chat.name;
  const shown = chat.lines.filter(l => !muted || l.role === 'system' || mine(l));
  const unread = tab === 'log' ? chat.lines.slice(seen).filter(l => !mine(l) && l.role !== 'system' && !muted).length : 0;
  useEffect(() => { if (tab === 'chat') { setSeen(chat.lines.length); chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight }); } }, [chat.lines.length, tab, muted]);
  useEffect(() => { logBox.current?.scrollTo({ top: logBox.current.scrollHeight }); }, [log.length, tab]);
  const send = (t: string) => { const v = t.trim(); if (v) { chat.onSend(v); setText(''); } };
  return (
    <div className="panel talk">
      <div className="tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat{unread > 0 && <span className="unread">{unread}</span>}</button>
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Duel log</button>
        <button className={`mute ${muted ? 'on' : ''}`} title={muted ? 'Unmute chat' : 'Mute chat'} onClick={() => setMuted(m => !m)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z" />{muted ? <path d="m22 9-6 6M16 9l6 6" /> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></>}</svg>
        </button>
      </div>
      {tab === 'chat' ? <>
        <div className="body" ref={chatBox}>
          {matchLine && <div className="cm k-sys">{matchLine}</div>}
          {shown.map((l, k) => (
            <div key={k} className={`cm k-${l.role === 'system' ? 'sys' : mine(l) ? 'me' : l.role === 'spectator' ? 'spec' : 'opp'}`}>
              {l.role === 'system' ? l.text : <><b>{mine(l) ? 'You' : l.from}</b>{l.text}</>}
            </div>
          ))}
          {muted && <div className="cm k-sys">Chat muted: messages from others are hidden.</div>}
        </div>
        <div className="quick">{QUICK.map(q => <button key={q} onClick={() => send(q)}>{q}</button>)}</div>
        <form className="send" onSubmit={e => { e.preventDefault(); send(text); }}>
          <input className="chatin" maxLength={200} spellCheck={false} placeholder="Say something…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.stopPropagation()} />
          <button className="sbtn p" disabled={!text.trim()}>Send</button>
        </form>
      </> : (
        <div className="body lines" ref={logBox}>
          {log.map((r, k) => <div key={k} className={`ln ${r.isTurn ? 'turn' : ''} ${r.step === step ? 'now' : ''}`}>{r.isTurn ? r.text : <><i>T{r.turn}</i><span>{r.text}</span></>}</div>)}
        </div>
      )}
    </div>
  );
}

function PileViewer({ duel, frame, pile, setPile, actions, onAct }: {
  duel: DuelInfo; frame: Frame; pile: [Side, PileKind]; setPile: (p: [Side, PileKind] | null) => void;
  actions: Map<string, CardActions>; onAct: (el: HTMLElement, entry: CardActions) => void;
}) {
  const [p, kind] = pile, side = frame.board[p];
  // seq = the card's place in the pile as the engine counts it (GY and banished are shown newest first)
  const list = (k: PileKind) =>
    k === 'gy' ? frame.board[p].gy.map((code, seq) => ({ code, seq, tag: '' })).reverse()
    : k === 'ban' ? frame.board[p].ban.map(([code, pos], seq) => ({ code, seq, tag: pos & FACEDOWN ? 'Face-down' : '' })).reverse()
    : k === 'extra' ? (frame.board[p].ex ?? []).map(([code, pos], seq) => ({ code, seq, tag: pos & FACEUP ? 'Face-up' : '' }))
    : (frame.board[p].dk ?? []).map((code, seq, all) => ({ code, seq, tag: seq === 0 ? 'Top' : seq === all.length - 1 ? 'Bottom' : '' }));
  const cards = list(kind).filter(c => c.code || kind !== 'extra');   // the opponent's face-down Extra Deck cards aren't shown
  const count = kind === 'deck' || kind === 'extra' ? side[kind] : cards.length;
  const deckHidden = kind === 'deck' && !side.dk;
  const name = (q: Side) => duel.players[q];
  return (
    <div className="panel pileview on">
      <div className="pv-head"><h3>{name(p)} · {PILE_NAMES[kind]}</h3><span className="n">{count}</span>
        <span className="note">{kind === 'gy' || kind === 'ban' ? 'Most recent first' : kind === 'deck' && !deckHidden ? 'Top card first' : ''}</span>
        <button className="pv-close" onClick={() => setPile(null)} title="Close (Esc)">×</button></div>
      <div className="pv-tabs">
        {([0, 1] as Side[]).map(q => (['gy', 'ban', 'extra', 'deck'] as PileKind[]).map(k => {
          const n = k === 'gy' ? frame.board[q].gy.length : k === 'ban' ? frame.board[q].ban.length : frame.board[q][k];
          return <button key={`${q}${k}`} className={q === p && k === kind ? 'on' : ''} onClick={() => setPile([q, k])}>{name(q)} · {PILE_NAMES[k]} {n}</button>;
        }))}
      </div>
      <div className="pv-grid">
        {deckHidden ? <div className="pv-empty">You can't look through a Deck during a duel.</div>
          : cards.length ? cards.map((c, i) => {
            const act = actions.get(`${p}:${kind}:${c.seq}`);
            return <div key={i} className={`pv-card ${c.tag === 'Face-down' ? 'down' : ''} ${act ? 'can' : ''}`} data-code={c.code || undefined} onClick={act ? e => onAct(e.currentTarget, act) : undefined}>
              {c.code ? <img src={smallImage(c.code)} alt="" onError={e => imageFallback(e, c.code)} /> : <div className="card back" style={{ position: 'absolute', inset: 0 }}><EyeSvg /></div>}
              {c.tag && <span className="tag">{c.tag}</span>}</div>;
          })
          : <div className="pv-empty">{kind === 'extra' ? 'No face-up cards.' : 'Empty.'}</div>}
      </div>
    </div>
  );
}
