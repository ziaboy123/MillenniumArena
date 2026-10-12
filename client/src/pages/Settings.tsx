// Settings, reached only from Home (never mid-duel): Appearance, Account, Gameplay. Everything saves to the account.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Me, Responses, Speed, TrustedDevice, UserSettings } from '@arena/shared';
import { api, ApiError } from '../lib/api.ts';
import { allCards, card, cropImage, loadCards } from '../lib/cards.ts';
import { navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { THEMES } from '../lib/ui.tsx';
import { CodeBoxes, Page, PasswordInput, useToast } from './common.tsx';
import { DEFAULT_ARTWORK } from './Home.tsx';

type Tab = 'appearance' | 'account' | 'gameplay';
const TABS: [Tab, string][] = [['appearance', 'Appearance'], ['account', 'Account'], ['gameplay', 'Gameplay']];
const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function Settings() {
  const { me, setMe } = useSession();
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem('ma-settings-tab') as Tab) || 'appearance'; } catch { return 'appearance'; } });
  const [toast, showToast] = useToast();
  useEffect(() => { try { sessionStorage.setItem('ma-settings-tab', tab); } catch {} }, [tab]);
  // Escape goes back Home (unless you're typing)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) navigate('/home'); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, []);
  if (!me?.username) return null;

  /** Saves straight away and shows the change at once; puts it back if the server refuses. */
  const save = async (patch: Partial<UserSettings>) => {
    setMe({ ...me, settings: { ...me.settings, ...patch } });
    try { const res = await api('account/settings', { settings: patch }); if (res.me) setMe(res.me); }
    catch (x) { setMe(me); showToast(message(x)); }
  };

  return (
    <Page back="/home">
      <div className="panel settings">
        <nav className="snav">
          <div className="title">Settings</div>
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
          <button disabled>Audio<small>soon</small></button>
        </nav>
        <div className="sbody">
          {tab === 'appearance' && <Appearance me={me} save={save} />}
          {tab === 'account' && <Account me={me} toast={showToast} />}
          {tab === 'gameplay' && <Gameplay me={me} save={save} />}
        </div>
      </div>
      {toast}
    </Page>
  );
}

type Save = (patch: Partial<UserSettings>) => void;

function Row({ title, text, children }: { title: string; text: ReactNode; children?: ReactNode }) {
  return <div className="srow"><div className="l"><b>{title}</b><span>{text}</span></div><div className="r">{children}</div></div>;
}

// ---------- Appearance ----------
function Appearance({ me, save }: { me: Me; save: Save }) {
  const [picking, setPicking] = useState(false);
  const [cardsReady, setCardsReady] = useState(false);
  useEffect(() => { loadCards().then(() => setCardsReady(true)).catch(() => {}); }, []);
  const theme = me.settings.theme ?? 'c', art = me.settings.artwork ?? DEFAULT_ARTWORK, effects = me.settings.effects ?? true;
  return <>
    <h3>Theme</h3>
    <div className="hint">Changes the whole site and every duel: field, cards, panels and effects. Saved to your account, so it follows you to any device.</div>
    <div className="themes">
      {THEMES.map(t => (
        <div key={t.k} className={`tcard ${theme === t.k ? 'sel' : ''}`} data-dir={t.k} onClick={() => theme !== t.k && save({ theme: t.k })}>
          <div className="scene"><div className="mini">{Array.from({ length: 10 }, (_, i) => <i key={i} className={[1, 3, 7].includes(i) ? 'c' : ''} />)}</div></div>
          <div className="tm"><b>{t.name}</b><span>{t.desc}</span></div><div className="tick">✓</div>
        </div>
      ))}
    </div>
    <Row title="Home artwork" text="The card art on your Duel tile. Pick any card.">
      <div className="artthumb" style={{ backgroundImage: `url(${cropImage(art)})` }} />
      <span className="val artname">{card(art)?.name ?? POPULAR.find(p => p[0] === art)?.[1] ?? ''}</span>
      {!picking && <button className="sbtn" onClick={() => setPicking(true)}>Change</button>}
    </Row>
    {picking && <ArtPicker current={art} ready={cardsReady} onPick={artwork => save({ artwork })} onDone={() => setPicking(false)} />}
    <Row title="Field effects" text="Light, mist and particles. Turn off on slower laptops.">
      <button className={`tog ${effects ? 'on' : ''}`} aria-label="Field effects" onClick={() => save({ effects: !effects })} />
    </Row>
  </>;
}

