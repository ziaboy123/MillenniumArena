// How you answer the engine: the prompt panel beside the field, the card picker, the battle-position picker
// and the small menu that opens on a card. Sides here are yours: 0 = you, 1 = your opponent.
import { useEffect, useState } from 'react';
import type { IdleAct, Phase, Prompt, PromptAnswer, PromptCard } from '@arena/shared';
import { cardName, imageFallback, smallImage } from '../lib/cards.ts';
import { EyeSvg } from '../lib/ui.tsx';

export interface MenuItem { label: string; sub?: string; run: () => void; danger?: boolean }
/** Something a card can do for the prompt on screen. */
export interface CardActions { card: PromptCard; actions: { label: string; sub?: string; answer: PromptAnswer }[] }

const LOC_LABEL: Record<PromptCard['loc'], string> = { hand: 'Hand', m: 'Field', s: 'Field', gy: 'GY', ban: 'Banished', deck: 'Deck', extra: 'Extra Deck' };
const PHASE_NAME: Partial<Record<Phase, string>> = { M1: 'Main Phase 1', M2: 'Main Phase 2', BP: 'Battle Phase' };

/** Card effect texts are often written as questions for yes/no prompts ("Add 1 card to your hand?"). */
export const effectText = (s?: string) => (s ?? '').trim().replace(/\?$/, '');

export const cardKey = (c: Pick<PromptCard, 'p' | 'loc' | 'seq' | 'mat'>) => (c.mat ? `${c.p}:m:${c.seq}` : `${c.p}:${c.loc}:${c.seq}`);

/** Group the prompt's choices by the card they belong to, so a click on that card can offer them. */
export function actionsByCard(prompt: Prompt | null): Map<string, CardActions> {
  const map = new Map<string, CardActions>();
  const add = (card: PromptCard, label: string, answer: PromptAnswer, activate: boolean) => {
    const k = cardKey(card);
    if (!map.has(k)) map.set(k, { card, actions: [] });
    // effects show as "Activate" with what the effect does underneath
    const sub = activate && label !== 'Activate' ? effectText(label) : undefined;
    map.get(k)!.actions.push({ label: activate ? 'Activate' : label, ...(sub ? { sub } : {}), answer });
  };
  if (prompt?.kind === 'idle') for (const a of prompt.actions) add(a.card, a.label, { kind: 'idle', act: a.act as IdleAct, index: a.index }, a.act === 'activate');
  if (prompt?.kind === 'battle') for (const a of prompt.actions) add(a.card, a.label, { kind: 'battle', act: a.act === 'attack' ? 'attack' : 'activate', index: a.index }, a.act === 'activate');
  if (prompt?.kind === 'chain') prompt.cards.forEach((c, index) => add(c, c.desc || 'Activate', { kind: 'chain', index }, true));
  return map;
}

function CardImg({ code }: { code: number }) {
  return code ? <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} /> : <div className="card back pk-back"><EyeSvg /></div>;
}

/** The menu that opens above (or below) a card you clicked. */
export function ActionMenu({ x, y, below, title, items, onClose }: { x: number; y: number; below: boolean; title?: string; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className={`panel actmenu ${below ? 'below' : ''}`} style={{ left: x, top: y }}>
      {title && <div className="am-title">{title}</div>}
      {items.map((it, i) => <button key={i} className={it.danger ? 'danger' : ''} onClick={it.run}>{it.label}{it.sub && <small>{it.sub}</small>}</button>)}
    </div>
  );
}

