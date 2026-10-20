// The field: a 7×5 grid like the duel-screen mockup. You (side 0) at the bottom, the opponent mirrored at the top.
//   row 0  opp Deck | opp S/T 4..0 | opp Extra          row 3  your Field | your monsters 0..4 | your GY
//   row 1  opp GY   | opp monsters 4..0 | opp Field     row 4  your Extra | your S/T 0..4 | your Deck
//   row 2  opp banished | Extra Monster Zones (shared) | your banished
import { NEGATED, type FieldCard, type Frame, type LeaveTo, type Side, type SummonKind, type ZoneRef } from '@arena/shared';
import { imageFallback, smallImage } from '../lib/cards.ts';
import { EyeSvg } from '../lib/ui.tsx';

export type PileKind = 'gy' | 'ban' | 'deck' | 'extra';
type Cell =
  | { kind: 'm' | 'st' | 'fieldz'; p: Side; seq: number }
  | { kind: 'emz'; slots: [Side, number][] }
  | { kind: PileKind; p: Side }
  | { kind: 'emblem' | 'none' };

const FACEDOWN = 0xa, DEFENSE = 0xc;
const COL = 106, ROW = 148, W = 92, H = 134;   // grid pitch and cell size (see .field in duel.css)

function cellAt(r: number, c: number): Cell {
  if (r === 0) return c === 0 ? { kind: 'deck', p: 1 } : c === 6 ? { kind: 'extra', p: 1 } : { kind: 'st', p: 1, seq: 5 - c };
  if (r === 1) return c === 0 ? { kind: 'gy', p: 1 } : c === 6 ? { kind: 'fieldz', p: 1, seq: 5 } : { kind: 'm', p: 1, seq: 5 - c };
  if (r === 2) return c === 0 ? { kind: 'ban', p: 1 } : c === 6 ? { kind: 'ban', p: 0 } : c === 3 ? { kind: 'emblem' }
    : c === 2 ? { kind: 'emz', slots: [[0, 5], [1, 6]] } : c === 4 ? { kind: 'emz', slots: [[0, 6], [1, 5]] } : { kind: 'none' };
  if (r === 3) return c === 0 ? { kind: 'fieldz', p: 0, seq: 5 } : c === 6 ? { kind: 'gy', p: 0 } : { kind: 'm', p: 0, seq: c - 1 };
  return c === 0 ? { kind: 'extra', p: 0 } : c === 6 ? { kind: 'deck', p: 0 } : { kind: 'st', p: 0, seq: c - 1 };
}
const CELLS = Array.from({ length: 35 }, (_, i) => cellAt(Math.floor(i / 7), i % 7));

/** Where a zone sits on the grid (Extra Monster Zones are shared: left = your 5 / their 6, right = your 6 / their 5). */
export function gridOf(z: Pick<ZoneRef, 'p' | 'loc' | 'seq'>): [number, number] | null {
  if (z.loc === 'm') {
    if (z.seq < 5) return z.p === 0 ? [3, z.seq + 1] : [1, 5 - z.seq];
    if (z.seq === 5) return [2, z.p === 0 ? 2 : 4];
    if (z.seq === 6) return [2, z.p === 0 ? 4 : 2];
  }
  if (z.loc === 's') {
    if (z.seq < 5) return z.p === 0 ? [4, z.seq + 1] : [0, 5 - z.seq];
    if (z.seq === 5) return z.p === 0 ? [3, 0] : [1, 6];
  }
  return null;
}
/** Grid cell index (row * 7 + column) of a pile. */
export function pileCell(p: Side, kind: PileKind): number {
  const rc: Record<PileKind, [number, number]> = p === 0 ? { gy: [3, 6], ban: [2, 6], deck: [4, 6], extra: [4, 0] } : { gy: [1, 0], ban: [2, 0], deck: [0, 0], extra: [0, 6] };
  return rc[kind][0] * 7 + rc[kind][1];
}
export const cellIndex = (z: Pick<ZoneRef, 'p' | 'loc' | 'seq'>) => { const g = gridOf(z); return g ? g[0] * 7 + g[1] : -1; };

/** A short effect played on a field cell: a summon burst, or the ghost of a card leaving the field. */
export type CellFx =
  | { id: number; kind: 'summon'; cell: number; summon: SummonKind }
  | { id: number; kind: 'leave'; cell: number; code: number; to: LeaveTo; theirs: boolean };

