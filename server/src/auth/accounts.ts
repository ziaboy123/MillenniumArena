// Accounts, shared with DeckForge (public.users, same bcrypt hashes). Arena adds usernames, settings, email codes,
// its own login sessions and trusted devices (the arena schema).
//
// Security rules followed here:
//   - passwords: bcrypt (cost 12, like DeckForge); 10+ characters; common ones refused
//   - a wrong email takes as long to reject as a wrong password, and sign-up / password reset answer the same way
//     whether or not an account exists (no finding out who has an account)
//   - email codes: six digits, 10 minutes, one use, five tries, stored only as a keyed hash
//   - sessions and devices: random tokens in cookies, stored only as SHA-256; a password change or reset bumps the
//     account's session version, which ends every login here and in DeckForge
import bcrypt from 'bcryptjs';
import type { Me, UserSettings } from '@arena/shared';
import { one, q, tx } from '../db/index.ts';
import { codeMail, sendMail } from './mailer.ts';
import { codeHash, newCode, newId, newToken, sameHash, sha256 } from './security.ts';

const BCRYPT_COST = 12;
// compared against when an email has no account, so that case takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync(newToken(), BCRYPT_COST);

/** A problem to show the person (anything else is reported as a generic error). */
export class Problem extends Error { constructor(message: string, readonly status = 400) { super(message); } }

// ---------- checking what people type ----------
export const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
export function checkEmail(email: string) {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Problem('Enter a valid email address.');
}
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd123', '1234567890', '12345678910', 'qwertyuiop', 'qwerty1234',
  '1q2w3e4r5t', 'iloveyou12', 'letmein123', 'yugioh1234', 'yugioh123!', 'blueeyes123', 'darkmagician', 'millennium', 'deckforge1']);
export function checkPassword(pw: unknown, email = ''): string {
  const p = String(pw ?? '');
  if (p.length < 10) throw new Problem('Use at least 10 characters.');
  if (Buffer.byteLength(p) > 72) throw new Problem('That password is too long (72 bytes at most).');
  const low = p.toLowerCase();
  if (COMMON.has(low) || low === email || low === email.split('@')[0] || /^(.)\1+$/.test(p) || new Set(p).size < 4) throw new Problem('That password is too easy to guess.');
  return p;
}
const RESERVED = new Set(['admin', 'administrator', 'mod', 'moderator', 'support', 'staff', 'system', 'bot', 'arena', 'millennium', 'deckforge',
  'konami', 'official', 'root', 'null', 'undefined', 'guest', 'duelist', 'you', 'me', 'opponent', 'spectator']);
export function checkUsername(u: unknown): string {
  const name = String(u ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(name)) throw new Problem('3–16 characters: letters, numbers and _, starting with a letter.');
  if (RESERVED.has(name.toLowerCase())) throw new Problem('That name is reserved.');
  return name;
}

// ---------- email codes ----------
type Purpose = 'signup' | 'login' | 'reset' | 'email';

