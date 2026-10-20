// The signed-out pages: Welcome, Sign up (account → email code → username), Log in (+ a code on new devices),
// Forgot password, Privacy and Terms. Accounts are shared with DeckForge.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { DuelInfo, Frame, Me, SideView } from '@arena/shared';
import { DuelScreen } from '../duel/DuelScreen.tsx';
import { CONTACT, KONAMI, SOURCE_URL } from '../lib/about.ts';
import { api, ApiError } from '../lib/api.ts';
import { loadCards } from '../lib/cards.ts';
import { Link, navigate, takeRememberedPath } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { CodeBoxes, Icon, Page, PasswordInput, useToast } from './common.tsx';

const FEATURES: [string, string, string][] = [
  ['cards', 'Every card, unlocked', 'All 14,000+ cards from day one. No packs, no crafting, no waiting for a reprint.'],
  ['bolt', 'Rules handled for you', 'Chains, timing and effects resolve automatically, so you just play.'],
  ['users', 'Duel your friends', 'Host a private room, set the rules, share the code. Friends can ask to watch.'],
  ['layers', 'Build decks anywhere', 'A full deck builder with the live banlist, shared with DeckForge. Import your .ydk files.'],
];

export function Welcome() {
  return (
    <Page foot className="welcome">
      <div className="wrap">
        <div className="hero-row">
          <div className="hero">
            <div className="eyebrow">Free Yu-Gi-Oh! duels in your browser</div>
            <h1>Every card.<br />Every duel.<br /><em>No grind.</em></h1>
            <p>Build any deck from every card ever printed, then duel your friends with the rules handled for you. Nothing to download, no packs to open.</p>
            <div className="line"><button className="bigbtn" onClick={() => navigate('/signup')}>Create free account</button><button className="bigbtn ghost" onClick={() => navigate('/login')}>Log in</button></div>
            <div className="fine"><span>Every card, free</span><span>Automatic rulings</span><span>No ads, ever</span></div>
          </div>
          <Shot />
        </div>
        <div className="feats">
          {FEATURES.map(([icon, title, text]) => <div key={title} className="panel"><div className="ico"><Icon name={icon} /></div><h3>{title}</h3><p>{text}</p></div>)}
        </div>
      </div>
    </Page>
  );
}

// ---------- the preview on the Welcome page: the real duel screen showing a sample board ----------
const fc = (code: number, pos = 1, atk: number | null = null, def: number | null = null, mats = 0) => [code, pos, atk, def, mats, 0x21, 0, 0] as SideView['m'][number];
const side = (lp: number, hand: number[], m: SideView['m'], s: SideView['s'], gy: number[]): SideView => ({ lp, hand, m, s, gy, ban: [], deck: 31, extra: 13 });
const DEMO_FRAME: Frame = {
  step: 1, turn: 5, turnPlayer: 0, phase: 'BP', lines: [], chain: [], damage: [], highlight: [], columns: [], summons: [], leaves: [], solving: null,
  attack: { from: { p: 0, loc: 'm', seq: 2 }, to: { p: 1, loc: 'm', seq: 2 } },
  board: [
    side(8000, [89631139, 46986414, 14558127, 10045474, 89132148], [null, fc(47051709, 4, 1800, 900), fc(93717133, 1, 3000, 2500), null, null, fc(40390147, 1, 2000, 0, 2), null],
      [null, [0, 10, null, null, 0, 0, 0, 0], null, fc(897409), null, null, null, null], [46659709, 89132148]),
    side(5200, [0, 0, 0, 0], [null, null, fc(60764609, 1, 1800, 2400), null, null, null, null], [null, [0, 10, null, null, 0, 0, 0, 0], null, null, null, null, null, null], [60764609, 14558127]),
  ],
};
const DEMO_DUEL: DuelInfo = { id: 'demo', players: ['You', 'Rival'], decks: ['Galaxy-Eyes', 'Fiendsmith'], you: 0, fullView: false, engine: '', timer: 0 };
const DEMO_LOG = ['Galaxy-Eyes Photon Dragon attacks Fiendsmith Engraver', 'Rival activates Fiendsmith Engraver', 'Chain link 1’s effect is negated'].map((text, i) => ({ step: i, turn: 5, text, isTurn: false }));
const noop = () => {};
/** The frame around the preview; the 1600×900 duel screen inside is shrunk to whatever width the frame has. */
function Shot() {
  const frame = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.4875);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / 1600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div className="shot"><div className="frame" ref={frame} style={{ ['--k' as string]: k }}><DemoDuel /></div></div>;
}
function DemoDuel() {
  // the card text in the detail panel needs the card data; the board shows without it
  const [, setReady] = useState(false);
  useEffect(() => { loadCards().then(() => setReady(true)).catch(() => {}); }, []);
  return <DuelScreen embedded initialDetail={93717133} duel={DEMO_DUEL} frame={DEMO_FRAME} log={DEMO_LOG} ending={null} prompt={null} promptAt={0} onAnswer={noop}
    reveal={null} onCloseReveal={noop} onSurrender={noop} onLeave={noop} />;
}

