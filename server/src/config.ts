// Server settings. Everything can be overridden with environment variables when deployed.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export const PORT = Number(process.env.ARENA_PORT ?? 3017);   // not PORT: dev tools set that for the browser app
/** The site lives under this path (nginx passes it through unchanged), e.g. https://daniyalzia.co.uk/millennium */
export const BASE = (process.env.BASE_PATH ?? '/millennium').replace(/\/$/, '');
/** Card database + card scripts, downloaded by `npm run data`. */
export const ENGINE_DATA = process.env.ENGINE_DATA ?? path.join(root, 'engine/data');
/** Decks shipped with the server (ours) and downloaded tournament decks. */
export const DECK_DIRS = { mine: path.join(root, 'server/decks'), tournament: path.join(ENGINE_DATA, 'decks') } as const;
/** The built browser app, served in production. */
export const CLIENT_DIST = path.join(root, 'client/dist');
/** Each duel runs in its own worker thread; this caps how many run at once (the homelab box has 2 cores, 4 GB). */
export const MAX_DUELS = Number(process.env.MAX_DUELS ?? 8);
/** Speed of duel playback: 1 = normal, 0 = no pauses (automated tests). */
export const PACE = Number(process.env.ARENA_PACE ?? 1);

let commit = '';
try { commit = readFileSync(path.join(root, 'engine/ENGINE_COMMIT'), 'utf8').slice(0, 8); } catch {}
export const ENGINE_NAME = `ygopro-core ${commit}`.trim();