/** How a cell is marked while you're choosing: `act` = has an effect you can activate now (glows), `atk` = can attack
 *  (Battle Phase; 'act atk' = both), `can` = something else you can do (summon, Set, change position), `pick` = a zone you can choose. */
export type Mark = 'act' | 'atk' | 'act atk' | 'can' | 'pick' | 'picked';

const sameCell = (z: ZoneRef, r: number, c: number) => { const g = gridOf(z); return !!g && g[0] === r && g[1] === c; };

function CardFace({ card, monster }: { card: FieldCard; monster: boolean }) {
  const [code, pos, atk, def, mats, , flags, counters] = card;
  const down = (pos & FACEDOWN) !== 0, sideways = monster && (pos & DEFENSE) !== 0, negated = !down && ((flags ?? 0) & NEGATED) !== 0;
  return <>
    {/* `enter` plays once: a card that newly appears in a zone gets a fresh element (see the key where CardFace is used) */}
    <div className={`card enter ${code ? '' : 'back'} ${sideways ? 'def' : ''}`} data-code={code || undefined}>
      {code ? <img src={smallImage(code)} alt="" loading="lazy" onError={e => imageFallback(e, code)} /> : <EyeSvg />}
      {negated && <div className="negx" title="Effects negated" />}
    </div>
    {monster && !down && atk !== null && <div className="stat">{sideways ? <>{atk} / <b>{def}</b></> : <><b>{atk}</b>{def !== null && <> / {def}</>}</>}</div>}
    {mats > 0 && <div className="mats" title="Xyz materials">{mats}</div>}
    {counters > 0 && <div className="ctrs" title={`${counters} counter${counters === 1 ? '' : 's'}`}>{counters}</div>}
  </>;
}

export function Field({ frame, onPile, marks, onCell, fx = [] }: {
  frame: Frame; onPile: (p: Side, kind: PileKind, el: HTMLElement) => void;
  marks?: Map<number, Mark>; onCell?: (cell: number, el: HTMLElement) => void; fx?: CellFx[];
}) {
  const b = frame.board;
  const cells = CELLS.map((cell, i) => {
    const r = Math.floor(i / 7), c = i % 7;
    const flags = [
      frame.highlight.some(z => sameCell(z, r, c)) && 'flash',
      frame.attack && sameCell(frame.attack.from, r, c) && 'attacker',
      frame.attack?.to && sameCell(frame.attack.to, r, c) && 'target',
    ].filter(Boolean).join(' ');
    const chainLinks = frame.chain.map((z, n) => (sameCell(z, r, c) ? n + 1 : 0)).filter(Boolean);
    let content: React.ReactNode = null, extra = '';
    // the opponent's cards face them: everything on their side is turned around
    let theirs = 'p' in cell && cell.p === 1;

    if (cell.kind === 'deck' || cell.kind === 'extra') {
      const n = b[cell.p][cell.kind];
      extra = `pile pileable${n ? '' : ' empty-pile'}`;
      content = <>{n > 0 && [0, 1, 2].map(k => <div key={k} className="card back"><EyeSvg /></div>)}<div className="count">{n}</div></>;
    } else if (cell.kind === 'gy' || cell.kind === 'ban') {
      const list = cell.kind === 'gy' ? b[cell.p].gy : b[cell.p].ban.map(x => x[0]);
      const top = list[list.length - 1];
      extra = `pileable${list.length ? '' : ' empty-pile'}`;
      content = <>{list.length > 0 && (top
        ? <div className="card pile-top" data-code={top}><img src={smallImage(top)} alt="" onError={e => imageFallback(e, top)} /></div>
        : <div className="card back"><EyeSvg /></div>)}<div className="count">{list.length}</div></>;
    } else if (cell.kind === 'emz') {
      const owner = cell.slots.find(([p, seq]) => b[p].m[seq]);
      if (owner) { const fc = b[owner[0]].m[owner[1]]!; content = <CardFace key={`${owner[0]}-${fc[0]}`} card={fc} monster />; theirs = owner[0] === 1; }
    } else if (cell.kind === 'm' || cell.kind === 'st' || cell.kind === 'fieldz') {
      const card = (cell.kind === 'm' ? b[cell.p].m : b[cell.p].s)[cell.seq];
      if (card) { content = <CardFace key={card[0]} card={card} monster={cell.kind === 'm'} />; if (card[0] && card[1] & FACEDOWN) extra = 'peek'; }
    } else if (cell.kind === 'emblem') content = <EyeSvg />;

    const kindClass = cell.kind === 'emblem' ? 'none emblem' : cell.kind;
    const label = { m: 'MZ', st: 'S/T', emz: 'EMZ', fieldz: 'FIELD', gy: 'GY', ban: 'BAN', deck: 'DECK', extra: 'EXTRA', none: '', emblem: '' }[cell.kind];
    const pile = 'p' in cell && (cell.kind === 'gy' || cell.kind === 'ban' || cell.kind === 'deck' || cell.kind === 'extra') ? cell : null;
    const mark = marks?.get(i);
    const click = pile ? (e: React.MouseEvent<HTMLElement>) => onPile(pile.p, pile.kind, e.currentTarget)
      : mark && onCell ? (e: React.MouseEvent<HTMLElement>) => onCell(i, e.currentTarget) : undefined;
    return (
      <div key={i} className={`zone ${kindClass} ${extra} ${flags} ${theirs ? 'theirs' : ''} ${mark ?? ''}`} data-label={label} onClick={click}>
        {content}
        {chainLinks.map(n => <div key={n} className={`link ${frame.solving === n ? 'solving' : ''}`}>{n}</div>)}
      </div>
    );
  });

  return (
    <div className="field-wrap">
      <div className="field">
        {cells}
        {/* a negated column (e.g. a Set Infinite Impermanence): your zone seq k is grid column k+1, theirs is 5-k */}
        {frame.columns.map((c, i) => <div key={i} className="colneg" style={{ left: (c.p === 0 ? c.seq + 1 : 5 - c.seq) * COL - 6, width: W + 12 }}><span>Column negated</span></div>)}
        {frame.attack && <AttackArrow attack={frame.attack} />}
        {fx.map(f => <Fx key={f.id} fx={f} />)}
      </div>
    </div>
  );
}

