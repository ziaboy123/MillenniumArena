// Sending email (codes and account notices). Production uses Resend (RESEND_API_KEY + ARENA_MAIL_FROM, e.g.
// "Millennium Arena <noreply@daniyalzia.co.uk>"). The development server prints mail to its console instead.
import { DEV } from '../config.ts';

const KEY = process.env.RESEND_API_KEY ?? '', FROM = process.env.ARENA_MAIL_FROM ?? '';
export const MAIL_READY = DEV || (!!KEY && !!FROM);

/** Development only: the last email sent to each address, for testing sign-up flows without a mailbox. */
export const devOutbox = new Map<string, { subject: string; text: string; at: number }>();

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (KEY && FROM) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`email not sent (${res.status})`);
    return;
  }
  if (!DEV) throw new Error('email is not set up on this server');
  devOutbox.set(to, { subject, text, at: Date.now() });
  console.log(`[dev mail] to ${to}: ${subject}`);
}

const footer = '\n\nIf you didn\'t ask for this, you can ignore this email.\n\nMillennium Arena';
export const codeMail = (code: string, what: string) => ({
  subject: `${code} is your Millennium Arena code`,
  text: `Your code to ${what} is ${code}. It works for 10 minutes and only once.${footer}`,
});
