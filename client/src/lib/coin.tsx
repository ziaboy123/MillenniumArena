// The coin toss: a two-faced coin that's tossed up, flips end over end and lands on the winner's face.
// Used by private rooms (game 1) and by duels against the bot set to "Coin toss". The look is in pages.css (.coin3d).
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export interface CoinFace { mark: ReactNode; label: string }
/** How long the toss takes, landing included (the CSS animations in pages.css last this long). */
export const FLIP_MS = 1900;

/** `faces[0]` is the face showing before the toss; the coin lands with `faces[winner]` up, then calls `onLanded`. */
export function Coin({ faces, winner, flipping, onLanded }: { faces: [CoinFace, CoinFace]; winner: 0 | 1; flipping: boolean; onLanded?: () => void }) {
  const landed = useRef(onLanded);
  landed.current = onLanded;
  useEffect(() => {
    if (!flipping) return;
    // with reduced motion there's no flip: the coin just shows the winner
    const t = setTimeout(() => landed.current?.(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : FLIP_MS);
    return () => clearTimeout(t);
  }, [flipping]);
  // five full turns, plus a half turn when the back face wins
  const style = { '--end': `${1800 + winner * 180}deg` } as CSSProperties;
  return (
    <div className={`coin3d ${flipping ? 'flip' : 'landed'}`} style={style} role="img" aria-label={flipping ? 'Tossing a coin' : `The coin landed on ${faces[winner].label}`}>
      <div className="cshadow" />
      <div className="ctoss">
        <div className="cspin">
          {/* the coin's edge: thin discs stacked between the two faces, seen while it turns */}
          {[-3, -2, -1, 0, 1, 2, 3].map(z => <i key={z} className="crim" style={{ transform: `translateZ(${z}px)` }} />)}
          <div className="cface front"><b>{faces[0].mark}</b><span>{faces[0].label}</span></div>
          <div className="cface back"><b>{faces[1].mark}</b><span>{faces[1].label}</span></div>
        </div>
      </div>
    </div>
  );
}

/** A name's coin mark: its first letter. */
export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
