// The account API (under <base>/api): sign up, log in, codes, settings. JSON in, JSON out.
//
// Every request that changes something must be JSON (which a plain HTML form on another site can't send) and come
// from this site (its Origin header is checked), and the login cookie is SameSite=Strict, so other sites can't act
// for a logged-in person. Rate limits slow down password guessing and code spamming.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BASE, DEV } from '../config.ts';
import * as A from './accounts.ts';
import { deckApi } from '../decks-api.ts';
import { historyOf, profileOf, summaryOf, userByName } from '../history.ts';
import { devOutbox, MAIL_READY } from './mailer.ts';
import { limited } from './ratelimit.ts';
import { AUTH_READY, sha256 } from './security.ts';

const SESSION = 'ma_session', DEVICE = 'ma_device', MONTH = 30 * 86400;
const SECURE = !DEV;   // production is always served over https (Cloudflare)

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const value = part.slice(i + 1).trim();
    try { out[part.slice(0, i).trim()] = decodeURIComponent(value); } catch { out[part.slice(0, i).trim()] = value; }   // a malformed cookie is just a wrong one
  }
  return out;
}
function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${SECURE ? '; Secure' : ''}`;
}

/** The visitor's address: Cloudflare's header in production (the tunnel is the only way in), the socket otherwise. */
export function clientIp(req: IncomingMessage) {
  return (!DEV && String(req.headers['cf-connecting-ip'] ?? '')) || req.socket.remoteAddress || '?';
}

/** Is this request from a page on this site? (Browsers always send Origin on these requests.) */
export function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new A.Problem('Expected JSON.', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new A.Problem('Too much data.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch { throw new A.Problem('Bad JSON.'); }
}

function send(res: ServerResponse, status: number, body: unknown, setCookies: string[] = []) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(setCookies.length ? { 'set-cookie': setCookies } : {}) });
  res.end(JSON.stringify(body));
}

const { Problem } = A;
const tooMany = () => new A.Problem('Too many attempts. Wait a few minutes and try again.', 429);
const deviceLabel = (req: IncomingMessage) => {
  const ua = String(req.headers['user-agent'] ?? '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
};

/** Profiles: yours in full, anyone else's record only. */
async function profileApi(action: string, userId: string, body: Record<string, unknown>) {
  switch (action) {
    case 'me': return { profile: await profileOf(userId, true) };
    case 'user': {
      const id = await userByName(String(body.name ?? ''));
      const profile = id && await profileOf(id, id === userId);
      if (!profile) throw new A.Problem('No player has that name.', 404);
      return { profile };
    }
    case 'history': return { history: await historyOf(userId, Number(body.before) || undefined) };
    case 'summary': return await summaryOf(userId);
    default: throw new A.Problem('Not found.', 404);
  }
}

/** Handles <base>/api/me, /api/auth/*, /api/account/* (and /api/dev/mail on the development server). Returns false if not one of these. */
export async function accountRoutes(req: IncomingMessage, res: ServerResponse, rel: string): Promise<boolean> {
  if (!(rel === '/api/me' || rel.startsWith('/api/auth/') || rel.startsWith('/api/account/') || rel.startsWith('/api/decks/') || rel.startsWith('/api/profile/') || (DEV && rel === '/api/dev/mail'))) return false;
  const jar = cookies(req), ip = clientIp(req), ua = String(req.headers['user-agent'] ?? '');
  try {
    // development only: read the email a test account was sent (no real mailbox needed)
    if (rel === '/api/dev/mail') {
      const to = A.normEmail(new URL(req.url ?? '', 'http://x').searchParams.get('to'));
      return send(res, 200, devOutbox.get(to) ?? null), true;
    }
    if (rel === '/api/me' && req.method === 'GET') return send(res, 200, { me: await A.sessionUser(jar[SESSION]) }), true;

    if (req.method !== 'POST') throw new A.Problem('Not found.', 404);
    if (!sameOrigin(req)) throw new A.Problem('Requests must come from this site.', 403);
    // without the code key or email, signing up and logging in stay off rather than half working
    if (rel.startsWith('/api/auth/') && rel !== '/api/auth/logout' && !(AUTH_READY && MAIL_READY)) throw new A.Problem('Signing up and logging in are switched off for a moment. Try again later.', 503);
    const body = await readJson(req);
    const email = A.normEmail(body.email);
    /** Start a login session in this browser (and trust it for 30 days if asked). */
    const login = async (userId: string, trust: boolean) => {
      const token = await A.createSession(userId, ua);
      const set = [cookie(SESSION, token, MONTH)];
      if (trust) set.push(cookie(DEVICE, await A.trustDevice(userId, deviceLabel(req)), MONTH));
      send(res, 200, { ok: true, me: await A.sessionUser(token) }, set);
    };

    switch (rel) {
      // ----- signed out -----
      case '/api/auth/signup':
        if (limited(`signup:${ip}`, 10, 3600_000) || limited(`signup:${email}`, 3, 600_000)) throw tooMany();
        await A.signupStart(email, body.password);
        return send(res, 200, { ok: true }), true;
      case '/api/auth/signup/verify':
        if (limited(`code:${ip}`, 30, 900_000)) throw tooMany();
        return await login(await A.signupVerify(email, body.code), true), true;
      case '/api/auth/login': {
        if (limited(`login:${ip}`, 30, 900_000) || limited(`login:${email}`, 8, 900_000)) throw tooMany();
        const result = await A.loginStart(email, body.password, jar[DEVICE]);
        if ('needCode' in result) return send(res, 200, { ok: true, needCode: true }), true;
        return await login(result.userId, false), true;
      }
      case '/api/auth/login/verify':
        if (limited(`code:${ip}`, 30, 900_000)) throw tooMany();
        return await login(await A.loginVerify(email, body.code), body.trust === true), true;
      case '/api/auth/forgot':
        if (limited(`forgot:${ip}`, 10, 3600_000) || limited(`forgot:${email}`, 3, 600_000)) throw tooMany();
        await A.forgotStart(email);
        return send(res, 200, { ok: true }), true;
      case '/api/auth/forgot/verify':
        if (limited(`code:${ip}`, 30, 900_000)) throw tooMany();
        return await login(await A.forgotVerify(email, body.code, body.password), false), true;
      case '/api/auth/logout':
        await A.endSession(jar[SESSION]);
        return send(res, 200, { ok: true }, [cookie(SESSION, '', 0)]), true;
    }

    // ----- signed in -----
    const me = await A.sessionUser(jar[SESSION]);
    if (!me) throw new A.Problem('Please log in again.', 401);
    // the deck editor saves as you build, so decks get their own, much looser limit
    if (rel.startsWith('/api/decks/')) {
      if (limited(`decks:${me.id}`, 900, 900_000)) throw tooMany();
      if (!me.username) throw new Problem('Choose a username first.', 403);
      return send(res, 200, await deckApi(rel.slice('/api/decks/'.length), me.id, body)), true;
    }
    if (rel.startsWith('/api/profile/')) {
      if (limited(`settings:${me.id}`, 300, 900_000)) throw tooMany();
      return send(res, 200, await profileApi(rel.slice('/api/profile/'.length), me.id, body)), true;
    }
    // trying out themes and artwork saves a lot, so settings get a looser limit than the account changes
    const light = rel === '/api/account/settings' || rel === '/api/account/devices';
    if (light ? limited(`settings:${me.id}`, 300, 900_000) : limited(`account:${me.id}`, 30, 900_000)) throw tooMany();
    switch (rel) {
      case '/api/account/username': await A.setUsername(me.id, body.username); break;
      case '/api/account/settings': await A.saveSettings(me.id, body.settings); break;
      // both end every login and forget every trusted device, so this browser gets a fresh login (and stays trusted if it was)
      case '/api/account/password': {
        const trusted = await A.isTrusted(me.id, jar[DEVICE]);
        await A.changePassword(me.id, body.current, body.password, me.email);
        return await login(me.id, trusted), true;
      }
      case '/api/account/logout-everywhere': {
        const trusted = await A.isTrusted(me.id, jar[DEVICE]);
        await A.logoutEverywhere(me.id);
        return await login(me.id, trusted), true;
      }
      case '/api/account/email': await A.changeEmailStart(me.id, body.email, body.password); break;
      case '/api/account/email/verify': await A.changeEmailVerify(me.id, body.email, body.code, me.email); break;
      case '/api/account/devices': {
        const mine = jar[DEVICE] ? sha256(jar[DEVICE]).slice(0, 12) : '';
        return send(res, 200, { devices: (await A.listDevices(me.id)).map(d => ({ ...d, current: d.id === mine })) }), true;
      }
      case '/api/account/devices/forget': await A.forgetDevice(me.id, body.id); break;
      case '/api/account/delete':
        await A.deleteAccount(me.id, body.password, body.confirm, me.username, me.email);
        return send(res, 200, { ok: true }, [cookie(SESSION, '', 0), cookie(DEVICE, '', 0)]), true;
      default: throw new A.Problem('Not found.', 404);
    }
    return send(res, 200, { ok: true, me: await A.sessionUser(jar[SESSION]) }), true;
  } catch (e: any) {
    if (e instanceof A.Problem) return send(res, e.status, { error: e.message }), true;
    console.error(`account api ${rel}: ${e?.stack ?? e}`);
    return send(res, 500, { error: 'Something went wrong. Try again in a moment.' }), true;
  }
}
