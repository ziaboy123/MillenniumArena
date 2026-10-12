// The less common choices, each in a window over the field like the card picker: cards adding up to a Level,
// counters to remove, the order of cards, declaring a Type/Attribute, and declaring a card name.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sumIsValid, type Prompt, type PromptAnswer, type PromptCard } from '@arena/shared';
import { allCards, card, imageFallback, smallImage } from '../lib/cards.ts';
import { EyeSvg } from '../lib/ui.tsx';

type Answer = (a: PromptAnswer) => void;
type Of<K extends Prompt['kind']> = Extract<Prompt, { kind: K }>;

const LOC: Record<PromptCard['loc'], string> = { hand: 'Hand', m: 'Field', s: 'Field', gy: 'GY', ban: 'Banished', deck: 'Deck', extra: 'Extra Deck' };
const tag = (c: PromptCard) => `${c.p === 1 ? "Opponent's " : ''}${c.mat ? 'Material' : LOC[c.loc]}`;

function CardImg({ code }: { code: number }) {
  return code ? <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} /> : <div className="card back pk-back"><EyeSvg /></div>;
}

/** The shared window: title, a status line, the cards, the buttons, and "Look at the field" to tuck it away. */
function Window({ title, status, retry, small, children, buttons }: { title: string; status: ReactNode; retry?: boolean; small?: boolean; children: ReactNode; buttons: ReactNode }) {
  const [tucked, setTucked] = useState(false);
  if (tucked) return <button className="panel picker-tab" onClick={() => setTucked(false)}><b>{title}</b><span>Show</span></button>;
  return (
    <div className={`panel picker ${small ? 'small' : ''}`}>
      <div className="pk-head">
        <div><div className="eyebrow">{status}</div><h3>{title}</h3></div>
        <button className="pk-tuck" onClick={() => setTucked(true)} title="Look at the field">Look at the field</button>
      </div>
      {retry && <div className="pp-retry">That choice isn't allowed here. Try another.</div>}
      {children}
      <div className="btns">{buttons}</div>
    </div>
  );
}

/** Cards whose Levels (or other values) add up to a target, e.g. Tributes for a Ritual Summon. */
export function SumPicker({ prompt, onAnswer }: { prompt: Of<'sum'>; onAnswer: Answer }) {
  const [sel, setSel] = useState<number[]>([]);
  const chosen = [...prompt.must.map(c => c.values), ...sel.map(i => prompt.cards[i].values)];
  const low = chosen.reduce((s, v) => s + Math.min(...v), 0), high = chosen.reduce((s, v) => s + Math.max(...v), 0);
  const countOk = !prompt.exact || (sel.length >= prompt.min && sel.length <= prompt.max);
  const ok = countOk && sumIsValid(chosen, prompt.target, prompt.exact);
  const toggle = (i: number) => setSel(s => (s.includes(i) ? s.filter(x => x !== i) : [...s, i]));
  const value = (v: number[]) => v.join(' or ');
  return (
    <Window title={prompt.title} retry={prompt.retry}
      status={<>{prompt.exact ? 'Exactly' : 'At least'} {prompt.target} · chosen <b className={ok ? 'ok' : ''}>{low === high ? low : `${low}–${high}`}</b>{!prompt.exact && ' · no spare cards'}</>}
      buttons={<button className="btn primary" disabled={!ok} onClick={() => onAnswer({ kind: 'sum', indices: sel })}>Confirm</button>}>
      <div className="pk-grid">
        {prompt.must.map((c, i) => (
          <div key={`m${i}`} className="pk-card on locked" data-code={c.code || undefined} title="Always included">
            <div className="pk-img"><CardImg code={c.code} /><span className="pk-val">{value(c.values)}</span><span className="pk-lock">Included</span></div><div className="pk-tag">{tag(c)}</div>
          </div>
        ))}
        {prompt.cards.map((c, i) => (
          <div key={i} className={`pk-card ${sel.includes(i) ? 'on' : ''}`} data-code={c.code || undefined} onClick={() => toggle(i)}>
            <div className="pk-img"><CardImg code={c.code} /><span className="pk-val">{value(c.values)}</span>{sel.includes(i) && <span className="pk-n">✓</span>}</div>
            <div className="pk-tag">{tag(c)}</div>
          </div>
        ))}
      </div>
    </Window>
  );
}

/** Remove a number of counters, spread over the cards that hold them. */
export function CounterPicker({ prompt, onAnswer }: { prompt: Of<'counters'>; onAnswer: Answer }) {
  const [counts, setCounts] = useState(() => prompt.cards.map(() => 0));
  const total = counts.reduce((s, n) => s + n, 0);
  const step = (i: number, d: number) => setCounts(cs => cs.map((n, j) => (j === i ? Math.max(0, Math.min(prompt.cards[i].has, n + d, n + (prompt.count - total))) : n)));
  return (
    <Window title={prompt.title} retry={prompt.retry} status={<>Removed <b className={total === prompt.count ? 'ok' : ''}>{total}</b> of {prompt.count}</>}
      buttons={<button className="btn primary" disabled={total !== prompt.count} onClick={() => onAnswer({ kind: 'counters', counts })}>Confirm</button>}>
      <div className="pk-grid">
        {prompt.cards.map((c, i) => (
          <div key={i} className={`pk-card ${counts[i] ? 'on' : ''}`} data-code={c.code || undefined}>
            <div className="pk-img"><CardImg code={c.code} /><span className="pk-val">{c.has} {prompt.counter}{c.has === 1 ? '' : 's'}</span></div>
            <div className="stepper"><button onClick={() => step(i, -1)} disabled={!counts[i]}>−</button><b>{counts[i]}</b><button onClick={() => step(i, 1)} disabled={counts[i] >= c.has || total >= prompt.count}>+</button></div>
          </div>
        ))}
      </div>
    </Window>
  );
}

/** Put cards in order by clicking them 1, 2, 3…; click a numbered card to take it (and those after it) back. */
export function SortPicker({ prompt, onAnswer }: { prompt: Of<'sort'>; onAnswer: Answer }) {
  const [seq, setSeq] = useState<number[]>([]);
  const n = prompt.cards.length, done = seq.length === n;
  const click = (i: number) => setSeq(s => (s.includes(i) ? s.slice(0, s.indexOf(i)) : [...s, i]));
  // the engine wants, for each card in the prompt's order, the place it was given
  const order = () => prompt.cards.map((_, i) => seq.indexOf(i));
  return (
    <Window title={prompt.title} retry={prompt.retry}
      status={prompt.chain ? 'Click them in Chain Link order (1 = Chain Link 1)' : 'Click them from top to bottom (1 = the top card)'}
      buttons={<>
        <button className="btn primary" disabled={!done} onClick={() => onAnswer({ kind: 'sort', order: order() })}>Confirm</button>
        <button className="btn ghost" onClick={() => onAnswer({ kind: 'sort', order: null })}>Keep this order</button>
      </>}>
      <div className="pk-grid">
        {prompt.cards.map((c, i) => (
          <div key={i} className={`pk-card ${seq.includes(i) ? 'on' : ''}`} data-code={c.code || undefined} onClick={() => click(i)}>
            <div className="pk-img"><CardImg code={c.code} />{seq.includes(i) && <span className="pk-n">{seq.indexOf(i) + 1}</span>}</div>
            <div className="pk-tag">{tag(c)}</div>
          </div>
        ))}
      </div>
    </Window>
  );
}

const ATTRIBUTE_COLOURS: Record<string, string> = { EARTH: '#9b7b4f', WATER: '#3d8fd6', FIRE: '#e0543a', WIND: '#3fae6a', LIGHT: '#d9b94a', DARK: '#8a4fd1', DIVINE: '#c9a227' };

/** Declare one or more Types or Attributes. */
export function DeclarePicker({ prompt, onAnswer }: { prompt: Of<'declare'>; onAnswer: Answer }) {
  const [sel, setSel] = useState<number[]>([]);
  const toggle = (bit: number) => setSel(s => (s.includes(bit) ? s.filter(b => b !== bit) : prompt.count === 1 ? [bit] : s.length < prompt.count ? [...s, bit] : s));
  const what = prompt.what === 'type' ? 'Type' : 'Attribute';
  return (
    <Window title={prompt.title} retry={prompt.retry} small status={`Choose ${prompt.count} ${what}${prompt.count === 1 ? '' : 's'}`}
      buttons={<button className="btn primary" disabled={sel.length !== prompt.count} onClick={() => onAnswer({ kind: 'declare', bits: sel })}>Declare</button>}>
      <div className={`dchips ${prompt.what}`}>
        {prompt.options.map(o => (
          <button key={o.bit} className={`dchip ${sel.includes(o.bit) ? 'on' : ''}`} onClick={() => toggle(o.bit)} onDoubleClick={() => prompt.count === 1 && onAnswer({ kind: 'declare', bits: [o.bit] })}
            style={prompt.what === 'attribute' ? { ['--chip' as string]: ATTRIBUTE_COLOURS[o.label] ?? 'var(--accent)' } : undefined}>{o.label}</button>
        ))}
      </div>
    </Window>
  );
}

/** Declare a card name: search every card that may be declared; cards seen in this duel are offered first. */
export function CardNamePicker({ prompt, seen, onAnswer }: { prompt: Of<'cardname'>; seen: number[]; onAnswer: Answer }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const allowed = useMemo(() => new Set(prompt.codes), [prompt.codes]);
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return seen.filter(c => allowed.has(c)).slice(0, 30);
    const starts: number[] = [], has: number[] = [];
    for (const c of allCards()) {
      if (!allowed.has(c.code)) continue;
      const name = c.name.toLowerCase();
      if (name.startsWith(needle)) starts.push(c.code); else if (name.includes(needle)) has.push(c.code);
      if (starts.length >= 60) break;
    }
    return [...starts, ...has].slice(0, 60);
  }, [q, allowed, seen]);
  return (
    <Window title={prompt.title} retry={prompt.retry} status={`${prompt.codes.length.toLocaleString()} cards can be declared`}
      buttons={<button className="btn primary" disabled={pick === null} onClick={() => pick !== null && onAnswer({ kind: 'cardname', code: pick })}>Declare{pick !== null ? ` ${card(pick)?.name ?? ''}` : ''}</button>}>
      <input ref={input} className="pk-search" placeholder="Type a card name…" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && results.length) { if (pick !== null) onAnswer({ kind: 'cardname', code: pick }); else setPick(results[0]); } }} />
      <div className="eyebrow pk-sub">{q.trim() ? (results.length ? `${results.length === 60 ? 'First 60' : results.length} matching` : 'No card with that name can be declared') : seen.some(c => allowed.has(c)) ? 'Seen in this duel' : 'Start typing to search'}</div>
      <div className="names">
        {results.map(code => (
          <button key={code} className={`name ${pick === code ? 'on' : ''}`} data-code={code} onClick={() => setPick(code)} onDoubleClick={() => onAnswer({ kind: 'cardname', code })}>
            <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} /><span><b>{card(code)?.name}</b><small>{card(code)?.typeLine}</small></span>
          </button>
        ))}
      </div>
    </Window>
  );
}
