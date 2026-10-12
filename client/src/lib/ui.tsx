// Small shared pieces: the Eye mark, background, theme, and the 1600×900 stage that scales to the window.
import { useEffect, useMemo, useState, type ReactNode } from 'react';

const EYE = `<svg viewBox="0 0 100 64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 14 Q50 -2 92 12"/><path d="M6 30 Q50 4 94 30 Q50 50 6 30Z"/>
  <circle cx="50" cy="28" r="9" fill="currentColor" stroke="none"/>
  <path d="M38 44 L32 60"/><path d="M56 44 Q60 58 72 58 Q82 56 80 48 Q78 42 72 46"/></svg>`;

export const Eye = ({ className }: { className?: string }) => <span className={className ?? 'eye'} dangerouslySetInnerHTML={{ __html: EYE }} />;
export const EyeSvg = () => <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: EYE }} />;

export const THEMES = [
  { k: 'c', name: 'Arena', desc: 'The default. Graphite HUD: clean, competitive, clear.' },
  { k: 'a', name: 'Pharaoh', desc: 'Obsidian and gold. Ornate, ceremonial, ancient.' },
  { k: 'b', name: 'Hologram', desc: 'Electric cyan projections. Futuristic duel tech.' },
  { k: 'd', name: 'Shadow Game', desc: 'Violet mist and ancient dark magic.' },
] as const;

/** Arena is the default; the choice is remembered in this browser until accounts exist. */
export function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('ma-theme') ?? 'c'; } catch { return 'c'; } });
  useEffect(() => { document.body.dataset.dir = theme; try { localStorage.setItem('ma-theme', theme); } catch {} }, [theme]);
  return [theme, setTheme] as const;
}

export function Background() {
  const motes = useMemo(() => Array.from({ length: 40 }, () => ({
    left: `${10 + Math.random() * 80}%`, top: `${30 + Math.random() * 65}%`, animationDuration: `${6 + Math.random() * 8}s`, animationDelay: `${-Math.random() * 14}s`,
  })), []);
  return <>
    <div className="env" /><div className="shafts" /><div className="mist"><i /><i /></div>
    <div className="motes">{motes.map((s, i) => <i key={i} style={s} />)}</div>
  </>;
}

/** Everything is laid out at 1600×900 and scaled to fit the window, like the mockups. */
export function Stage({ children, perspective }: { children: ReactNode; perspective?: boolean }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / 1600, innerHeight / 900));
    fit(); addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return (
    <div className="viewport app-viewport">
      <div className="scaler" style={{ transform: `translate(-50%,-50%) scale(${scale})`, perspective: perspective ? undefined : 'none' }}>
        <div className="stage">{children}</div>
      </div>
    </div>
  );
}
