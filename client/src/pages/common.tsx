// Pieces every page uses: the page frame (background, top bar, footer), toasts, code boxes, password fields.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SOURCE_URL } from '../lib/about.ts';
import { Link, navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { Eye, Stage } from '../lib/ui.tsx';

/** A page: the top bar, then the content (which scrolls under it if the window is short), then (optionally) the footer.
 *  `over` floats above the page and doesn't scroll: toasts and pop-up windows. `className` is the page's own layout. */
export function Page({ children, foot = false, back, over, mid, className = '' }: {
  children: ReactNode; foot?: boolean; back?: string; over?: ReactNode; className?: string;
  /** Shown in the top bar between the logo and your badge (the deck editor's name and legality). */
  mid?: ReactNode;
}) {
  const { me } = useSession();
  const body = useRef<HTMLElement>(null);
  useEffect(() => {
    // The window never scrolls (the page body and panels inside it do), so with nothing to aim at, the scroll keys would do
    // nothing. They scroll the page's main scroller instead, until you click inside something that scrolls: from then on
    // the browser scrolls that, as usual.
    let clickedIn: HTMLElement | null = null, clickedOn: Node | null = null;
    const click = (e: MouseEvent) => { clickedOn = e.target as Node | null; clickedIn = scrollerOf(clickedOn as Element | null); };
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.shiftKey && e.key !== ' ')) return;
      const k = e.key, dir = k === 'ArrowDown' || k === 'PageDown' || k === 'End' || (k === ' ' && !e.shiftKey) ? 1
        : k === 'ArrowUp' || k === 'PageUp' || k === 'Home' || k === ' ' ? -1 : 0;
      if (!dir) return;
      const a = document.activeElement;
      if (a?.closest('input, textarea, select, [contenteditable]')) return;   // typing
      if (k === ' ' && a && a !== document.body) return;   // Space presses a focused button
      const overlay = body.current?.parentElement?.querySelector<HTMLElement>('.overlay') ?? null;
      // after a click inside something that scrolls, the browser scrolls that, unless a window has opened over it since or
      // the thing clicked has gone (a button replaced by what it opened), which leaves the browser nothing to aim at
      if (clickedIn?.isConnected && clickedOn?.isConnected && (!overlay || overlay.contains(clickedIn))) return;
      const el = mainScroller(overlay ?? body.current, dir);
      if (!el) { if (overlay) e.preventDefault(); return; }   // with a window open, the page behind it stays put
      const page = el.clientHeight * 0.9;
      if (k === 'Home') el.scrollTo({ top: 0 });
      else if (k === 'End') el.scrollTo({ top: el.scrollHeight });
      else el.scrollBy({ top: dir * (k.startsWith('Arrow') ? 40 : page) });
      e.preventDefault();
    };
    addEventListener('mousedown', click, true); addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', click, true); removeEventListener('keydown', key); };
  }, []);
  return (
    <Stage fluid>
      <div className="ring" />
      <div className="top">
        <div className="brand">
          {back && <button className="homebtn" onClick={() => navigate(back)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>Home</button>}
          <Link to={me ? '/home' : '/'} className="logo pg-logo" aria-label="Millennium Arena"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></Link>
        </div>
        {mid && <div className="tmid">{mid}</div>}
        {me?.username
          ? <Link to="/profile" className="chip"><div className="av">{me.username[0].toUpperCase()}</div><div><b>{me.username}</b><span>Unranked</span></div></Link>
          : !me && <div className="topR"><button className="bigbtn ghost sm" onClick={() => navigate('/login')}>Log in</button><button className="bigbtn sm" onClick={() => navigate('/signup')}>Sign up</button></div>}
      </div>
      <section ref={body} className={`screen on pagebody ${className}`}>
        {children}
        {foot && <Foot />}
      </section>
      {over}
    </Stage>
  );
}

const scrolls = (el: Element) => { const y = getComputedStyle(el).overflowY; return (y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1; };
/** The nearest thing around `node` that can scroll: what the browser's scroll keys move after a click there. */
function scrollerOf(node: Element | null): HTMLElement | null {
  for (let el = node; el && !el.classList.contains('stage'); el = el.parentElement) if (scrolls(el)) return el as HTMLElement;
  return null;
}
/** What the scroll keys move otherwise: of the page body (or the open window) and the panels in it, the one on screen with
 *  the most left to scroll that way (Settings' panel, Profile's match history). Panels must be at least half in view, and
 *  once one reaches its end the page carries on. Inert things (the Welcome page's demo duel) don't count. */
function mainScroller(root: HTMLElement | null, dir: 1 | -1): HTMLElement | null {
  if (!root) return null;
  let best: HTMLElement | null = null, most = 1;
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el.scrollHeight - el.clientHeight < 2) continue;
    const left = dir > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
    if (left <= most || (el !== root && el.clientHeight <= 100) || !scrolls(el) || el.closest('[inert]')) continue;
    const r = el.getBoundingClientRect(), seen = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (seen < 80 || (el !== root && seen < r.height / 2)) continue;   // off screen, or mostly
    best = el; most = left;
  }
  return best;
}

