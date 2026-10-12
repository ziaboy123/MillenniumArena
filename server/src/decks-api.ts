// The Decks page's API: the account's decks, kept in DeckForge's tables (public.decks + public.deck_cards) so the
// same decks show up on both sites. DeckForge stores one row per card and zone with a copy count (1-3) and an order,
// and uses its `thumbnail` column for nothing, so it holds the deck's cover card here.
//
// Every query is scoped to the logged-in account ("userId" = $1): nobody can read or change another account's deck,
// even with its id.
import { ZONES, type DeckFormat, type DeckLists, type SavedDeck, type Zone } from '@arena/shared/decks';
import { Problem } from './auth/accounts.ts';
import { newId } from './auth/security.ts';
import { one, q, tx } from './db/index.ts';

const MAX_DECKS = 300;
const MAX_PER_ZONE = 90;   // generous: legality is checked separately, this only stops nonsense
const ZONE_DB: Record<Zone, 'MAIN' | 'EXTRA' | 'SIDE'> = { main: 'MAIN', extra: 'EXTRA', side: 'SIDE' };
const FORMATS = new Set<DeckFormat>(['ADVANCED', 'TRADITIONAL', 'SPEED_DUEL', 'RUSH_DUEL']);

function cleanName(v: unknown): string {
  const name = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new Problem('Give the deck a name.');
  return name;
}
const cleanCode = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 999_999_999) throw new Problem('That deck has a card that doesn\'t exist.');
  return n;
};
function cleanLists(body: Record<string, unknown>): DeckLists {
  const out: DeckLists = { main: [], extra: [], side: [] };
  for (const z of ZONES) {
    const list = body[z] ?? [];
    if (!Array.isArray(list) || list.length > MAX_PER_ZONE) throw new Problem('That deck has too many cards.');
    out[z] = list.map(cleanCode);
    // DeckForge keeps at most 3 copies of a card in each zone
    const seen = new Map<number, number>();
    for (const c of out[z]) if (seen.set(c, (seen.get(c) ?? 0) + 1).get(c)! > 3) throw new Problem('A deck can only have 3 copies of a card.');
  }
  return out;
}
const cleanCover = (v: unknown) => (v === null || v === undefined || v === '' ? null : cleanCode(v));
const coverOf = (thumbnail: unknown) => (typeof thumbnail === 'string' && /^\d{1,9}$/.test(thumbnail) ? Number(thumbnail) : null);

/** The account's decks (all, or the ones with these ids), newest first, with their cards in order. */
async function decksOf(userId: string, ids?: string[]): Promise<SavedDeck[]> {
  const rows = await q(`select id, name, format, thumbnail, "updatedAt" from public.decks where "userId" = $1 ${ids ? 'and id = any($2)' : ''}
    order by "updatedAt" desc limit ${MAX_DECKS}`, ids ? [userId, ids] : [userId]);
  if (!rows.length) return [];
  const decks = new Map<string, SavedDeck>(rows.map(r => [r.id, {
    id: r.id, name: r.name, format: r.format, cover: coverOf(r.thumbnail), updatedAt: new Date(r.updatedAt).toISOString(), main: [], extra: [], side: [],
  }]));
  const cards = await q(`select "deckId", "cardId", zone, quantity from public.deck_cards where "deckId" = any($1) order by "sortOrder", id`, [[...decks.keys()]]);
  for (const c of cards) {
    const zone = (Object.keys(ZONE_DB) as Zone[]).find(z => ZONE_DB[z] === c.zone);
    if (zone) for (let i = 0; i < Math.min(Number(c.quantity), 3); i++) decks.get(c.deckId)![zone].push(Number(c.cardId));
  }
  return [...decks.values()];
}

