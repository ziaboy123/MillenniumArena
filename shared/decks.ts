// Deck rules, used by both the deck editor (to show problems as you build) and the server (before a duel).
// Decks are DeckForge's: a deck has a format, and its cards are stored there as rows of (card, zone, copies).

export type DeckFormat = 'ADVANCED' | 'TRADITIONAL' | 'SPEED_DUEL' | 'RUSH_DUEL';
export const FORMAT_NAMES: Record<DeckFormat, string> = { ADVANCED: 'TCG Advanced', TRADITIONAL: 'TCG Traditional', SPEED_DUEL: 'Speed Duel', RUSH_DUEL: 'Rush Duel' };
/** The formats Millennium Arena can duel with. */
export const PLAYABLE_FORMATS = new Set<DeckFormat>(['ADVANCED', 'TRADITIONAL']);

export type Zone = 'main' | 'extra' | 'side';
export const ZONES: Zone[] = ['main', 'extra', 'side'];
export const ZONE_MAX: Record<Zone, number> = { main: 60, extra: 15, side: 15 };
export const MAIN_MIN = 40;

export interface DeckLists { main: number[]; extra: number[]; side: number[] }
/** A deck as the Decks page sees it. `cover` is the card whose art is on its tile (DeckForge's thumbnail column). */
export interface SavedDeck extends DeckLists { id: string; name: string; format: DeckFormat; cover: number | null; updatedAt: string }

/** The current TCG banlist: card code → copies allowed (0 Forbidden, 1 Limited, 2 Semi-Limited); every other card 3. */
export interface Banlist { name: string; limits: Record<number, number> }

/** What the rules need to know about a card. */
export interface RuleCard { name: string; alias: number; extra: boolean; token: boolean; ot: number }

/** Alternate artworks count as the same card (the engine's own rule: an alias within 20 of the code is an artwork). */
export const baseCode = (code: number, card?: Pick<RuleCard, 'alias'>) => (card?.alias && Math.abs(card.alias - code) < 20 ? card.alias : code);

/** Released in the TCG (not OCG-only, not still to come). */
export const isTcg = (card: Pick<RuleCard, 'ot'>) => (card.ot & 0x2) !== 0 && (card.ot & 0x100) === 0;
/** Released in the region's card pool (null: any card goes). */
export const releasedIn = (card: Pick<RuleCard, 'ot'>, region: 'TCG' | 'OCG' | null) =>
  region === null || ((card.ot & (region === 'TCG' ? 0x2 : 0x1)) !== 0 && (card.ot & 0x100) === 0);

/** How many copies of a card a deck may hold in this format. */
export function copyLimit(code: number, card: RuleCard | undefined, banlist: Banlist | null, format: DeckFormat) {
  const listed = banlist?.limits[code] ?? banlist?.limits[baseCode(code, card)];
  const limit = listed ?? 3;
  return format === 'TRADITIONAL' && limit === 0 ? 1 : limit;
}
export const LIMIT_NAMES = ['Forbidden', 'Limited', 'Semi-Limited'];

export type ProblemKind = 'format' | 'size' | 'unknown' | 'copies' | 'banlist' | 'release';
export interface DeckProblem { kind: ProblemKind; text: string }

/**
 * Everything that stops a deck being legal in its format, most important first. Size, unknown cards and format
 * problems stop it being played at all; banlist, copies and release problems only matter where the rules are checked.
 */