/** The panel beside the field: what the engine is asking, with the buttons that answer it. */
export function PromptPanel({ prompt, phase, loose, zonesLeft, onAnswer, onAutoZone }: {
  prompt: Prompt; phase: Phase; loose: CardActions[]; zonesLeft: number;
  onAnswer: (a: PromptAnswer) => void; onAutoZone: () => void;
}) {
  const [chosen, setChosen] = useState<number | null>(prompt.kind === 'chain' && prompt.cards.length === 1 ? 0 : null);
  const retry = prompt.retry && <div className="pp-retry">That choice isn't allowed here. Try another.</div>;
  const looseRows = loose.flatMap(({ card, actions }) => actions.map((a, i) => (
    <button key={`${cardKey(card)}${i}`} className="opt" data-code={card.code || undefined} onClick={() => onAnswer(a.answer)}>
      <CardImg code={card.code} /><div><b>{cardName(card.code)}</b><span>{a.sub ?? a.label} · {LOC_LABEL[card.loc]}</span></div>
    </button>
  )));

  switch (prompt.kind) {
    case 'idle':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">{PHASE_NAME[phase] ?? 'Main Phase'}</div>
          <h3>Your move</h3>
          <div className="sub">{prompt.actions.length ? 'Click a glowing card to use it.' : 'Nothing you can use right now.'}</div>
          {looseRows.length > 0 && <div className="pp-list">{looseRows}</div>}
          <div className="btns">
            {prompt.toBP && <button className="btn primary" onClick={() => onAnswer({ kind: 'idle', act: 'bp' })}>Battle Phase</button>}
            {prompt.toEP && <button className={`btn ${prompt.toBP ? 'ghost' : 'primary'}`} onClick={() => onAnswer({ kind: 'idle', act: 'ep' })}>End Turn</button>}
          </div>
        </div>
      );
    case 'battle':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">Battle Phase</div>
          <h3>{prompt.actions.some(a => a.act === 'attack') ? 'Attack or move on' : 'Move on'}</h3>
          <div className="sub">{prompt.actions.length ? 'Click a glowing monster to attack or use it.' : 'Nothing can attack right now.'}</div>
          {looseRows.length > 0 && <div className="pp-list">{looseRows}</div>}
          <div className="btns">
            {prompt.toM2 && <button className="btn primary" onClick={() => onAnswer({ kind: 'battle', act: 'm2' })}>Main Phase 2</button>}
            {prompt.toEP && <button className={`btn ${prompt.toM2 ? 'ghost' : 'primary'}`} onClick={() => onAnswer({ kind: 'battle', act: 'ep' })}>End Turn</button>}
          </div>
        </div>
      );
    case 'chain':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">{prompt.forced ? 'You must activate one' : 'Chance to respond'}</div>
          <h3>{prompt.title}</h3>
          <div className="pp-list">
            {prompt.cards.map((c, i) => (
              <button key={i} className={`opt ${chosen === i ? 'sel' : ''}`} data-code={c.code || undefined} onClick={() => setChosen(i)} onDoubleClick={() => onAnswer({ kind: 'chain', index: i })}>
                <CardImg code={c.code} /><div><b>{cardName(c.code)}</b><span>{effectText(c.desc) || 'Activate'} · {LOC_LABEL[c.loc]}</span></div>
              </button>
            ))}
          </div>
          <div className="btns">
            <button className="btn primary" disabled={chosen === null} onClick={() => chosen !== null && onAnswer({ kind: 'chain', index: chosen })}>Activate</button>
            {!prompt.forced && <button className="btn ghost" onClick={() => onAnswer({ kind: 'chain', index: null })}>Pass</button>}
          </div>
        </div>
      );
    case 'yesno':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">{prompt.title}</div>
          {prompt.card && prompt.card.code > 0 && <div className="opt static" data-code={prompt.card.code}><CardImg code={prompt.card.code} /><div><b>{cardName(prompt.card.code)}</b><span>{LOC_LABEL[prompt.card.loc]}</span></div></div>}
          <h3 className="pp-q">{prompt.text}</h3>
          <div className="btns">
            <button className="btn primary" onClick={() => onAnswer({ kind: 'yesno', yes: true })}>Yes</button>
            <button className="btn ghost" onClick={() => onAnswer({ kind: 'yesno', yes: false })}>No</button>
          </div>
        </div>
      );
    case 'option':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">Choose one</div>
          <h3>{prompt.title}</h3>
          <div className="pp-list">
            {prompt.options.map((o, i) => <button key={i} className="opt text" onClick={() => onAnswer({ kind: 'option', index: i })}><div><b>{o}</b></div></button>)}
          </div>
        </div>
      );
    case 'place':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">Zone</div>
          <h3>{prompt.title}</h3>
          <div className="sub">Click a highlighted zone on the field{prompt.count > 1 ? ` (${zonesLeft} more)` : ''}.</div>
          <div className="btns"><button className="btn ghost" onClick={onAutoZone}>Choose for me</button></div>
        </div>
      );
    case 'number':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">Declare a number</div>
          <h3>{prompt.title}</h3>
          <div className="numbers">
            {prompt.options.map((n, i) => <button key={i} className="btn ghost" onClick={() => onAnswer({ kind: 'number', index: i })}>{n}</button>)}
          </div>
        </div>
      );
    case 'rps':
      return (
        <div className="panel prompt">
          {retry}
          <div className="eyebrow">Rock, paper, scissors</div>
          <h3>Choose your hand</h3>
          <div className="rps">
            {([[2, 'Rock', '✊'], [3, 'Paper', '✋'], [1, 'Scissors', '✌️']] as const).map(([hand, label, icon]) => (
              <button key={hand} onClick={() => onAnswer({ kind: 'rps', hand })}><span>{icon}</span>{label}</button>
            ))}
          </div>
        </div>
      );
    default:
      return null;   // card, position and the other choices open their own window over the field
  }
}

