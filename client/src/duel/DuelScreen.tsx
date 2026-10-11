// The duel screen: field + interface panels. You play from the bottom (side 0); when you're only watching,
// both sides are bots. Prompts from the engine light up the cards you can use.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DuelInfo, Frame, Prompt, PromptAnswer, ServerMessage, Side, ZoneRef } from '@arena/shared';
import { bigImage, card, cardName, imageFallback, smallImage } from '../lib/cards.ts';
import { Background, Eye, EyeSvg, Stage } from '../lib/ui.tsx';
import { Field, cellIndex, pileCell, type Mark, type PileKind } from './Field.tsx';
import { ActionMenu, CardPicker, PositionPicker, PromptPanel, actionsByCard, type CardActions, type MenuItem } from './prompt-ui.tsx';

const PHASES = ['DP', 'SP', 'M1', 'BP', 'M2', 'EP'] as const;
const FACEDOWN = 0xa, FACEUP = 0x5;
const PILE_NAMES: Record<PileKind, string> = { gy: 'Graveyard', ban: 'Banished', extra: 'Extra Deck', deck: 'Deck' };

export interface LogRow { step: number; turn: number; text: string; isTurn: boolean }
type Ending = Extract<ServerMessage, { type: 'end' }>;

type Menu = { x: number; y: number; below: boolean; title?: string; items: MenuItem[] };
const sameZone = (a: ZoneRef, b: ZoneRef) => a.p === b.p && a.loc === b.loc && a.seq === b.seq;

