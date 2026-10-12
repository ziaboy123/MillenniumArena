// Pieces every page uses: the page frame (background, top bar, footer), toasts, code boxes, password fields.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { Background, Eye, Stage } from '../lib/ui.tsx';

/** A page: the themed background, the top bar, the content and (optionally) the footer. */
export function Page({ children, foot = false, back }: { children: ReactNode; foot?: boolean; back?: string }) {
  const { me } = useSession();
  return (
    <Stage>
      <Background />
      <div className="ring" />
      <div className="top">
        <div className="brand">
          {back && <button className="homebtn" onClick={() => navigate(back)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>Home</button>}
          <Link to={me ? '/home' : '/'} className="logo pg-logo" aria-label="Millennium Arena"><Eye /><div className="w">MILLENNIUM<small>ARENA</small></div></Link>
        </div>
        {me?.username
          ? <Link to="/profile" className="chip"><div className="av">{me.username[0].toUpperCase()}</div><div><b>{me.username}</b><span>Unranked</span></div></Link>
          : !me && <div className="topR"><button className="bigbtn ghost sm" onClick={() => navigate('/login')}>Log in</button><button className="bigbtn sm" onClick={() => navigate('/signup')}>Sign up</button></div>}
      </div>
      <section className="screen on">
        {children}
        {foot && <Foot />}
      </section>
    </Stage>
  );
}

export function Foot() {
  return (
    <div className="foot">
      <div><Link to="/privacy">Privacy</Link> &nbsp;·&nbsp; <Link to="/terms">Terms</Link></div>
      <div>Card data and images from YGOPRODeck &nbsp;·&nbsp; Not affiliated with Konami</div>
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
};
export const Icon = ({ name, className }: { name: keyof typeof ICONS | string; className?: string }) => (
  <svg className={className ?? 'i'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>
);