export function Foot() {
  return (
    <div className="foot">
      <div><Link to="/privacy">Privacy</Link> &nbsp;·&nbsp; <Link to="/terms">Terms</Link> &nbsp;·&nbsp; <Link to="/safety">Staying safe</Link> &nbsp;·&nbsp; <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Source code (AGPL-3.0)</a></div>
      <div>Card data from Project Ignis, images from YGOPRODeck &nbsp;·&nbsp; Unofficial fan project, not affiliated with Konami</div>
    </div>
  );
}

/** A short message at the bottom of the screen. */
export function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 2600); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [<div key="toast" className={`panel toast ${msg ? 'on' : ''}`}>{msg}</div>, show] as const;
}

/** Six boxes for an emailed code: type, backspace, or paste the whole code. */
export function CodeBoxes({ value, onChange, autoFocus = true }: { value: string; onChange: (code: string) => void; autoFocus?: boolean }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { if (autoFocus) boxes.current[0]?.focus(); }, [autoFocus]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  /** Puts digits into the boxes from box i on, and moves to the box after them. */
  const fill = (i: number, typed: string) => {
    const next = [...digits];
    typed.slice(0, 6 - i).split('').forEach((c, k) => { next[i + k] = c; });
    onChange(next.join('').replace(/\s+$/, ''));
    boxes.current[Math.min(i + typed.length, 5)]?.focus();
  };
  return (
    <div className="code">
      {digits.map((d, i) => (
        <input key={i} ref={el => { boxes.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} value={d.trim()}
          aria-label={`Digit ${i + 1}`} onFocus={e => e.target.select()}
          onChange={e => {
            // usually one new digit, but autofill (and some keyboards) put the whole code into one box
            const raw = e.target.value.replace(/\D/g, ''), old = d.trim();
            const typed = old && raw.length === 2 ? (raw[0] === old ? raw[1] : raw[0]) : raw;
            if (typed) fill(i, typed); else onChange(digits.map((x, j) => (j === i ? ' ' : x)).join('').replace(/\s+$/, ''));
          }}
          onKeyDown={e => { if (e.key === 'Backspace' && !d.trim()) boxes.current[i - 1]?.focus(); }}
          onPaste={e => {
            const all = (e.clipboardData.getData('text').match(/\d/g) ?? []).slice(0, 6);
            if (all.length) { e.preventDefault(); onChange(all.join('')); boxes.current[Math.min(all.length, 5)]?.focus(); }
          }} />
      ))}
    </div>
  );
}

/** How strong a password looks (0 = too short). The server makes the real decision. */
export function strength(pw: string) {
  if (pw.length < 10) return 0;
  let s = 1;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export function PasswordInput({ id, value, onChange, meter, autoComplete, placeholder }: {
  id: string; value: string; onChange: (v: string) => void; meter?: boolean; autoComplete: string; placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  const s = strength(value), colours = ['#ff8a76', '#ff8a76', '#ffc76b', '#6fdc9a', '#6fdc9a'];
  return <>
    <div className="pw">
      <input className="sinput full" id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder}
        value={value} onChange={e => onChange(e.target.value)} maxLength={72} />
      <button type="button" onClick={() => setShown(v => !v)}>{shown ? 'Hide' : 'Show'}</button>
    </div>
    {meter && (
      <div className="meter">
        {[0, 1, 2, 3].map(i => <i key={i} className={i < Math.max(s, value ? 1 : 0) ? 'on' : ''} style={{ ['--c' as string]: colours[s] }} />)}
        <span>{!value ? '' : value.length < 10 ? 'Too short' : ['', 'Weak', 'OK', 'Good', 'Strong'][s]}</span>
      </div>
    )}
  </>;
}

/** Simple line icons used around the pages. */
const ICONS: Record<string, ReactNode> = {
  cards: <><rect width="12" height="16" x="8" y="4" rx="2" /><path d="M4 7v11a2 2 0 0 0 2 2h9" /></>,
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  crown: <><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></>,
  join: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></>,
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  swords: <><path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="m13 19 6-6" /><path d="m16 16 4 4" /><path d="m19 21 2-2" /><path d="M14.5 6.5 18 3h3v3l-3.5 3.5" /><path d="m5 14 4 4" /><path d="m7 17-3 3" /><path d="m3 19 2 2" /></>,
  bot: <><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>,
  star: <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />,
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>,
};

/** "just now", "5 min ago", "3 days ago", or the date. */
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const Icon = ({ name, className }: { name: keyof typeof ICONS | string; className?: string }) => (
  <svg className={className ?? 'i'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
);
