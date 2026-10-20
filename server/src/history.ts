// Match history and profiles. A finished duel is saved as one row per player (their result, opponent and deck), so
// each person's history belongs to them alone; deleting an account deletes its rows, and its name is taken off
// other people's histories. Cards each account summons, activates or Sets are counted for "most played".
import { randomUUID } from 'node:crypto';
import type { DeckRecord, HistoryRow, MatchKind, MatchResult, Profile, RecordStats } from '@arena/shared';
import { one, q, tx } from './db/index.ts';

export interface PlayerResult {
  userId: string; opponent: string; opponentId: string | null;
  deckName: string; deckId: string | null; cover: number | null;
  result: MatchResult; scoreFor: number; scoreAgainst: number;
  uses: Map<number, number>;
}
export interface MatchRecord { kind: MatchKind; bo: number; games: number; turns: number; reason: string; startedAt: number; players: PlayerResult[] }

/** Saves a finished match, retrying for a while if the database is unreachable. Never throws: a history problem
 *  mustn't spoil the duel. Each player's row is unique per match, so a retry never saves it twice. */
export async function recordMatch(m: MatchRecord) {
  const matchId = randomUUID();
  for (const wait of [0, 2_000, 10_000, 30_000, 120_000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { await save(m, matchId); return; }
    catch (e: any) { console.error(`history: couldn't save a match yet (${e?.message ?? e})`); }
  }
  console.error('history: gave up saving a match');
}

async function save(m: MatchRecord, matchId: string) {
  await tx(async c => {
    for (const p of m.players) {
      // the deck or opponent may have been deleted meanwhile: then they're simply not linked
      const saved = await c.query(`insert into arena.history (user_id, match_id, kind, bo, opponent, opponent_id, deck_name, deck_id, deck_cover, result, score_for, score_against, games, turns, reason, started_at)
        values ($1, $2, $3, $4, $5, (select id from public.users where id = $6), $7, (select id from public.decks where id = $8), $9, $10, $11, $12, $13, $14, $15, $16)
        on conflict (user_id, match_id) do nothing`,
        [p.userId, matchId, m.kind, m.bo, p.opponent.slice(0, 40), p.opponentId, p.deckName.slice(0, 60), p.deckId, p.cover, p.result, p.scoreFor, p.scoreAgainst,
          m.games, m.turns, m.reason.slice(0, 200), new Date(m.startedAt)]);
      if (saved.rowCount && p.uses.size) await c.query(`insert into arena.card_use (user_id, code, uses) select $1, code, n from unnest($2::int[], $3::int[]) as t(code, n)
        on conflict (user_id, code) do update set uses = arena.card_use.uses + excluded.uses`, [p.userId, [...p.uses.keys()], [...p.uses.values()]]);
    }
  });
}

/** When an account is deleted, other people's histories stop showing its name. */
export const forgetName = (userId: string) => q(`update arena.history set opponent = 'A deleted account' where opponent_id = $1`, [userId]);

function statsOf(results: MatchResult[]): RecordStats {
  const count = (r: MatchResult) => results.filter(x => x === r).length;
  let length = 0;
  for (const r of results) { if (r === results[0]) length++; else break; }
  let best = 0, run = 0;
  for (const r of [...results].reverse()) { run = r === 'win' ? run + 1 : 0; best = Math.max(best, run); }
  return { duels: results.length, wins: count('win'), losses: count('loss'), draws: count('draw'), streak: results.length ? { result: results[0], length } : null, bestWinStreak: best, form: results.slice(0, 10) };
}

async function recordFor(userId: string): Promise<Profile['stats']> {
  const rows = await q<{ kind: MatchKind; result: MatchResult }>('select kind, result from arena.history where user_id = $1 order by ended_at desc, id desc', [userId]);
  const of = (k?: MatchKind) => statsOf(rows.filter(r => !k || r.kind === k).map(r => r.result));
  return { all: of(), private: of('private'), unranked: of('unranked'), bot: of('bot') };
}

const row = (r: any): HistoryRow => ({
  id: Number(r.id), kind: r.kind, bo: r.bo, opponent: r.opponent, deck: r.deck_name, cover: r.deck_cover, result: r.result, scoreFor: r.score_for, scoreAgainst: r.score_against,
  games: r.games, turns: r.turns, reason: r.reason, startedAt: new Date(r.started_at).toISOString(), endedAt: new Date(r.ended_at).toISOString(),
});
/** Your history, newest first, 100 at a time (`before`: the oldest id already shown). */
export async function historyOf(userId: string, before?: number) {
  const rows = await q(`select * from arena.history where user_id = $1 ${before ? 'and id < $2' : ''} order by id desc limit 100`, before ? [userId, before] : [userId]);
  return rows.map(row);
}

/** A profile. `full`: it's yours (history, decks played and most-played cards too). */
export async function profileOf(userId: string, full: boolean): Promise<Profile | null> {
  const who = await one(`select p.username, p.settings, u."createdAt" as created from arena.profiles p join public.users u on u.id = p.user_id where p.user_id = $1`, [userId]);
  if (!who?.username) return null;
  const profile: Profile = { name: who.username, memberSince: new Date(who.created).toISOString(), artwork: Number(who.settings?.artwork) || null, you: full, stats: await recordFor(userId) };
  if (!full) return profile;
  const decks = await q(`select kind, deck_name, max(deck_cover) as cover, count(*)::int as duels, count(*) filter (where result = 'win')::int as wins,
    count(*) filter (where result = 'loss')::int as losses from arena.history where user_id = $1 group by kind, deck_name`, [userId]);
  const merge = (k?: MatchKind) => {
    const by = new Map<string, DeckRecord>();
    for (const d of decks.filter(x => !k || x.kind === k)) {
      const e = by.get(d.deck_name) ?? { name: d.deck_name, cover: d.cover, duels: 0, wins: 0, losses: 0 };
      e.duels += d.duels; e.wins += d.wins; e.losses += d.losses; e.cover ??= d.cover;
      by.set(d.deck_name, e);
    }
    return [...by.values()].sort((a, b) => b.duels - a.duels || b.wins - a.wins).slice(0, 12);
  };
  profile.decks = { all: merge(), private: merge('private'), unranked: merge('unranked'), bot: merge('bot') };
  profile.history = await historyOf(userId);
  profile.mostPlayed = (await q('select code from arena.card_use where user_id = $1 order by uses desc, code limit 10', [userId])).map(r => r.code);
  return profile;
}

/** The account with this username, if any (case doesn't matter). */
export const userByName = async (name: string) => (await one('select user_id from arena.profiles where username_key = $1', [String(name).toLowerCase().slice(0, 20)]))?.user_id as string | undefined;

/** For the Home screen: your record and your three most-played cards. */
export async function summaryOf(userId: string) {
  const stats = (await recordFor(userId)).all;
  const cards = (await q('select code from arena.card_use where user_id = $1 order by uses desc, code limit 3', [userId])).map(r => r.code as number);
  return { duels: stats.duels, wins: stats.wins, losses: stats.losses, mostPlayed: cards };
}
