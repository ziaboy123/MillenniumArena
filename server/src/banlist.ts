// The current TCG banlist, from Project Ignis's LFLists (downloaded by `npm run data`).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Banlist } from '@arena/shared/decks';
import { ENGINE_DATA } from './config.ts';

/** Reads the first list in an EDOPro .lflist.conf ("!2026.09 TCG", then "code copies --name" lines). */
export function loadBanlist(file = path.join(ENGINE_DATA, 'LFLists/0TCG.lflist.conf')): Banlist | null {
  if (!existsSync(file)) { console.warn('No banlist found: run `npm run data` (decks will be checked without one)'); return null; }
  const list: Banlist = { name: '', limits: {} };
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('!')) { if (list.name) break; list.name = line.slice(1).trim(); continue; }
    const m = /^(\d+)\s+([0-2])\b/.exec(line);
    if (m) list.limits[Number(m[1])] = Number(m[2]);
  }
  return list;
}
