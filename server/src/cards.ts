// Card data from Project Ignis's card database (BabelCDB): what the engine needs to run each card,
// plus a compact, gzipped list of names/text/stats for the browser.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ocgAttributeString, ocgRaceString, OcgType } from 'ocgcore-wasm';
import type { CardRow } from '@arena/shared';
import type { RuleCard } from '@arena/shared/decks';
import { ENGINE_DATA } from './config.ts';

export interface EngineCard {
  code: number; alias: number; setcodes: number[]; type: number; level: number; attribute: number; race: bigint;
  attack: number; defense: number; lscale: number; rscale: number; link_marker: number; name: string; text: string;
  /** Where the card is released (the database's "ot" flags: 0x1 OCG, 0x2 TCG, 0x100 not out yet). */
  ot: number;
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

/** Brand-new cards that Project Ignis still has under temporary numbers (101402090...) while YGOPRODeck, DeckForge and .ydk
 *  files use the official ones (50284408...), from engine/data/card-fixes.json (npm run data). official -> engine. */
const officialToEngine = new Map<number, number>(), engineToOfficial = new Map<number, number>();
/** The number the engine knows a card by (decks may use official numbers it doesn't have yet). */
export const engineCode = (code: number) => officialToEngine.get(code) ?? code;
/** The number everyone else knows a card by. */
export const officialCode = (code: number) => engineToOfficial.get(code) ?? code;
export const officialPairs = () => officialToEngine.entries();

/** Every card number with a picture worth serving (server/src/images.ts): the duel cards plus Skill, unofficial and
 *  Goat-format entries, which DeckForge shows even though duels don't use them (Rush Duel cards aren't included), and
 *  every picture number YGOPRODeck lists (engine/data/picture-ids.json from npm run data: its own Skill card numbers,
 *  alternate artworks). */
export function pictureIds(): Set<number> {
  const ids = new Set<number>();
  try { for (const id of JSON.parse(readFileSync(path.join(ENGINE_DATA, 'picture-ids.json'), 'utf8')).ids) ids.add(Number(id)); } catch {}   // not downloaded yet
  const dir = path.join(ENGINE_DATA, 'BabelCDB');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.cdb') && !f.includes('rush'))) {
    const db = new DatabaseSync(path.join(dir, f), { readOnly: true });
    for (const r of db.prepare('SELECT id FROM datas').all() as { id: number }[]) ids.add(Number(r.id));
    db.close();
  }
  return ids;
}

export function loadCards(): Map<number, EngineCard> {
  const cards = new Map<number, EngineCard>();
  for (const file of cardDatabases()) {
    const db = new DatabaseSync(file, { readOnly: true });
    const query = db.prepare('SELECT d.id, d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.name, t.desc, t.str1, t.str2, t.str3, t.str4, t.str5, t.str6, t.str7, t.str8, t.str9, t.str10, t.str11, t.str12, t.str13, t.str14, t.str15, t.str16 FROM datas d JOIN texts t ON t.id = d.id');
    query.setReadBigInts(true);   // setcode and race are 64-bit
    for (const r of query.all() as any[]) {
      const code = Number(r.id), type = Number(r.type), level = Number(r.level), isLink = (type & T.LINK) !== 0;
      const setcodes: number[] = [];
      for (let s = BigInt(r.setcode); s > 0n; s >>= 16n) if (s & 0xffffn) setcodes.push(Number(s & 0xffffn));
      cards.set(code, {
        code, alias: Number(r.alias), setcodes, type, level: level & 0xff, attribute: Number(r.attribute), race: BigInt(r.race),
        attack: Number(r.atk), defense: isLink ? 0 : Number(r.def), lscale: (level >> 24) & 0xff, rscale: (level >> 16) & 0xff,
        link_marker: isLink ? Number(r.def) : 0, name: String(r.name), text: String(r.desc), ot: Number(r.ot),
        strings: Array.from({ length: 16 }, (_, i) => String(r[`str${i + 1}`] ?? '')),
      });
    }
    db.close();
  }
  // Where Project Ignis lags behind real releases (engine/data/card-fixes.json, from npm run data): brand-new cards are also
  // known by their official numbers (decks and legality use those; duels translate them back), and cards count as released
  // where their real release date has passed (it keeps marking them OCG-only or "not out yet" for a while).
  const file = path.join(ENGINE_DATA, 'card-fixes.json'), today = new Date().toISOString().slice(0, 10);
  type Dates = { tcg: string | null; ocg: string | null };
  const released = (ot: number, d: Dates) => {
    const out = (d.tcg && d.tcg <= today ? 0x2 : 0) | (d.ocg && d.ocg <= today ? 0x1 : 0);
    return out ? (ot & ~0x100) | out : ot;
  };
  const fixes = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { official?: Record<string, Dates & { engine: number }>; released?: Record<string, Dates> } : {};
  for (const [code, d] of Object.entries(fixes.released ?? {})) { const c = cards.get(Number(code)); if (c) c.ot = released(c.ot, d); }
  for (const [official, d] of Object.entries(fixes.official ?? {})) {
    const c = cards.get(d.engine), code = Number(official);
    if (!c || cards.has(code)) continue;
    officialToEngine.set(code, d.engine); engineToOfficial.set(d.engine, code);
    cards.set(code, { ...c, code, ot: released(c.ot, d) });
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

const EXTRA_DECK = T.FUSION | T.SYNCHRO | T.XYZ | T.LINK;
/** What the deck rules (shared/decks.ts) need to know about each card. */
export const ruleCards = (cards: Map<number, EngineCard>) => (code: number): RuleCard | undefined => {
  const c = cards.get(code);
  return c && { name: c.name, alias: c.alias, extra: (c.type & EXTRA_DECK) !== 0, token: (c.type & T.TOKEN) !== 0, ot: c.ot };
};

/** The browser's card list, gzipped once at startup (names, type line, stats and text for every card). */
export function clientCardList(cards: Map<number, EngineCard>): Buffer {
  const rows: CardRow[] = [];
  for (const c of cards.values()) {
    if (engineToOfficial.has(c.code)) continue;   // sent once, under its official number (with the engine's number attached)
    const monster = !(c.type & (T.SPELL | T.TRAP));
    const attribute = monster ? (ocgAttributeString.get(c.attribute as any) ?? '').toUpperCase() : '';
    const row: CardRow = [c.code, c.name, c.alias, frameOf(c.type), typeLine(c), attribute, monster ? c.level : 0,
      monster ? c.attack : -1, monster && !(c.type & T.LINK) ? c.defense : -1, c.text, c.ot];
    const engine = officialToEngine.get(c.code);
    if (engine) row[11] = engine;
    rows.push(row);
  }
  return gzipSync(JSON.stringify(rows));
}