// ---------- the account forms ----------
function AuthCard({ children, over }: { children: ReactNode; over?: ReactNode }) {
  return <Page className="center" over={over}><div className="panel auth">{children}</div></Page>;
}
const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export function SignUp() {
  const { setMe } = useSession();
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [agree, setAgree] = useState(false), [code, setCode] = useState('');
  const [toast, showToast] = useToast();

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    setErr(!validEmail(email) ? 'Enter a valid email address.' : password.length < 10 ? 'Your password needs at least 10 characters.' : !agree ? "Please confirm you're 13 or older and agree to the Terms." : '');
    if (!validEmail(email) || password.length < 10 || !agree) return;
    setBusy(true);
    try { await api('auth/signup', { email, password }); setCode(''); setStep(2); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await api('auth/signup/verify', { email, code });
      try { sessionStorage.setItem('ma-agreed', '1'); } catch {}   // ticked on step 1: the username step starts ticked
      setMe(res.me ?? null); navigate('/choose-name', true);
    }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const resend = async () => { try { await api('auth/signup', { email, password }); showToast('New code sent'); } catch (x) { setErr(message(x)); } };

  return (
    <AuthCard over={toast}>
      <div className="steps"><i className="on" /><i className={step >= 2 ? 'on' : ''} /><i /></div>
      {step === 1 ? (
        <form className="step on" onSubmit={start}>
          <div className="eyebrow">Step 1 of 3 · Account</div>
          <h2>Create your account</h2>
          <p className="sub">One account for Millennium Arena and DeckForge.</p>
          <div className="ffield"><label htmlFor="suEmail">Email</label><input className="sinput full" id="suEmail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus maxLength={254} /></div>
          <div className="ffield"><label htmlFor="suPw">Password</label><PasswordInput id="suPw" value={password} onChange={setPassword} meter autoComplete="new-password" placeholder="At least 10 characters" /></div>
          <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>I'm 13 or older, I agree to the <Link to="/terms">Terms</Link> and I've read the <Link to="/privacy">Privacy Policy</Link>.</span></label>
          <div className="err">{err}</div>
          <button className="bigbtn" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <div className="alt">Already have an account? <Link to="/login">Log in</Link></div>
        </form>
      ) : (
        <form className="step on" onSubmit={verify}>
          <div className="eyebrow">Step 2 of 3 · Verify</div>
          <h2>Check your email</h2>
          <p className="sub">We sent a 6-digit code to <b>{email}</b>. It expires in 10 minutes.</p>
          <CodeBoxes value={code} onChange={setCode} />
          <div className="err">{err}</div>
          <button className="bigbtn" disabled={busy || code.replace(/\D/g, '').length !== 6}>{busy ? 'Checking…' : 'Verify email'}</button>
          <div className="alt">No email? Check spam, or <a onClick={resend}>resend the code</a> · <a onClick={() => { setStep(1); setErr(''); }}>use a different email</a></div>
        </form>
      )}
    </AuthCard>
  );
}

/** Step 3 of sign-up, and where any account without a username (e.g. one made on DeckForge) is sent. */
export function ChooseName() {
  const { me, setMe } = useSession();
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [agree, setAgree] = useState(() => { try { return sessionStorage.getItem('ma-agreed') === '1'; } catch { return false; } });
  const valid = /^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(name);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const res = await api('account/username', { username: name, accept: agree }); setMe(res.me ?? null); navigate(takeRememberedPath() ?? '/home', true); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <AuthCard>
      <div className="steps"><i className="on" /><i className="on" /><i className="on" /></div>
      <form className="step on" onSubmit={save}>
        <div className="eyebrow">{me?.verified ? 'Step 3 of 3 · Username' : 'One more thing'}</div>
        <h2>Pick a username</h2>
        <p className="sub">This is what opponents see. You can change it later in Settings.</p>
        <div className="ffield"><label htmlFor="suName">Username</label><input className="sinput full" id="suName" maxLength={16} spellCheck={false} autoFocus placeholder="3–16 letters, numbers or underscores" value={name} onChange={e => setName(e.target.value.replace(/\s/g, ''))} /></div>
        <div className={`msg ${name && !valid ? 'bad' : ''}`}>{name && !valid ? 'Start with a letter; 3–16 letters, numbers and underscores.' : ''}</div>
        <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>I'm 13 or older and I agree to the <Link to="/terms">Terms</Link> (<Link to="/privacy">Privacy Policy</Link>).</span></label>
        <div className="err">{err}</div>
        <button className="bigbtn" disabled={busy || !valid || !agree}>{busy ? 'Saving…' : 'Enter the Arena'}</button>
      </form>
    </AuthCard>
  );
}