const POPULAR: [number, string][] = [
  [89631139, 'Blue-Eyes White Dragon'], [46986414, 'Dark Magician'], [74677422, 'Red-Eyes Black Dragon'], [38033121, 'Dark Magician Girl'],
  [10000000, 'Obelisk the Tormentor'], [44508094, 'Stardust Dragon'], [5405694, 'Black Luster Soldier'], [89943723, 'Elemental HERO Neos'],
];

function ArtPicker({ current, ready, onPick, onDone }: { current: number; ready: boolean; onPick: (code: number) => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = useMemo<[number, string][]>(() => {
    if (needle.length < 2 || !ready) return POPULAR;
    // exact name first, then names starting with it, then the rest; shorter names first. Each card once (no alternate artworks).
    const found: [number, number, string][] = [];
    for (const c of allCards()) {
      if (c.alias) continue;
      const name = c.name.toLowerCase();
      const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : -1;
      if (rank >= 0) found.push([rank, c.code, c.name]);
    }
    found.sort((a, b) => a[0] - b[0] || a[2].length - b[2].length || a[2].localeCompare(b[2]));
    return found.slice(0, 12).map(([, code, name]) => [code, name]);
  }, [needle, ready]);
  const msg = needle.length < 2 ? 'Popular picks' : !ready ? 'Loading cards…' : list.length ? `Cards matching "${q.trim()}"` : `No cards match "${q.trim()}"`;
  return (
    <div className="flow on">
      <div className="line"><input className="sinput" placeholder="Search any card…" style={{ width: 340 }} spellCheck={false} autoFocus value={q} onChange={e => setQ(e.target.value)} />
        <button className="sbtn" onClick={onDone}>Done</button></div>
      <div className="msg">{msg}</div>
      <div className="artgrid">
        {list.map(([code, name]) => (
          <div key={code} className={`apick ${code === current ? 'sel' : ''}`} style={{ backgroundImage: `url(${cropImage(code)})` }} onClick={() => code !== current && onPick(code)}><span>{name}</span></div>
        ))}
      </div>
    </div>
  );
}

// ---------- Account ----------
type Flow = '' | 'name' | 'email' | 'password' | 'everywhere' | 'delete';

function Account({ me, toast }: { me: Me; toast: (m: string) => void }) {
  const { setMe } = useSession();
  const [open, setOpen] = useState<Flow>('');
  const [devicesKey, setDevicesKey] = useState(0);
  const toggle = (f: Flow) => setOpen(o => (o === f ? '' : f));
  const done = (m: string, next?: Me | null) => { if (next) setMe(next); setOpen(''); toast(m); };
  const logout = async () => { try { await api('auth/logout'); } catch {} setMe(null); navigate('/', true); };

  return <>
    <h3>Account</h3>
    <div className="hint">One account for Millennium Arena and DeckForge. Your username is what opponents see.</div>

    <Row title="Username" text={me.nextNameChange ? `You can change it again on ${day(me.nextNameChange)}.` : 'Letters, numbers and underscores. After a change, the next one is 30 days later.'}>
      <span className="val">{me.username}</span>
      <button className="sbtn" disabled={!!me.nextNameChange} onClick={() => toggle('name')}>Change</button>
    </Row>
    {open === 'name' && <NameFlow me={me} onDone={done} onCancel={() => setOpen('')} />}

    <Row title="Email" text="Used to log in and to receive codes.">
      <span className="val">{me.email}</span>{me.verified && <span className="ok">Verified</span>}
      <button className="sbtn" onClick={() => toggle('email')}>Change</button>
    </Row>
    {open === 'email' && <EmailFlow onDone={done} onCancel={() => setOpen('')} />}

    <Row title="Password" text="Changing it logs you out everywhere else (DeckForge too) and forgets your other trusted devices.">
      <button className="sbtn" onClick={() => toggle('password')}>Change</button>
    </Row>
    {open === 'password' && <PasswordFlow email={me.email} onDone={(m, next) => { setDevicesKey(k => k + 1); done(m, next); }} onCancel={() => setOpen('')} />}

    <Row title="Log out" text={<>Logged in as <b className="inl">{me.username}</b> on this device.</>}>
      <button className="sbtn" onClick={logout}>Log out</button>
      <button className="sbtn" onClick={() => toggle('everywhere')}>Log out everywhere</button>
    </Row>
    {open === 'everywhere' && (
      <ConfirmFlow text="This ends every login, here and on DeckForge, and forgets your other trusted devices. You stay logged in on this one." button="Log out everywhere"
        run={async () => { const res = await api('account/logout-everywhere'); setDevicesKey(k => k + 1); done('Logged out everywhere else', res.me); }} onCancel={() => setOpen('')} />
    )}

    <Devices key={devicesKey} toast={toast} />

    <Row title="Delete account" text="Permanently removes your account everywhere, including your DeckForge decks. This can't be undone.">
      <button className="sbtn danger-text" onClick={() => toggle('delete')}>Delete account</button>
    </Row>
    {open === 'delete' && <DeleteFlow me={me} onCancel={() => setOpen('')} />}
  </>;
}

type Done = (msg: string, me?: Me | null) => void;

function NameFlow({ me, onDone, onCancel }: { me: Me; onDone: Done; onCancel: () => void }) {
  const [name, setName] = useState(me.username ?? ''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const valid = /^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(name), same = name === me.username;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const res = await api('account/username', { username: name }); onDone('Username changed', res.me); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const msg = err || (same ? 'This is your current username.' : !valid ? 'Start with a letter; 3–16 letters, numbers and underscores.' : '');
  return (
    <form className="flow on" onSubmit={save}>
      <div className="line"><input className="sinput" maxLength={16} spellCheck={false} autoFocus value={name} onChange={e => { setName(e.target.value.replace(/\s/g, '')); setErr(''); }} />
        <button className="sbtn p" disabled={busy || same || !valid}>Save</button><button type="button" className="sbtn" onClick={onCancel}>Cancel</button></div>
      <div className={`msg ${err || (!same && !valid) ? 'bad' : ''}`}>{msg}</div>
    </form>
  );
}

function EmailFlow({ onDone, onCancel }: { onDone: Done; onCancel: () => void }) {
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await api('account/email', { email, password }); setCode(''); setStep(2); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const res = await api('account/email/verify', { email, code }); onDone('Email changed', res.me); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return step === 1 ? (
    <form className="flow on" onSubmit={send}>
      <p>We'll send a 6-digit code to the new address. Your email only changes once you enter it.</p>
      <div className="ffield"><label htmlFor="emNew">New email</label><input className="sinput full" id="emNew" type="email" autoComplete="email" autoFocus maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="ffield"><label htmlFor="emPw">Current password</label><PasswordInput id="emPw" value={password} onChange={setPassword} autoComplete="current-password" /></div>
      <div className="msg bad">{err}</div>
      <div className="line"><button className="sbtn p" disabled={busy || !email || !password}>Send code</button><button type="button" className="sbtn" onClick={onCancel}>Cancel</button></div>
    </form>
  ) : (
    <form className="flow on" onSubmit={verify}>
      <p>Enter the code we sent to <b>{email}</b>. It expires in 10 minutes.</p>
      <CodeBoxes value={code} onChange={setCode} />
      <div className="msg bad">{err}</div>
      <div className="line"><button className="sbtn p" disabled={busy || code.replace(/\D/g, '').length !== 6}>Verify</button>
        <button type="button" className="sbtn" disabled={busy} onClick={() => send()}>Send a new code</button><button type="button" className="sbtn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function PasswordFlow({ email, onDone, onCancel }: { email: string; onDone: Done; onCancel: () => void }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 10) return setErr('Your new password needs at least 10 characters.');
    if (next.trim().toLowerCase() === email) return setErr("Your password can't be your email.");
    setBusy(true); setErr('');
    try { const res = await api('account/password', { current, password: next }); onDone("Password changed. You've been logged out everywhere else.", res.me); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <form className="flow on" onSubmit={save}>
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <div className="ffield"><label htmlFor="cpCur">Current password</label><PasswordInput id="cpCur" value={current} onChange={setCurrent} autoComplete="current-password" /></div>
      <div className="ffield"><label htmlFor="cpNew">New password</label><PasswordInput id="cpNew" value={next} onChange={setNext} meter autoComplete="new-password" placeholder="At least 10 characters" /></div>
      <div className="msg bad">{err}</div>
      <div className="line"><button className="sbtn p" disabled={busy || !current || !next}>Change password</button><button type="button" className="sbtn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function ConfirmFlow({ text, button, run, onCancel }: { text: string; button: string; run: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { await run(); } catch (x) { setErr(message(x)); setBusy(false); } };
  return (
    <div className="flow on">
      <p>{text}</p>
      <div className="msg bad">{err}</div>
      <div className="line"><button className="sbtn p" disabled={busy} onClick={go}>{button}</button><button className="sbtn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Devices({ toast }: { toast: (m: string) => void }) {
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const load = () => api<{ devices: TrustedDevice[] }>('account/devices').then(r => setDevices(r.devices)).catch(() => setDevices([]));
  useEffect(() => { load(); }, []);
  const forget = async (d: TrustedDevice) => {
    try { await api('account/devices/forget', { id: d.id }); toast(d.current ? 'This device will ask for a code next time' : 'Device forgotten'); load(); }
    catch (x) { toast(message(x)); }
  };
  return <>
    <Row title="Trusted devices" text="Logging in on a device that isn't trusted asks for an email code. Trust lasts 30 days." />
    <div className="devlist">
      {devices === null ? <div className="msg">Loading…</div>
        : devices.length === 0 ? <div className="msg">No trusted devices.</div>
        : devices.map(d => (
          <div key={d.id} className="dev">
            <div><b>{d.label || 'Browser'}</b>{d.current && <span className="ok">This device</span>}<span>Trusted until {day(d.expires_at)}</span></div>
            <button className="sbtn" onClick={() => forget(d)}>Forget</button>
          </div>
        ))}
    </div>
  </>;
}

function DeleteFlow({ me, onCancel }: { me: Me; onCancel: () => void }) {
  const { setMe } = useSession();
  const [typed, setTyped] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const want = me.username ?? me.email;
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('account/delete', { confirm: typed, password }); setMe(null); navigate('/', true); } catch (x) { setErr(message(x)); setBusy(false); }
  };
  return (
    <form className="flow on danger" onSubmit={go}>
      <p>This deletes your account on Millennium Arena <b>and DeckForge</b>, with every deck you've built. It can't be undone.</p>
      <div className="ffield"><label htmlFor="delName" className="plain">Type your username to confirm: <b className="inl">{want}</b></label><input className="sinput full" id="delName" spellCheck={false} autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} /></div>
      <div className="ffield"><label htmlFor="delPw">Password</label><PasswordInput id="delPw" value={password} onChange={setPassword} autoComplete="current-password" /></div>
      <div className="msg bad">{err}</div>
      <div className="line"><button className="sbtn danger" disabled={busy || typed.trim().toLowerCase() !== want.toLowerCase() || !password}>Delete forever</button>
        <button type="button" className="sbtn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

// ---------- Gameplay ----------
function Gameplay({ me, save }: { me: Me; save: Save }) {
  const responses = me.settings.responses ?? 'smart', speed = me.settings.speed ?? 'normal';
  const seg = <T extends string>(value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="seg">{options.map(([k, label]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => value !== k && set(k)}>{label}</button>)}</div>
  );
  return <>
    <h3>Gameplay</h3>
    <div className="hint">How duels play for you. These can only be changed here, never mid-duel.</div>
    <Row title="Responses" text={responses === 'smart'
      ? "Smart: you aren't asked to respond to your own moves. You're still asked for your triggers and whenever your opponent does something."
      : 'Always ask: the duel stops at every point where you could respond, even after your own moves.'}>
      {seg<Responses>(responses, [['smart', 'Smart'], ['always', 'Always ask']], r => save({ responses: r }))}
    </Row>
    <Row title="Bot speed" text="How fast the bot's moves play out when you duel it.">
      {seg<Speed>(speed, [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']], s => save({ speed: s }))}
    </Row>
  </>;
}