export function DuelScreen({ duel, frame, log, ending, prompt, onAnswer, onSurrender, onLeave }: {
  duel: DuelInfo; frame: Frame | null; log: LogRow[]; ending: Ending | null;
  prompt: Prompt | null; onAnswer: (a: PromptAnswer) => void; onSurrender: () => void; onLeave: () => void;
}) {
  const [detail, setDetail] = useState<number | null>(null);
  const [pile, setPile] = useState<[Side, PileKind] | null>(null);
  const [showEnd, setShowEnd] = useState(true);
  const [pops, setPops] = useState<{ id: number; p: Side; amount: number; cost?: boolean }[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [zones, setZones] = useState<ZoneRef[]>([]);
  const [confirm, setConfirm] = useState<'home' | 'surrender' | null>(null);
  const playing = duel.you === 0 && !ending;
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => { setMenu(null); setZones([]); }, [prompt?.id]);

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

  // damage numbers float off the life-point panels
  useEffect(() => {
    if (!frame?.damage.length) return;
    const fresh = frame.damage.map((d, i) => ({ ...d, id: frame.step * 10 + i }));
    setPops(p => [...p, ...fresh]);
    const t = setTimeout(() => setPops(p => p.filter(x => !fresh.includes(x))), 1500);
    return () => clearTimeout(t);
  }, [frame?.step]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPile(null); setConfirm(null); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);

  const onHover = (e: React.MouseEvent) => {
    const code = Number((e.target as HTMLElement).closest<HTMLElement>('[data-code]')?.dataset.code);
    if (code) setDetail(code);
  };

  return (
    <Stage>
      <div onMouseOver={onHover} onMouseDown={e => { if (menu && !(e.target as HTMLElement).closest('.actmenu')) setMenu(null); }}>
        <section className="layer layer-3d">
          <Background />
          {frame ? <Field frame={frame} onPile={onPile} marks={marks} onCell={onCell} /> : <div className="loadmsg">Waiting for the duel to start…</div>}
        </section>

        <section className="layer layer-ui">
          <button className="homebtn" onClick={() => (playing ? setConfirm('home') : onLeave())}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>Home
          </button>
          <div className="logo"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></div>
          <CardDetail code={detail} />
          {frame && <>
            <LifePanel side={1} duel={duel} frame={frame} />
            <LifePanel side={0} duel={duel} frame={frame} />
            <Hands frame={frame} can={handActions} onHand={(i, el) => { const e = handActions.get(i); if (e) openActions(el, e); }} />
            <PhaseBar duel={duel} frame={frame} />
            <div className="rightcol">
              <ChainPanel duel={duel} frame={frame} />
              {prompt && <PromptPanel key={prompt.id} prompt={prompt} phase={frame.phase} loose={loose} zonesLeft={prompt.kind === 'place' ? prompt.count - zones.length : 0} onAnswer={answer} onAutoZone={autoZone} />}
            </div>
            {(prompt?.kind === 'cards' || prompt?.kind === 'unselect') && <CardPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {prompt?.kind === 'position' && <PositionPicker key={prompt.id} prompt={prompt} onAnswer={answer} />}
            {pops.map(d => <div key={d.id} className={`dmg ${d.cost ? 'cost' : ''}`} style={{ left: d.p === 0 ? 174 : 1406, top: d.p === 0 ? 730 : 110 }}>−{d.amount}</div>)}
            {pile && <PileViewer duel={duel} frame={frame} pile={pile} setPile={setPile} actions={pileActions} onAct={openActions} />}
          </>}
          <LogPanel log={log} step={frame?.step ?? -1} duel={duel} />
          {menu && <ActionMenu {...menu} onClose={closeMenu} />}
          {confirm && (
            <div className="confirm on" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}><div className="panel">
              <div className="eyebrow">{confirm === 'home' ? 'Leave the duel' : 'Surrender'}</div>
              <h3>{confirm === 'home' ? 'Return to Home?' : 'Surrender this duel?'}</h3>
              <p>{confirm === 'home' ? 'Leaving ends the duel and counts as a surrender.' : `The duel ends here and ${duel.players[1]} wins.`}</p>
              <div className="line">
                <button className="bigbtn ghost" autoFocus onClick={() => setConfirm(null)}>{confirm === 'home' ? 'Stay' : 'Keep playing'}</button>
                <button className="bigbtn danger" onClick={() => { setConfirm(null); if (confirm === 'home') onLeave(); else onSurrender(); }}>{confirm === 'home' ? 'Leave duel' : 'Surrender'}</button>
              </div>
            </div></div>
          )}
          {ending && showEnd && (
            <div className="ending on"><div className="panel">
              <div className="eyebrow">Duel over · {ending.turns} turns</div>
              <h2>{duel.you === 0 ? (ending.winner === 0 ? 'Victory' : ending.winner === 1 ? 'Defeat' : ending.winner === 2 ? 'Draw' : 'Duel ended')
                : ending.winner === 0 || ending.winner === 1 ? `${duel.players[ending.winner]} wins` : ending.winner === 2 ? 'Draw' : 'Stopped'}</h2>
              <p>{ending.reason} · {duel.decks[0] === duel.decks[1] ? `${duel.decks[0]} mirror` : duel.decks.join(' vs ')}</p>
              <div className="line"><button className="bigbtn" onClick={onLeave}>Back to the lobby</button><button className="bigbtn ghost" onClick={() => setShowEnd(false)}>Look at the board</button></div>
            </div></div>
          )}
        </section>
      </div>
    </Stage>
  );
}

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

function LifePanel({ side, duel, frame }: { side: Side; duel: DuelInfo; frame: Frame }) {
  const lp = frame.board[side].lp, name = duel.players[side];
  return (
    <div className={`panel ${side === 0 ? 'me' : 'opp'}`}>
      <div className="av">{name[0]}</div>
      <div className="who">
        <div className="name">{name} <span className="rank">{frame.turnPlayer === side ? (duel.you === side ? 'Your turn' : 'Their turn') : ''}</span></div>
        <div className="lp"><small>LP</small>{lp}</div>
        <div className="bar"><i style={{ width: `${Math.min(100, lp / 80)}%` }} /></div>
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
      {frame.chain.map((c, i) => <div key={i} className="row" data-code={c.code}><div className="n">{i + 1}</div><div><b>{cardName(c.code)}</b><div className="sub">{duel.players[c.p]}</div></div></div>)}
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