/** Accounts that haven't agreed to the current Terms (older accounts, and ones made on DeckForge) agree once here. */
export function AcceptTerms() {
  const { setMe } = useSession();
  const [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const res = await api('account/terms', { accept: agree }); setMe(res.me ?? null); }
    catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <AuthCard>
      <form className="step on" onSubmit={save}>
        <div className="eyebrow">Before you carry on</div>
        <h2>Our Terms have changed</h2>
        <p className="sub">They now set out the rules for chat and how reporting works. Please read them and confirm.</p>
        <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} autoFocus /><span>I'm 13 or older and I agree to the <Link to="/terms">Terms</Link> (<Link to="/privacy">Privacy Policy</Link>).</span></label>
        <div className="err">{err}</div>
        <button className="bigbtn" disabled={busy || !agree}>{busy ? 'Saving…' : 'Continue'}</button>
      </form>
    </AuthCard>
  );
}

export function LogIn() {
  const { setMe } = useSession();
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [trust, setTrust] = useState(true);
  const done = (res: { me?: Me | null }) => { setMe(res.me ?? null); navigate(res.me?.username ? takeRememberedPath() ?? '/home' : '/choose-name', true); };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!validEmail(email) || !password) return setErr(!validEmail(email) ? 'Enter a valid email address.' : 'Enter your password.');
    setBusy(true); setErr('');
    try {
      const res = await api<{ ok: true; needCode?: boolean; me?: Me | null }>('auth/login', { email, password });
      if (res.needCode) { setCode(''); setStep(2); } else done(res);
    } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { done(await api('auth/login/verify', { email, code, trust })); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };

  return (
    <AuthCard>
      {step === 1 ? (
        <form className="step on" onSubmit={start}>
          <div className="eyebrow">Welcome back</div>
          <h2>Log in</h2>
          <div className="ffield"><label htmlFor="liEmail">Email</label><input className="sinput full" id="liEmail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus maxLength={254} /></div>
          <div className="ffield"><label htmlFor="liPw">Password <Link to="/forgot">Forgot password?</Link></label><PasswordInput id="liPw" value={password} onChange={setPassword} autoComplete="current-password" /></div>
          <div className="err">{err}</div>
          <button className="bigbtn" disabled={busy}>{busy ? 'Checking…' : 'Log in'}</button>
          <div className="alt">New here? <Link to="/signup">Create an account</Link> · Your DeckForge account works here too</div>
        </form>
      ) : (
        <form className="step on" onSubmit={verify}>
          <div className="eyebrow">New device</div>
          <h2>Confirm it's you</h2>
          <p className="sub">You're logging in from a device we haven't seen before. We sent a 6-digit code to <b>{email}</b>.</p>
          <CodeBoxes value={code} onChange={setCode} />
          <label className="check"><input type="checkbox" checked={trust} onChange={e => setTrust(e.target.checked)} /><span>Trust this device for 30 days</span></label>
          <div className="err">{err}</div>
          <button className="bigbtn" disabled={busy || code.replace(/\D/g, '').length !== 6}>{busy ? 'Checking…' : 'Log in'}</button>
          <div className="alt"><a onClick={() => { setStep(1); setErr(''); }}>Back</a></div>
        </form>
      )}
    </AuthCard>
  );
}

