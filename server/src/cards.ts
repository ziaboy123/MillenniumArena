// Card data from Project Ignis's card database (BabelCDB): what the engine needs to run each card,
// plus a compact, gzipped list of names/text/stats for the browser.
import { existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ocgAttributeString, ocgRaceString, OcgType } from 'ocgcore-wasm';
import type { CardRow } from '@arena/shared';
import { ENGINE_DATA } from './config.ts';

export interface EngineCard {
  code: number; alias: number; setcodes: number[]; type: number; level: number; attribute: number; race: bigint;
  attack: number; defense: number; lscale: number; rscale: number; link_marker: number; name: string; text: string;
  /** The card's effect descriptions (str1-str16), which prompts refer to by number. */
  strings: string[];
}

const T = OcgType;
const titleCase = (s: string) => s.replace(/(^|[\s_-])(\w)/g, (_, a, b) => a.replace('_', ' ') + b.toUpperCase());

/** Official cards plus released and pre-release sets (not Rush, Skills or unofficial cards). */
function cardDatabases(): string[] {
  const dir = path.join(ENGINE_DATA, 'BabelCDB');
  if (!existsSync(dir)) throw new Error('Card data missing: run `npm run data` first.');
  return readdirSync(dir)
    .filter(f => /^(cards|release-.*|prerelease-(?!cards-rush).*)\.cdb$/.test(f))
    .sort((a, b) => (a === 'cards.cdb' ? -1 : b === 'cards.cdb' ? 1 : a.localeCompare(b)))
    .map(f => path.join(dir, f));
}

export function loadCards(): Map<number, EngineCard> {
  const cards = new Map<number, EngineCard>();
  for (const file of cardDatabases()) {
    const db = new DatabaseSync(file, { readOnly: true });
    const query = db.prepare('SELECT d.id, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.name, t.desc, t.str1, t.str2, t.str3, t.str4, t.str5, t.str6, t.str7, t.str8, t.str9, t.str10, t.str11, t.str12, t.str13, t.str14, t.str15, t.str16 FROM datas d JOIN texts t ON t.id = d.id');
    query.setReadBigInts(true);   // setcode and race are 64-bit
    for (const r of query.all() as any[]) {
      const code = Number(r.id), type = Number(r.type), level = Number(r.level), isLink = (type & T.LINK) !== 0;
      const setcodes: number[] = [];
      for (let s = BigInt(r.setcode); s > 0n; s >>= 16n) if (s & 0xffffn) setcodes.push(Number(s & 0xffffn));
      cards.set(code, {
        code, alias: Number(r.alias), setcodes, type, level: level & 0xff, attribute: Number(r.attribute), race: BigInt(r.race),
        attack: Number(r.atk), defense: isLink ? 0 : Number(r.def), lscale: (level >> 24) & 0xff, rscale: (level >> 16) & 0xff,
        link_marker: isLink ? Number(r.def) : 0, name: String(r.name), text: String(r.desc),
        strings: Array.from({ length: 16 }, (_, i) => String(r[`str${i + 1}`] ?? '')),
      });
    }
    db.close();
  }
  return cards;
}

function frameOf(type: number): string {
  if (type & T.SPELL) return 'spell';
  if (type & T.TRAP) return 'trap';
  const base = type & T.LINK ? 'link' : type & T.XYZ ? 'xyz' : type & T.SYNCHRO ? 'synchro' : type & T.FUSION ? 'fusion'
    : type & T.RITUAL ? 'ritual' : type & T.TOKEN ? 'token' : type & T.EFFECT ? 'effect' : 'normal';
  return type & T.PENDULUM ? `${base}_pendulum` : base;
}

function typeLine(c: EngineCard): string {
  const t = c.type;
  if (t & (T.SPELL | T.TRAP)) {
    const kind = t & T.QUICKPLAY ? 'Quick-Play ' : t & T.CONTINUOUS ? 'Continuous ' : t & T.EQUIP ? 'Equip ' : t & T.FIELD ? 'Field '
      : t & T.COUNTER ? 'Counter ' : t & T.RITUAL ? 'Ritual ' : '';
    return `${kind}${t & T.SPELL ? 'Spell' : 'Trap'}`;
  }
  const race = [...ocgRaceString.entries()].find(([bit]) => (c.race & BigInt(bit)) !== 0n)?.[1] ?? '';
  const parts = [race && titleCase(race)];
  for (const [bit, label] of [[T.FUSION, 'Fusion'], [T.RITUAL, 'Ritual'], [T.SYNCHRO, 'Synchro'], [T.XYZ, 'Xyz'], [T.LINK, 'Link'], [T.PENDULUM, 'Pendulum'],
    [T.SPIRIT, 'Spirit'], [T.UNION, 'Union'], [T.GEMINI, 'Gemini'], [T.TUNER, 'Tuner'], [T.FLIP, 'Flip'], [T.TOON, 'Toon']] as const)
    if (t & bit) parts.push(label);
  parts.push(t & T.EFFECT ? 'Effect' : t & T.NORMAL ? 'Normal' : '');
  return parts.filter(Boolean).join(' / ');
}

/** The browser's card list, gzipped once at startup (names, type line, stats and text for every card). */
export function clientCardList(cards: Map<number, EngineCard>): Buffer {
  const rows: CardRow[] = [];
  for (const c of cards.values()) {
    const monster = !(c.type & (T.SPELL | T.TRAP));
    const attribute = monster ? (ocgAttributeString.get(c.attribute as any) ?? '').toUpperCase() : '';
    rows.push([c.code, c.name, c.alias, frameOf(c.type), typeLine(c), attribute, monster ? c.level : 0,
      monster ? c.attack : -1, monster && !(c.type & T.LINK) ? c.defense : -1, c.text]);
  }
  return gzipSync(JSON.stringify(rows));
}