/** Replaces a deck's cards: one row per card and zone, in the order the cards first appear. */
async function writeCards(c: { query: (text: string, params: unknown[]) => Promise<unknown> }, deckId: string, lists: DeckLists) {
  await c.query('delete from public.deck_cards where "deckId" = $1', [deckId]);
  const ids: string[] = [], codes: number[] = [], zones: string[] = [], counts: number[] = [], orders: number[] = [];
  for (const z of ZONES) {
    const order: number[] = [], count = new Map<number, number>();
    for (const code of lists[z]) { if (!count.has(code)) order.push(code); count.set(code, (count.get(code) ?? 0) + 1); }
    for (const code of order) { ids.push(newId()); codes.push(code); zones.push(ZONE_DB[z]); counts.push(count.get(code)!); orders.push(orders.length); }
  }
  if (ids.length) await c.query(`insert into public.deck_cards (id, "deckId", "cardId", zone, quantity, "sortOrder")
    select id, $1, card, zone::"DeckZone", n, ord from unnest($2::text[], $3::int[], $4::text[], $5::int[], $6::int[]) as t(id, card, zone, n, ord)`,
    [deckId, ids, codes, zones, counts, orders]);
}

async function create(userId: string, name: string, format: DeckFormat, lists: DeckLists, cover: number | null) {
  const count = await one('select count(*)::int as n from public.decks where "userId" = $1', [userId]);
  if (count.n >= MAX_DECKS) throw new Problem(`You can have up to ${MAX_DECKS} decks. Delete some to make room.`);
  const id = newId();
  await tx(async c => {
    await c.query(`insert into public.decks (id, name, format, thumbnail, "userId", "updatedAt") values ($1, $2, $3::"DeckFormat", $4, $5, now())`,
      [id, name, format, cover === null ? null : String(cover), userId]);
    await writeCards(c, id, lists);
  });
  return (await decksOf(userId, [id]))[0];
}

/** One deck, if it's this account's. */
export const accountDeck = async (userId: string, id: string) => (await decksOf(userId, [String(id).slice(0, 40)]))[0] ?? null;
/** All the account's decks. */
export const accountDecks = (userId: string) => decksOf(userId);
/** The deck the account duels with by default. */
export const activeDeck = async (userId: string): Promise<string | null> =>
  (await one('select active_deck from arena.profiles where user_id = $1', [userId]))?.active_deck ?? null;

/** POST <base>/api/decks/<action>, for a logged-in account. Returns the response body. */
export async function deckApi(action: string, userId: string, body: Record<string, unknown>): Promise<unknown> {
  const id = String(body.id ?? '').slice(0, 40);
  switch (action) {
    case 'list':
      return { decks: await decksOf(userId), active: await activeDeck(userId) };
    case 'get': {
      const deck = await accountDeck(userId, id);
      if (!deck) throw new Problem('That deck no longer exists.', 404);
      return { deck, active: await activeDeck(userId) };
    }
    case 'create': {
      const format = FORMATS.has(body.format as DeckFormat) ? (body.format as DeckFormat) : 'ADVANCED';
      return { deck: await create(userId, cleanName(body.name ?? 'Untitled deck'), format, cleanLists(body), cleanCover(body.cover)) };
    }
    case 'save': {
      const name = cleanName(body.name), lists = cleanLists(body), cover = cleanCover(body.cover);
      const saved = await tx(async c => {
        const r = await c.query(`update public.decks set name = $3, thumbnail = $4, "updatedAt" = now() where id = $1 and "userId" = $2 returning id`,
          [id, userId, name, cover === null ? null : String(cover)]);
        if (!r.rowCount) return false;
        await writeCards(c, id, lists);
        return true;
      });
      if (!saved) throw new Problem('That deck no longer exists.', 404);
      return { deck: (await decksOf(userId, [id]))[0] };
    }
    case 'duplicate': {
      const deck = await accountDeck(userId, id);
      if (!deck) throw new Problem('That deck no longer exists.', 404);
      return { deck: await create(userId, cleanName(`${deck.name.slice(0, 53)} (copy)`), deck.format, deck, deck.cover) };
    }
    case 'delete':
      await q('delete from public.decks where id = $1 and "userId" = $2', [id, userId]);   // its cards go with it; "Dueling with" clears itself
      return { ok: true };
    case 'active': {
      if (!(await accountDeck(userId, id))) throw new Problem('That deck no longer exists.', 404);
      await q('update arena.profiles set active_deck = $2 where user_id = $1', [userId, id]);
      return { ok: true };
    }
    default: throw new Problem('Not found.', 404);
  }
}
