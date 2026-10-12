// "Dueling with": your chosen deck, and a list of your decks to switch to. Decks that can't be used under the
// current rules (the bot, or a room's banlist and deck check) say why and can't be picked.
import { useEffect, useRef, useState } from 'react';
import type { SavedDeck } from '@arena/shared/decks';
import { imageFallback, smallImage } from '../lib/cards.ts';
import { Link } from '../lib/router.tsx';
import { coverOf } from './Decks.tsx';

const counts = (d: SavedDeck) => `${d.main.length} main · ${d.extra.length} extra · ${d.side.length} side`;

export function DeckPicker({ decks, value, onChange, blocker, disabled }: {
  decks: SavedDeck[]; value: string | null; onChange: (id: string) => void; blocker: (d: SavedDeck) => string | null; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false), [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  const d = decks.find(x => x.id === value);
  if (!decks.length) return <div className="deckchip empty"><div><div className="nm">No decks yet</div><div className="ct"><Link to="/decks">Build or import one on the Decks page</Link></div></div></div>;
  const img = (x: SavedDeck) => { const c = coverOf(x); return c ? <img src={smallImage(c)} alt="" onError={e => imageFallback(e, c)} /> : <div className="noimg" />; };
  const why = d ? blocker(d) : null;
  return (
    <div ref={box} className={`deckchip ${disabled ? 'off' : ''}`} onClick={() => {
      if (disabled) return;
      setUp((box.current?.getBoundingClientRect().top ?? 0) > innerHeight / 2);
      setOpen(o => !o);
    }}>
      {d ? <>{img(d)}<div className="dmeta"><div className="nm">{d.name}<span className={`legal ${why ? 'bad' : 'ok'}`}>{why ? 'Not usable' : 'Ready'}</span></div><div className="ct">{why ?? counts(d)}</div></div></>
        : <div className="dmeta"><div className="nm">Choose a deck</div><div className="ct">{decks.length} decks</div></div>}
      {!disabled && <svg className="i chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>}
      {open && (
        <div className={`panel decklist ${up ? 'up' : ''}`} onClick={e => e.stopPropagation()}>
          {decks.map(x => {
            const no = blocker(x);
            return (
              <div key={x.id} className={`drow ${x.id === value ? 'sel' : ''} ${no ? 'no' : ''}`} title={no ?? ''} onClick={() => { if (!no) { onChange(x.id); setOpen(false); } }}>
                {img(x)}<div className="dmeta"><div className="nm">{x.name}<span className={`legal ${no ? 'bad' : 'ok'}`}>{no ? 'Not usable' : 'Ready'}</span></div><div className="ct">{no ?? counts(x)}</div></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