export function Forgot() {
  const { setMe } = useSession();
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [password, setPassword] = useState('');
  const [after, setAfter] = useState<Me | null>(null);   // logged in once they press Continue (the router would leave this page at once)
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!validEmail(email)) return setErr('Enter a valid email address.');
    setBusy(true); setErr('');
    try { await api('auth/forgot', { email }); setCode(''); setStep(2); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (code.replace(/\D/g, '').length !== 6) return setErr('Enter the 6-digit code from the email.');
    if (password.length < 10) return setErr('Your new password needs at least 10 characters.');
    setBusy(true); setErr('');
    try { const res = await api('auth/forgot/verify', { email, code, password }); setAfter(res.me ?? null); setStep(3); } catch (x) { setErr(message(x)); } finally { setBusy(false); }
  };
  return (
    <AuthCard>
      {step === 1 && (
        <form className="step on" onSubmit={send}>
          <div className="eyebrow">Forgot password</div>
          <h2>Reset your password</h2>
          <p className="sub">Enter your account's email and we'll send you a code to set a new password.</p>
          <div className="ffield"><label htmlFor="fpEmail">Email</label><input className="sinput full" id="fpEmail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus maxLength={254} /></div>
          <div className="err">{err}</div>
          <button className="bigbtn" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
          <div className="alt">Remembered it? <Link to="/login">Log in</Link></div>
        </form>
      )}
      {step === 2 && (
        <form className="step on" onSubmit={reset}>
          <div className="eyebrow">Forgot password</div>
          <h2>Set a new password</h2>
          <p className="sub">If an account exists for <b>{email}</b>, we've sent it a 6-digit code.</p>
          <CodeBoxes value={code} onChange={setCode} />
          <div className="ffield"><label htmlFor="fpPw">New password</label><PasswordInput id="fpPw" value={password} onChange={setPassword} meter autoComplete="new-password" placeholder="At least 10 characters" /></div>
          <div className="err">{err}</div>
          <button className="bigbtn" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
          <div className="alt"><a onClick={() => { setStep(1); setErr(''); }}>Back</a></div>
        </form>
      )}
      {step === 3 && (
        <div className="step on">
          <div className="eyebrow">Forgot password</div>
          <h2>Password changed</h2>
          <div className="okbox">✓ Your password is updated, and you've been logged out everywhere else (DeckForge too).</div>
          <button className="bigbtn" onClick={() => { setMe(after); navigate(after?.username ? '/home' : '/choose-name', true); }}>Continue</button>
        </div>
      )}
    </AuthCard>
  );
}

