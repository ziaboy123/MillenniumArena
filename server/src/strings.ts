// EDOPro's system strings (engine/data/strings.conf): the texts the engine refers to by number, like
// 506 "Select the card(s) to add to your hand", plus win reasons. Card effect texts live on each card.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ENGINE_DATA } from './config.ts';

const system = new Map<number, string>(), victory = new Map<number, string>();
const file = path.join(ENGINE_DATA, 'strings.conf');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^!(system|victory) (0x[0-9a-f]+|\d+) (.*)$/i.exec(line.trim());
    if (m) (m[1] === 'system' ? system : victory).set(Number(m[2]), m[3]);
  }
} else console.warn('strings.conf missing: run `npm run data` (prompts will show plain titles)');

export const sysString = (n: number) => system.get(n) ?? '';
export const victoryString = (n: number) => victory.get(n) ?? '';
