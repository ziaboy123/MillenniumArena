// "Dueling with": your chosen deck, and a list of your decks to switch to. Decks that can't be used under the
// current rules (the bot, or a room's banlist and deck check) say why and can't be picked.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { SavedDeck } from '@arena/shared/decks';
import { imageFallback, smallImage } from '../lib/cards.ts';
import { Link } from '../lib/router.tsx';
import { coverOf } from './Decks.tsx';

const counts = (d: SavedDeck) => `${d.main.length} main · ${d.extra.length} extra · ${d.side.length} side`;

export function DeckPicker({ decks, value, onChange, blocker, disabled }: {
  decks: SavedDeck[]; value: string | null; onChange: (id: string) => void; blocker: (d: SavedDeck) => string | null; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ stage: HTMLElement; style: CSSProperties } | null>(null);
  const box = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!(box.current?.contains(t as Node) || list.current?.contains(t as Node));
    const away = (e: MouseEvent) => { if (!inside(e.target)) setOpen(false); };
    // the list doesn't follow the chip, so it closes when the page scrolls under it or the window changes size
    const moved = (e: Event) => { if (!inside(e.target)) setOpen(false); };
    const close = () => setOpen(false), esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', away); addEventListener('scroll', moved, true); addEventListener('resize', close); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('scroll', moved, true); removeEventListener('resize', close); removeEventListener('keydown', esc); };
  }, [open]);
  /** The list is drawn on the stage, outside every panel (their cut corners would clip it), under the chip or above it,
   *  whichever has room. The stage is scaled to fit the window, so screen positions are divided by its scale. */
  const placeList = () => {
    const chip = box.current, stage = chip?.closest<HTMLElement>('.stage');
    if (!chip || !stage) return null;
    const s = stage.getBoundingClientRect(), c = chip.getBoundingClientRect(), k = s.width / stage.offsetWidth || 1;
    const below = (s.bottom - c.bottom) / k - 16, above = (c.top - s.top) / k - 16, down = below >= 260 || below >= above;
    const width = Math.max(380, c.width / k), left = Math.max(8, Math.min((c.left - s.left) / k, stage.offsetWidth - width - 8));
    const style: CSSProperties = { left, width, maxHeight: Math.max(160, Math.min(360, down ? below : above)),
      ...(down ? { top: (c.bottom - s.top) / k + 8 } : { bottom: (s.bottom - c.top) / k + 8 }) };
    return { stage, style };
  };
  const d = decks.find(x => x.id === value);
  if (!decks.length) return <div className="deckchip empty"><div><div className="nm">No decks yet</div><div className="ct"><Link to="/decks">Build or import one on the Decks page</Link></div></div></div>;
  const img = (x: SavedDeck) => { const c = coverOf(x); return c ? <img src={smallImage(c)} alt="" onError={e => imageFallback(e, c)} /> : <div className="noimg" />; };
  const why = d ? blocker(d) : null;
  return (
    <div ref={box} className={`deckchip ${disabled ? 'off' : ''}`} onClick={() => {
      if (disabled) return;
      if (!open) setPlace(placeList());
      setOpen(o => !o);
    }}>
      {d ? <>{img(d)}<div className="dmeta"><div className="nm">{d.name}<span className={`legal ${why ? 'bad' : 'ok'}`}>{why ? 'Not usable' : 'Ready'}</span></div><div className="ct">{why ?? counts(d)}</div></div></>
        : <div className="dmeta"><div className="nm">Choose a deck</div><div className="ct">{decks.length} decks</div></div>}
      {!disabled && <svg className="i chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>}
      {open && place && createPortal(
        <div ref={list} className="panel decklist" style={place.style} onClick={e => e.stopPropagation()}>
          {decks.map(x => {
            const no = blocker(x);
            return (
              <div key={x.id} className={`drow ${x.id === value ? 'sel' : ''} ${no ? 'no' : ''}`} title={no ?? ''} onClick={() => { if (!no) { onChange(x.id); setOpen(false); } }}>
                {img(x)}<div className="dmeta"><div className="nm">{x.name}<span className={`legal ${no ? 'bad' : 'ok'}`}>{no ? 'Not usable' : 'Ready'}</span></div><div className="ct">{no ?? counts(x)}</div></div>
              </div>
            );
          })}
        </div>,
        place.stage,
      )}
    </div>
  );
}