/** Choosing cards: a window over the field with every card on offer. It can be tucked away to look at the field. */
export function CardPicker({ prompt, onAnswer }: { prompt: Extract<Prompt, { kind: 'cards' | 'unselect' }>; onAnswer: (a: PromptAnswer) => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const [tucked, setTucked] = useState(false);
  const range = prompt.min === prompt.max ? `${prompt.max}` : prompt.min === 0 ? `up to ${prompt.max}` : `${prompt.min} to ${prompt.max}`;
  const tag = (c: PromptCard) => `${c.p === 1 ? "Opponent's " : ''}${c.mat ? 'Material' : LOC_LABEL[c.loc]}`;

  if (tucked) return <button className="panel picker-tab" onClick={() => setTucked(false)}><b>{prompt.title}</b><span>Show cards</span></button>;

  let body: React.ReactNode, status: string, buttons: React.ReactNode;
  if (prompt.kind === 'cards') {
    const weight = (i: number) => prompt.weights?.[i] ?? 1;
    const total = sel.reduce((s, i) => s + weight(i), 0);
    const ok = sel.length <= prompt.max && (prompt.weights ? total >= prompt.min : sel.length >= prompt.min);
    const toggle = (i: number) => setSel(s => (s.includes(i) ? s.filter(x => x !== i) : prompt.max === 1 ? [i] : s.length < prompt.max ? [...s, i] : s));
    status = prompt.weights ? `Tributes: ${total} of ${prompt.min}` : `Choose ${range} · ${sel.length} chosen`;
    body = prompt.cards.map((c, i) => (
      <div key={i} className={`pk-card ${sel.includes(i) ? 'on' : ''}`} data-code={c.code || undefined} onClick={() => toggle(i)}
        onDoubleClick={() => { if (prompt.max === 1 && prompt.min <= 1) onAnswer({ kind: 'cards', indices: [i] }); }}>
        <div className="pk-img"><CardImg code={c.code} />{weight(i) > 1 && <span className="pk-w">×{weight(i)}</span>}{sel.includes(i) && <span className="pk-n">{prompt.max > 1 ? sel.indexOf(i) + 1 : '✓'}</span>}</div>
        <div className="pk-tag">{tag(c)}</div>
      </div>
    ));
    buttons = <>
      <button className="btn primary" disabled={!ok} onClick={() => onAnswer({ kind: 'cards', indices: sel })}>Confirm</button>
      {prompt.canCancel && <button className="btn ghost" onClick={() => onAnswer({ kind: 'cards', indices: null })}>Cancel</button>}
    </>;
  } else {
    const n = prompt.cards.length;
    // the engine's min/max here count what's still needed at this step, so only the running total is shown
    status = prompt.picked.length ? `${prompt.picked.length} chosen · click one to take it back` : 'Choose one at a time';
    body = <>
      {prompt.picked.map((c, j) => (
        <div key={`p${j}`} className="pk-card on" data-code={c.code || undefined} title="Click to take it back" onClick={() => onAnswer({ kind: 'unselect', index: n + j })}>
          <div className="pk-img"><CardImg code={c.code} /><span className="pk-n">✓</span></div><div className="pk-tag">{tag(c)}</div>
        </div>
      ))}
      {prompt.cards.map((c, i) => (
        <div key={`c${i}`} className="pk-card" data-code={c.code || undefined} onClick={() => onAnswer({ kind: 'unselect', index: i })}>
          <div className="pk-img"><CardImg code={c.code} /></div><div className="pk-tag">{tag(c)}</div>
        </div>
      ))}
    </>;
    buttons = (prompt.canFinish || prompt.canCancel) && (
      <button className={`btn ${prompt.canFinish ? 'primary' : 'ghost'}`} onClick={() => onAnswer({ kind: 'unselect', index: null })}>{prompt.canFinish ? 'Done' : 'Cancel'}</button>
    );
  }
  return (
    <div className="panel picker">
      <div className="pk-head">
        <div><div className="eyebrow">{status}</div><h3>{prompt.title}</h3></div>
        <button className="pk-tuck" onClick={() => setTucked(true)} title="Look at the field">Look at the field</button>
      </div>
      {prompt.retry && <div className="pp-retry">That choice isn't allowed here. Try another.</div>}
      <div className="pk-grid">{body}</div>
      <div className="btns">{buttons}</div>
    </div>
  );
}

const POSITIONS: Record<number, [label: string, faceDown: boolean, sideways: boolean]> = {
  1: ['Attack Position', false, false], 4: ['Defense Position', false, true], 8: ['Set (face-down Defense)', true, true], 2: ['Face-down Attack', true, false],
};

export function PositionPicker({ prompt, onAnswer }: { prompt: Extract<Prompt, { kind: 'position' }>; onAnswer: (a: PromptAnswer) => void }) {
  return (
    <div className="panel picker small">
      <div className="pk-head"><div><div className="eyebrow">{cardName(prompt.code)}</div><h3>{prompt.title}</h3></div></div>
      <div className="pos-row">
        {prompt.positions.map(p => {
          const [label, down, side] = POSITIONS[p];
          return (
            <button key={p} className="pos" onClick={() => onAnswer({ kind: 'position', position: p })}>
              <div className={`pos-card ${side ? 'side' : ''}`} data-code={prompt.code}>{down ? <div className="card back pk-back"><EyeSvg /></div> : <CardImg code={prompt.code} />}</div>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
