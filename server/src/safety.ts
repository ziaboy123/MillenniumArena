// Keeping people safe (the Online Safety Act's duties for a site where strangers can chat): reports, suspended
// accounts, and agreeing to the Terms. See docs/online-safety.md.
//
// A report keeps who reported whom, their reason, and the last chat lines from the reporter's room, for a person to
// review; it's emailed to the owner and deleted after REPORT_DAYS (the database's regular sweep). A suspended account
// can't log in, chat or look for duels. Suspending is done by hand for now:
//   update arena.profiles set suspended_at = now(), suspended_reason = '...' where username_key = lower('Name');
import type { ChatLine } from '@arena/shared';
import { Problem } from './auth/accounts.ts';
import { sendMail } from './auth/mailer.ts';
import { one, q } from './db/index.ts';

/** How long reports are kept. */
export const REPORT_DAYS = 90;
/** The Terms everyone has to agree to (when they change, bump this and everyone is asked again). */
export const TERMS_VERSION = '2026-10-20';
export const SUSPENDED = "This account is suspended. If you think that's a mistake, email mail@daniyalzia.co.uk to appeal.";
const REPORT_TO = process.env.ARENA_REPORT_EMAIL || 'mail@daniyalzia.co.uk';

const clean = (text: unknown, max: number) => String(text ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The room a player is in and its recent chat (the server knows the rooms; it sets this when it starts). */
let contextOf: (userId: string) => { room: string; lines: ChatLine[] } | null = () => null;
export const setReportContext = (fn: typeof contextOf) => { contextOf = fn; };

/** A player reports another, from the chat panel (with the room's recent chat) or from a profile. */
export async function report(reporter: { id: string; name: string }, input: Record<string, unknown>) {
  const name = clean(input.username, 20);
  const context = input.context === 'profile' ? 'profile' : 'chat';
  const reason = clean(input.reason, 500);
  const target = name ? await one('select user_id, username from arena.profiles where username_key = $1', [name.toLowerCase()]) : undefined;
  if (!target) throw new Problem('No player has that name.', 404);
  if (target.user_id === reporter.id) throw new Problem("You can't report yourself.");
  const room = context === 'chat' ? contextOf(reporter.id) : null;
  const lines = (room?.lines ?? []).slice(-20);
  await q(`insert into arena.reports (reporter_id, reporter_name, reported_id, reported_name, context, room, reason, lines)
    values ($1, $2, $3, $4, $5, $6, $7, $8)`, [reporter.id, reporter.name, target.user_id, target.username, context, room?.room ?? null, reason, JSON.stringify(lines)]);
  // the report is saved either way; a failed email is only logged
  const time = (at: number) => new Date(at).toISOString().slice(11, 19);
  const text = [
    `${reporter.name} reported ${target.username} ${context === 'chat' ? `from the chat in ${room?.room ?? 'a room that has since closed'}` : 'from their profile'}.`,
    `Reason: ${reason || '(none given)'}`,
    ...(lines.length ? ['', 'Recent chat (UTC):', ...lines.map(l => `[${time(l.at)}] ${l.role === 'system' ? '·' : `${l.from}:`} ${l.text}`)] : []),
    '', `Kept for ${REPORT_DAYS} days in arena.reports. The Privacy Policy promises this email is deleted by then too: delete it by ${new Date(Date.now() + REPORT_DAYS * 86400_000).toISOString().slice(0, 10)}.`,
    `To suspend: update arena.profiles set suspended_at = now(), suspended_reason = '...' where username_key = '${target.username.toLowerCase()}';`,
  ].join('\n');
  sendMail(REPORT_TO, `Report: ${target.username} (from ${reporter.name})`, text).catch(e => console.error(`report email: ${e?.message ?? e}`));
}

// whether an account may chat and look for duels: not suspended, and has agreed to the current Terms. Checked on
// every chat line and search, so it's kept for a short while (a suspension takes effect within half a minute)
const standing = new Map<string, { at: number; suspended: boolean; terms: boolean }>();
export async function standingOf(userId: string) {
  const known = standing.get(userId);
  if (known && Date.now() - known.at < 30_000) return known;
  const row = await one('select suspended_at, terms_version from arena.profiles where user_id = $1', [userId]);
  const fresh = { at: Date.now(), suspended: !!row?.suspended_at, terms: row?.terms_version === TERMS_VERSION };
  standing.set(userId, fresh);
  return fresh;
}
/** Forget what's known about an account (it just agreed to the Terms). */
export const forgetStanding = (userId: string) => standing.delete(userId);
setInterval(() => { const now = Date.now(); for (const [k, v] of standing) if (now - v.at > 60_000) standing.delete(k); }, 300_000).unref();