/** Effects sit on the field grid at their cell, independent of the cards, so they finish even if the board moves on. */
function Fx({ fx }: { fx: CellFx }) {
  const r = Math.floor(fx.cell / 7), c = fx.cell % 7;
  const style = { left: c * COL, top: r * ROW, width: W, height: H };
  if (fx.kind === 'summon') return <div className={`fx-summon s-${fx.summon}`} style={style}><i /><i /><i /></div>;
  return (
    <div className={`fx-leave to-${fx.to} ${fx.theirs ? 'theirs' : ''}`} style={style}>
      <div className={`card ${fx.code ? '' : 'back'}`}>{fx.code ? <img src={smallImage(fx.code)} alt="" onError={e => imageFallback(e, fx.code)} /> : <EyeSvg />}</div>
    </div>
  );
}

function AttackArrow({ attack }: { attack: NonNullable<Frame['attack']> }) {
  const from = gridOf(attack.from);
  if (!from) return null;
  const to = attack.to && gridOf(attack.to);
  const ax = from[1] * COL + W / 2, ay = from[0] * ROW + H / 2;
  const tx = to ? to[1] * COL + W / 2 : ax, ty = to ? to[0] * ROW + H / 2 : attack.from.p === 0 ? -40 : 5 * ROW + 26;
  const mx = (ax + tx) / 2 + 50, my = (ay + ty) / 2;
  const d = `M${ax} ${ay} Q${mx} ${my} ${tx} ${ty}`;
  return (
    <svg className="arrow" viewBox="0 0 728 726">
      <defs>
        <linearGradient id="ag" gradientUnits="userSpaceOnUse" x1={ax} y1={ay} x2={tx} y2={ty}><stop offset="0" stopColor="#ff6b4a" stopOpacity="0" /><stop offset="1" stopColor="#ff6b4a" /></linearGradient>
        <marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#ff6b4a" /></marker>
      </defs>
      <path d={d} stroke="url(#ag)" strokeWidth="12" fill="none" strokeLinecap="round" markerEnd="url(#ah)" style={{ filter: 'drop-shadow(0 0 10px rgba(255,90,60,.8))' }} />
    </svg>
  );
}