export function deckProblems(deck: DeckLists & { format: DeckFormat }, cardOf: (code: number) => RuleCard | undefined, banlist: Banlist | null,
  /** Which cards count as released: the TCG's (default), the OCG's, or any (a room with no banlist). */
  region: 'TCG' | 'OCG' | null = 'TCG'): DeckProblem[] {
  const out: DeckProblem[] = [];
  if (!PLAYABLE_FORMATS.has(deck.format)) out.push({ kind: 'format', text: `${FORMAT_NAMES[deck.format]} decks can't be played here` });
  const n = { main: deck.main.length, extra: deck.extra.length, side: deck.side.length };
  if (n.main < MAIN_MIN || n.main > ZONE_MAX.main) out.push({ kind: 'size', text: `The Main Deck has ${n.main} cards (it needs ${MAIN_MIN} to ${ZONE_MAX.main})` });
  if (n.extra > ZONE_MAX.extra) out.push({ kind: 'size', text: `The Extra Deck has ${n.extra} cards (15 at most)` });
  if (n.side > ZONE_MAX.side) out.push({ kind: 'size', text: `The Side Deck has ${n.side} cards (15 at most)` });

  const all = [...deck.main, ...deck.extra, ...deck.side];
  const unknown = all.filter(c => !cardOf(c)).length;
  if (unknown) out.push({ kind: 'unknown', text: `${unknown} ${unknown === 1 ? "card isn't" : "cards aren't"} in Millennium Arena's card list` });
  const misplaced = [...deck.main.filter(c => cardOf(c)?.extra), ...deck.extra.filter(c => cardOf(c) && !cardOf(c)!.extra)].length;
  if (misplaced) out.push({ kind: 'size', text: `${misplaced} ${misplaced === 1 ? 'card is' : 'cards are'} in the wrong deck (Extra Deck monsters go in the Extra Deck)` });
  const tokens = all.filter(c => cardOf(c)?.token).length;
  if (tokens) out.push({ kind: 'size', text: 'Tokens can\'t be put in a deck' });

  // copies, counted across Main, Extra and Side, with alternate artworks counted as the same card
  const counts = new Map<number, { n: number; code: number }>();
  for (const code of all) {
    const card = cardOf(code);
    if (!card) continue;
    const base = baseCode(code, card);
    const entry = counts.get(base) ?? { n: 0, code };
    entry.n++;
    counts.set(base, entry);
  }
  const released: string[] = [];
  for (const [, { n: copies, code }] of counts) {
    const card = cardOf(code)!;
    const limit = copyLimit(code, card, banlist, deck.format);
    if (limit === 0) out.push({ kind: 'banlist', text: `${card.name} is Forbidden` });
    else if (copies > limit) out.push(limit < 3
      ? { kind: 'banlist', text: `${card.name} is ${LIMIT_NAMES[limit]}: ${copies} copies (${limit} allowed)` }
      : { kind: 'copies', text: `${card.name}: ${copies} copies (3 at most)` });
    if (!releasedIn(card, region)) released.push(card.name);
  }
  if (released.length) out.push({ kind: 'release', text: released.length === 1 ? `${released[0]} isn't released in the ${region}` : `${released.length} cards aren't released in the ${region} (${released.slice(0, 3).join(', ')}${released.length > 3 ? '…' : ''})` });
  return out;
}

/** Problems that stop a deck from being duelled with at all (even against the bot). */
export const blocksPlay = (p: DeckProblem) => p.kind === 'format' || p.kind === 'size' || p.kind === 'unknown';

/** A deck as a .ydk file, the format EDOPro, Dueling Nexus and YGOPRODeck use. */
export function toYdk(deck: DeckLists & { name: string }) {
  return ['#created by Millennium Arena', `#name ${deck.name.replace(/[\r\n]/g, ' ')}`, '#main', ...deck.main, '#extra', ...deck.extra, '!side', ...deck.side, ''].join('\n');
}

/** Reads a .ydk file. Unknown lines are skipped; `#name` (if any) gives the deck's name. */
export function parseYdk(text: string): DeckLists & { name: string | null } {
  const out: DeckLists & { name: string | null } = { name: null, main: [], extra: [], side: [] };
  let zone: Zone | null = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#name ')) out.name = line.slice(6).trim().slice(0, 60) || null;
    else if (line === '#main') zone = 'main';
    else if (line === '#extra') zone = 'extra';
    else if (line === '!side') zone = 'side';
    else if (zone && /^\d{1,9}$/.test(line)) out[zone].push(Number(line));
  }
  return out;
}

/**
 * Why a deck can't be used for a duel, or null if it can. Against the bot (`rules` null) it only has to be playable;
 * in a private room the room's banlist decides (whatever format the deck was built for), and with deck check on it
 * must be fully legal.
 */
export function deckBlocker(d: SavedDeck, cardOf: (code: number) => RuleCard | undefined, banlists: { TCG: Banlist | null; OCG: Banlist | null },
  rules: { banlist: 'TCG' | 'OCG' | 'none'; check: boolean } | null): string | null {
  const region = !rules ? 'TCG' : rules.banlist === 'none' ? null : rules.banlist;
  const format = rules && d.format === 'TRADITIONAL' ? 'ADVANCED' : d.format;
  const problems = deckProblems({ ...d, format }, cardOf, region ? banlists[region] : null, rules?.check ? region : null);
  const stop = problems.find(blocksPlay) ?? (rules?.check ? problems[0] : undefined);
  return stop ? `${d.name} can't be used${rules ? ' in this room' : ' yet'}: ${stop.text[0].toLowerCase()}${stop.text.slice(1)}.` : null;
}