/** Make a code and email it (replacing any earlier one for the same email and purpose). */
async function sendCode(email: string, purpose: Purpose, what: string, payload: Record<string, unknown>) {
  const code = newCode();
  await tx(async c => {
    await c.query('delete from arena.codes where email = $1 and purpose = $2', [email, purpose]);
    await c.query(`insert into arena.codes (email, purpose, code_hash, payload, expires_at) values ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [email, purpose, codeHash(purpose, email, code), payload]);
  });
  const mail = codeMail(code, what);
  await sendMail(email, mail.subject, mail.text);
}

/** Use up a code, returning what was saved with it. Wrong guesses count; the fifth one burns the code. */
async function useCode(email: string, purpose: Purpose, code: unknown): Promise<Record<string, any>> {
  const row = await one('select id, code_hash, attempts from arena.codes where email = $1 and purpose = $2 and expires_at > now() order by id desc limit 1', [email, purpose]);
  if (!row) throw new Problem('That code has expired. Ask for a new one.');
  const typed = String(code ?? '').replace(/\D/g, '');
  if (typed.length !== 6 || !sameHash(row.code_hash, codeHash(purpose, email, typed))) {
    const tries = (await one('update arena.codes set attempts = attempts + 1 where id = $1 returning attempts', [row.id]))?.attempts ?? 5;
    if (tries >= 5) { await q('delete from arena.codes where id = $1', [row.id]); throw new Problem('Too many wrong codes. Ask for a new one.'); }
    throw new Problem("That code isn't right.");
  }
  // deleting it is what claims it: if two requests race with the right code, only one gets the row back
  const claimed = await one('delete from arena.codes where id = $1 returning payload', [row.id]);
  if (!claimed) throw new Problem('That code has already been used.');
  return claimed.payload;
}

// emails are sent in the background where waiting for them would reveal whether an account exists
const background = (p: Promise<unknown>) => p.catch(e => console.error(`email: ${e.message}`));
const NOTICE_FOOTER = '\n\nMillennium Arena (your account is shared with DeckForge)';

// ---------- sign up ----------
export async function signupStart(emailIn: unknown, passwordIn: unknown) {
  const email = normEmail(emailIn);
  checkEmail(email);
  const password = checkPassword(passwordIn, email);
  const hash = await bcrypt.hash(password, BCRYPT_COST);   // done either way, so both cases take the same time
  if (await one('select 1 from public.users where email = $1', [email])) {
    background(sendMail(email, 'Someone tried to sign up with your email',
      `Someone (hopefully you) tried to create a Millennium Arena account with this email address, but it already has one.\n\nLog in instead, or use "Forgot password" if you need a new password.${NOTICE_FOOTER}`));
    return;
  }
  background(sendCode(email, 'signup', 'finish creating your account', { hash }));
}

/** Creates the account; returns its id. The username is chosen next. */
export async function signupVerify(emailIn: unknown, code: unknown): Promise<string> {
  const email = normEmail(emailIn);
  const { hash } = await useCode(email, 'signup', code);
  return tx(async c => {
    if ((await c.query('select 1 from public.users where email = $1', [email])).rowCount) throw new Problem('That email already has an account. Log in instead.');
    const id = newId();
    await c.query('insert into public.users (id, email, password, "emailVerified", "updatedAt") values ($1, $2, $3, now(), now())', [id, email, hash]);
    return id;
  });
}

// ---------- log in ----------
/** Checks the password. A trusted device logs straight in; otherwise a code goes to the email. */
export async function loginStart(emailIn: unknown, passwordIn: unknown, deviceToken?: string): Promise<{ userId: string } | { needCode: true }> {
  const email = normEmail(emailIn);
  const user = await one('select id, password from public.users where email = $1', [email]);
  const ok = await bcrypt.compare(String(passwordIn ?? '').slice(0, 200), user?.password ?? DUMMY_HASH);
  if (!user?.password || !ok) throw new Problem('Email or password is incorrect.', 401);
  if (await isTrusted(user.id, deviceToken)) return { userId: user.id };
  await sendCode(email, 'login', 'log in on a new device', { userId: user.id });
  return { needCode: true };
}

export async function loginVerify(emailIn: unknown, code: unknown): Promise<string> {
  const { userId } = await useCode(normEmail(emailIn), 'login', code);
  // the code proves the email belongs to them (accounts made on DeckForge start unverified)
  await q('update public.users set "emailVerified" = coalesce("emailVerified", now()) where id = $1', [userId]);
  return userId;
}

// ---------- forgotten password ----------
export async function forgotStart(emailIn: unknown) {
  const email = normEmail(emailIn);
  checkEmail(email);
  const user = await one('select id from public.users where email = $1', [email]);
  if (user) background(sendCode(email, 'reset', 'choose a new password', { userId: user.id }));
}

/** Sets the new password and signs the account out everywhere; returns the account id. */
export async function forgotVerify(emailIn: unknown, code: unknown, passwordIn: unknown): Promise<string> {
  const email = normEmail(emailIn);
  const password = checkPassword(passwordIn, email);   // checked first, so a weak password doesn't use up the code
  const { userId } = await useCode(email, 'reset', code);
  await newPassword(userId, password);
  return userId;
}

async function newPassword(userId: string, password: string) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await tx(async c => {
    await c.query('update public.users set password = $2, "sessionVersion" = "sessionVersion" + 1, "emailVerified" = coalesce("emailVerified", now()), "updatedAt" = now() where id = $1', [userId, hash]);
    await c.query('delete from arena.sessions where user_id = $1', [userId]);
    await c.query('delete from arena.devices where user_id = $1', [userId]);
  });
}

// ---------- sessions and devices ----------
export async function createSession(userId: string, userAgent = ''): Promise<string> {
  const token = newToken();
  const user = await one('select "sessionVersion" as v from public.users where id = $1', [userId]);
  if (!user) throw new Problem('That account no longer exists.', 401);
  await q(`insert into arena.sessions (token_hash, user_id, session_version, expires_at, user_agent) values ($1, $2, $3, now() + interval '30 days', $4)`,
    [sha256(token), userId, user.v, userAgent.slice(0, 200)]);
  return token;
}

/** The account behind a session cookie, or null (expired, unknown, or ended by a password change). */
export async function sessionUser(token: string | undefined): Promise<Me | null> {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const row = await one(`select s.user_id, s.session_version, s.last_seen, u."sessionVersion" as current_version, u.email, u."emailVerified" as verified,
      p.username, p.settings, p.username_changed_at
    from arena.sessions s join public.users u on u.id = s.user_id left join arena.profiles p on p.user_id = u.id
    where s.token_hash = $1 and s.expires_at > now()`, [hash]);
  if (!row) return null;
  if (row.session_version !== row.current_version) { await q('delete from arena.sessions where token_hash = $1', [hash]); return null; }
  // keep active logins alive (at most one write an hour)
  if (Date.now() - new Date(row.last_seen).getTime() > 3600_000) await q(`update arena.sessions set last_seen = now(), expires_at = now() + interval '30 days' where token_hash = $1`, [hash]);
  const next = row.username_changed_at ? new Date(new Date(row.username_changed_at).getTime() + 30 * 86400_000) : null;
  return {
    id: row.user_id, email: row.email, username: row.username ?? null, verified: !!row.verified, settings: row.settings ?? {},
    nextNameChange: next && next.getTime() > Date.now() ? next.toISOString() : null,
  };
}

export const endSession = (token: string | undefined) => (token ? q('delete from arena.sessions where token_hash = $1', [sha256(token)]) : Promise.resolve([]));

export async function trustDevice(userId: string, label: string): Promise<string> {
  const token = newToken();
  await q(`insert into arena.devices (token_hash, user_id, label, expires_at) values ($1, $2, $3, now() + interval '30 days')`, [sha256(token), userId, label.slice(0, 80)]);
  return token;
}

export const isTrusted = async (userId: string, deviceToken: string | undefined) =>
  !!deviceToken && deviceToken.length <= 100 && !!(await one('select 1 from arena.devices where token_hash = $1 and user_id = $2 and expires_at > now()', [sha256(deviceToken), userId]));

/** Trusted devices, identified by a short, harmless part of their hash. */
export const listDevices = (userId: string) =>
  q(`select left(token_hash, 12) as id, label, created_at, expires_at from arena.devices where user_id = $1 and expires_at > now() order by created_at desc`, [userId]);
export const forgetDevice = (userId: string, id: unknown) =>
  q('delete from arena.devices where user_id = $1 and left(token_hash, 12) = $2', [userId, String(id ?? '').slice(0, 12)]);

// ---------- account settings ----------
export async function setUsername(userId: string, nameIn: unknown) {
  const name = checkUsername(nameIn);
  const current = await one('select username, username_changed_at from arena.profiles where user_id = $1', [userId]);
  if (current?.username === name) return;
  if (current?.username_changed_at && Date.now() - new Date(current.username_changed_at).getTime() < 30 * 86400_000)
    throw new Problem('You can change your username once every 30 days.');
  try {
    await q(`insert into arena.profiles (user_id, username, username_key) values ($1, $2, $3)
      on conflict (user_id) do update set username = $2, username_key = $3, username_changed_at = now()`, [userId, name, name.toLowerCase()]);
  } catch (e: any) {
    if (e.code === '23505') throw new Problem('That username is taken.');   // unique violation
    throw e;
  }
  // DeckForge shows the account's name; give it the username if it has none
  await q('update public.users set name = $2, "updatedAt" = now() where id = $1 and name is null', [userId, name]);
}

async function checkCurrentPassword(userId: string, password: unknown) {
  const user = await one('select password from public.users where id = $1', [userId]);
  if (!user?.password || !(await bcrypt.compare(String(password ?? '').slice(0, 200), user.password))) throw new Problem('Your current password is incorrect.', 401);
}

/** Changes the password; every other login (here and in DeckForge) ends. The caller gets a fresh session. */
export async function changePassword(userId: string, current: unknown, next: unknown, email: string) {
  await checkCurrentPassword(userId, current);
  await newPassword(userId, checkPassword(next, email));
}

/** Signs out every login and forgets every trusted device (DeckForge too). The caller gets a fresh session. */
export async function logoutEverywhere(userId: string) {
  await tx(async c => {
    await c.query('update public.users set "sessionVersion" = "sessionVersion" + 1, "updatedAt" = now() where id = $1', [userId]);
    await c.query('delete from arena.sessions where user_id = $1', [userId]);
    await c.query('delete from arena.devices where user_id = $1', [userId]);
  });
}

export async function changeEmailStart(userId: string, newEmailIn: unknown, password: unknown) {
  await checkCurrentPassword(userId, password);
  const email = normEmail(newEmailIn);
  checkEmail(email);
  if (await one('select 1 from public.users where email = $1', [email])) throw new Problem('That email already has an account.');
  await sendCode(email, 'email', 'confirm your new email address', { userId });
}

export async function changeEmailVerify(userId: string, newEmailIn: unknown, code: unknown, oldEmail: string) {
  const email = normEmail(newEmailIn);
  const payload = await useCode(email, 'email', code);
  if (payload.userId !== userId) throw new Problem('That code is for a different account.', 403);
  try {
    await q('update public.users set email = $2, "emailVerified" = now(), "updatedAt" = now() where id = $1', [userId, email]);
  } catch (e: any) {
    if (e.code === '23505') throw new Problem('That email already has an account.');
    throw e;
  }
  background(sendMail(oldEmail, 'Your email address was changed',
    `The email address on your Millennium Arena account was changed to ${email}.\n\nIf this wasn't you, reset your password straight away using "Forgot password" with your new address, or reply to this email.${NOTICE_FOOTER}`));
}

/** Deletes the account everywhere: DeckForge decks and logins too (the database removes everything linked to it). */
export async function deleteAccount(userId: string, password: unknown, typed: unknown, username: string | null, email: string) {
  await checkCurrentPassword(userId, password);
  const want = (username ?? email).toLowerCase();
  if (String(typed ?? '').trim().toLowerCase() !== want) throw new Problem(`Type ${username ? 'your username' : 'your email'} to confirm.`);
  await q('delete from public.users where id = $1', [userId]);
}

const THEMES = new Set(['a', 'b', 'c', 'd']), SPEEDS = new Set(['slow', 'normal', 'fast', 'instant']), TIMERS = new Set([0, 60, 90, 180]);
/** Saves the settings that are given (anything unknown or out of range is refused). */
export async function saveSettings(userId: string, input: unknown) {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>, out: UserSettings = {};
  if ('theme' in s) { if (!THEMES.has(String(s.theme))) throw new Problem('Unknown theme.'); out.theme = String(s.theme) as UserSettings['theme']; }
  if ('artwork' in s) { const n = Number(s.artwork); if (!Number.isInteger(n) || n <= 0 || n > 999_999_999) throw new Problem('Unknown card.'); out.artwork = n; }
  if ('responses' in s) { if (s.responses !== 'smart' && s.responses !== 'always') throw new Problem('Unknown option.'); out.responses = s.responses; }
  if ('speed' in s) { if (!SPEEDS.has(String(s.speed))) throw new Problem('Unknown speed.'); out.speed = String(s.speed) as UserSettings['speed']; }
  if ('timer' in s) { const n = Number(s.timer); if (!TIMERS.has(n)) throw new Problem('Unknown timer.'); out.timer = n; }
  if ('effects' in s) out.effects = !!s.effects;
  if ('sound' in s) { const n = Number(s.sound); if (!(n >= 0 && n <= 100)) throw new Problem('Volume is 0 to 100.'); out.sound = Math.round(n); }
  const done = await one('update arena.profiles set settings = settings || $2 where user_id = $1 returning 1', [userId, out]);
  if (!done) throw new Problem('Choose a username first.');
}