// ---------- Privacy and Terms ----------
function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page className="center">
      <div className="panel doc">
        <button className="crumb" onClick={() => (history.length > 1 ? history.back() : navigate('/'))}>← Back</button>
        <h1>{title}</h1>
        <div className="upd">Last updated 20 October 2026</div>
        {children}
      </div>
    </Page>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy Policy">
      <p>Millennium Arena is a free fan project with no ads and no trackers, and it never sells your data. It's run by Daniyal Zia, an individual in the UK, who is responsible for your data. This page explains what it keeps, why, and for how long, in plain English. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      <h3>One account, two sites</h3>
      <p>Your account is shared with DeckForge, the deck builder on the same site: the same email and password work on both, and your decks appear in both.</p>
      <h3>What we store</h3>
      <ul>
        <li><b>Your account:</b> email address, username, and your password, stored only as a secure hash (never the password itself), plus when you agreed to the Terms.</li>
        <li><b>What you build and play:</b> your decks and settings; your match history (who you played, the result, your deck's name, how long it took) and which cards you use most.</li>
        <li><b>Security:</b> your logins (with your browser's description, its "user agent") and the devices you've chosen to trust, so we know when to ask for a login code. Login and device keys are stored only in scrambled (hashed) form.</li>
        <li><b>Reports:</b> if you report a player, or a player reports you: who reported whom, the reason given, and the last 20 messages of the chat in that room.</li>
      </ul>
      <h3>Why (the legal bases)</h3>
      <ul>
        <li><b>To provide the service you signed up for</b> (contract): your account, decks, duels and match history.</li>
        <li><b>Legitimate interests:</b> keeping accounts secure (login records, rate limits), keeping players safe (reports, suspending accounts that break the Terms), and backups so nothing is lost.</li>
        <li><b>Legal obligations:</b> dealing with illegal content, as the Online Safety Act requires.</li>
      </ul>
      <h3>How long we keep it</h3>
      <ul>
        <li>Your account, decks and match history: until you delete your account.</li>
        <li>Logins: until they expire (30 days without use). Trusted devices: 30 days. Email codes: 10 minutes.</li>
        <li>Reports: 90 days, then deleted automatically. Each report is also emailed to Daniyal to review, and that email is deleted within 90 days too.</li>
        <li>Backups: the database is backed up every night, encrypted, and each backup is deleted after 14 days. A deleted account disappears from backups within 14 days.</li>
      </ul>
      <h3>How we use your email</h3>
      <p>Only for verification codes, password resets and important account notices (like your email or password being changed). No newsletters and no marketing. Emails are sent through Resend, a US email delivery company, from its servers in Ireland, from noreply@mail.daniyalzia.co.uk, which can't receive replies. Resend is covered by the UK Extension to the EU–US Data Privacy Framework.</p>
      <h3>Cookies</h3>
      <p>One cookie (<code>ma_session</code>) keeps you logged in. If you tick "Trust this device", a second one (<code>ma_device</code>) remembers that for 30 days. Both are sent only to Millennium Arena, only over a secure connection, and can't be read by scripts on the page. Your theme and duel choices are also kept in your browser. There are no analytics or advertising cookies.</p>
      <h3>Outside services</h3>
      <p>A few services help run the site. None of them get your account or decks, but like any website they see your IP address when your browser talks to them: Cloudflare carries the site's traffic, Resend delivers the emails, and fonts load from Google Fonts. Cloudflare and Google may handle that data in the US. Card pictures are YGOPRODeck's, but our own server stores and sends them, so your browser doesn't contact YGOPRODeck.</p>
      <h3>Who can see what</h3>
      <p>Opponents and spectators see your username. Other players can open your profile and see your record (wins, losses, streaks); your match history, decks and most-played cards are shown only to you. Your email and decks stay private: in a duel against another player, your opponent doesn't even see your deck's name.</p>
      <h3>Chat</h3>
      <p>Chat in a private room or an Unranked duel goes only to the people in that room, and isn't saved: it's gone when the room closes. The one exception is a report: then the room's last 20 messages are kept with the report for 90 days, for a person to review. Unranked chat doesn't allow links or contact details.</p>
      <h3>Your rights</h3>
      <p>You can delete your account at any time in Settings. That removes it everywhere, including your DeckForge decks and your match history, and your name is taken off other players' histories. You can also ask to see, correct or move your data, or object to how it's used: email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. The full list of your rights, and how to complain to the Information Commissioner's Office, is in the site-wide <a href="https://daniyalzia.co.uk/privacy">privacy policy</a>.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms of Use">
      <p>By creating an account you agree to these terms. They're short on purpose. Millennium Arena is run by Daniyal Zia, an individual in the UK.</p>
      <h3>A free fan project</h3>
      <p>Millennium Arena is free and non-commercial. {KONAMI} Yu-Gi-Oh! card names, artwork and game mechanics belong to their owners and are used here for non-commercial play only. Card data comes from Project Ignis; card pictures and tournament deck lists come from YGOPRODeck.</p>
      <p>Rights holders: email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we'll remove material promptly.</p>
      <h3>Your account</h3>
      <ul>
        <li>You must be 13 or older.</li>
        <li>One account per person. Keep your password to yourself. Your account also works on DeckForge.</li>
        <li>Usernames must not impersonate others or be offensive.</li>
      </ul>
      <h3>Chat and behaviour</h3>
      <p>These aren't allowed in chat, usernames or anywhere else on the site:</p>
      <ul>
        <li>Anything illegal.</li>
        <li>Harassment, bullying or threats.</li>
        <li>Hate against anyone for their race, religion, sex, sexuality, gender identity or disability.</li>
        <li>Sexual content.</li>
        <li>Trying to contact or meet children, asking anyone for personal details or photos, or trying to move a conversation to another app.</li>
        <li>Spam and scams.</li>
      </ul>
      <p>Unranked duels pair you with strangers, so links and contact details are blocked in their chat. You can mute the chat in any duel.</p>
      <h3>Playing fair</h3>
      <ul>
        <li>No cheating, bots, exploiting bugs, or deliberately disrupting duels.</li>
      </ul>
      <h3 id="reporting">Reporting, and what happens</h3>
      <p>Use <b>Report</b> in the duel chat (the flag) or on a player's profile, or email <a href={`mailto:${CONTACT}?subject=Report`}>{CONTACT}</a> with the subject "Report". A person reads every report. We may remove content and warn, suspend or remove accounts that break these rules; illegal content is removed and, where the law requires it, reported to the authorities (child sexual abuse material to the National Crime Agency). If your account is suspended and you think that's wrong, email us to appeal: we'll reply within 14 days. More on how reports and complaints are handled: <a href="https://daniyalzia.co.uk/terms#reporting">daniyalzia.co.uk/terms</a>.</p>
      <h3>Source code</h3>
      <p>Millennium Arena is open source under the GNU Affero General Public License v3.0. The exact code this site is running is on <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">GitHub</a>.</p>
      <h3>No guarantees</h3>
      <p>The site is provided as-is. It may change, go offline for maintenance, or reset data during testing. We'll give notice where we can.</p>
      <h3>Contact</h3>
      <p>Questions or reports: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    </Doc>
  );
}
