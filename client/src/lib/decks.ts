// Deck helpers for the browser: the banlist, and what the deck rules (shared/decks.ts) need to know about cards.
import { copyLimit, type Banlist, type DeckFormat, type RuleCard } from '@arena/shared/decks';
import { card, type CardInfo } from './cards.ts';

let banlist: Promise<Banlist | null> | null = null, ocg: Promise<Banlist | null> | null = null;
const fetchList = (path: string) => fetch(`${import.meta.env.BASE_URL}api/${path}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
/** The current TCG banlist, fetched once. */
export const loadBanlist = () => (banlist ??= fetchList('banlist'));
/** Both banlists (private rooms can use either). */
export const loadBanlists = async () => ({ TCG: await loadBanlist(), OCG: await (ocg ??= fetchList('banlist/ocg')) });

const EXTRA_FRAMES = /^(fusion|synchro|xyz|link)/;
export const isExtraCard = (c: CardInfo) => EXTRA_FRAMES.test(c.frame);
export type Kind = 'monster' | 'spell' | 'trap';
export const kindOf = (c: CardInfo): Kind => (c.frame === 'spell' ? 'spell' : c.frame === 'trap' ? 'trap' : 'monster');

/** A card as the deck rules see it (undefined if it isn't in the card list). */
export const ruleCard = (code: number): RuleCard | undefined => {
  const c = card(code);
  return c && { name: c.name, alias: c.alias, extra: isExtraCard(c), token: c.frame === 'token', ot: c.ot };
};
export const limitOf = (code: number, list: Banlist | null, format: DeckFormat) => copyLimit(code, ruleCard(code), list, format);
