// The bot that answers every prompt the engine sends for a side nobody is playing.
//   - 'random': legal moves at random with a few preferences. The engine test uses this style to stir up odd
//     board states; it's also the yardstick the smarter bot is measured against.
//   - 'smart': plays the game with simple, general sense: attacks it can win, sensible positions, harmful
//     effects aimed at the opponent and costs paid with its least useful cards, chains when the opponent acts.
//     It doesn't know any deck's combos, so it is still beatable.
import {
  OcgLocation, OcgMessageType as M, OcgPosition, OcgResponseType as R, OcgType, SelectBattleCMDAction, SelectIdleCMDAction,
} from 'ocgcore-wasm';
import type { Side, SideView } from '@arena/shared';
import type { EngineCard } from '../cards.ts';
import { declarableCodes } from './declare.ts';

export type Rng = () => number;
export type BotLevel = 'smart' | 'random';
export interface BotState { acts: number; attacks: number; attackerAtk?: number }
/** What the smart bot can see when it decides: the board (engine sides), the chain so far and the engine's hint. */
export interface BotView { board: [SideView, SideView]; chain: { code: number; p: Side }[]; hint: bigint }

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Fisher-Yates shuffle in place. */
export function shuffle<T>(a: T[], r: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function pickN(r: Rng, n: number, len: number) {
  const idx = [...Array(len).keys()];
  for (let i = len - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, n).sort((a, b) => a - b);
}

// zone bitmask: a set bit means "can't use". Bits 0-6 own monster zones (5-6 = Extra Monster Zones),
// 8-15 own spell/trap zones; +16 for the opponent's side.
function freePlaces(m: any, count: number, r: Rng) {
  const own: any[] = [], theirs: any[] = [];
  for (let bit = 0; bit < 32; bit++) {
    const b = bit % 16, isMonster = b < 8, seq = b % 8;
    if ((isMonster && seq > 6) || ((m.field_mask >>> bit) & 1)) continue;
    (bit < 16 ? own : theirs).push({ player: bit < 16 ? m.player : 1 - m.player, location: isMonster ? OcgLocation.MZONE : OcgLocation.SZONE, sequence: seq });
  }
  const shuffle = (a: any[]) => a.sort(() => r() - 0.5);
  return [...shuffle(own), ...shuffle(theirs)].slice(0, count);
}

// choose cards whose values (usually Levels) add up to the amount; each card may count as one of two values.
// select_max 0 = exactly the amount, otherwise at least the amount with no card left over (Ritual-style)
function solveSum(m: any) {
  const vals = (c: any) => [c.amount & 0xffff, c.amount >> 16].filter((v, i) => i === 0 || v);
  let base = 0; for (const c of m.selects_must) base += vals(c)[0];
  const target = m.amount - base, sel = m.selects, chosen: number[] = [], used: number[] = [];
  const atLeast = m.select_max !== 0;
  const ok = (sum: number) => atLeast ? sum >= target && used.every(v => sum - v < target) : sum === target;
  const dfs = (i: number, sum: number): boolean => {
    if (chosen.length >= m.min && chosen.length && ok(sum)) return true;
    if (i >= sel.length || chosen.length >= (m.max || sel.length) || (!atLeast && sum > target)) return false;
    for (const v of vals(sel[i])) { chosen.push(i); used.push(v); if (dfs(i + 1, sum + v)) return true; chosen.pop(); used.pop(); }
    return dfs(i + 1, sum);
  };
  return dfs(0, 0) ? chosen : [...Array(Math.max(m.min, 1)).keys()];
}

/** Answer one prompt. `tries` counts how many answers to this prompt the engine has already rejected. */
export function decide(m: any, r: Rng, s: BotState, tries: number, cards: Map<number, EngineCard>, view?: BotView, level: BotLevel = 'smart'): any {
  // after a rejected answer, fall back to the random bot's broader choices so the duel can't get stuck
  if (level === 'smart' && view && tries === 0) {
    const answer = smart(m, r, s, cards, view);
    if (answer !== undefined) return answer;
  }
  return random(m, r, s, tries, cards);
}

function random(m: any, r: Rng, s: BotState, tries: number, cards: Map<number, EngineCard>): any {
  switch (m.type) {
    case M.SELECT_IDLECMD: {
      const groups = ([
        [SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, m.special_summons, 4], [SelectIdleCMDAction.SELECT_SUMMON, m.summons, 4],
        [SelectIdleCMDAction.SELECT_ACTIVATE, m.activates, 3], [SelectIdleCMDAction.SELECT_MONSTER_SET, m.monster_sets, 1],
        [SelectIdleCMDAction.SELECT_SPELL_SET, m.spell_sets, 1],
      ] as [number, any[], number][]).filter(([, list]) => list.length);
      if (groups.length && s.acts < 25 && tries < 3) {
        s.acts++;
        let w = r() * groups.reduce((a, g) => a + g[2], 0);
        const [action, list] = groups.find(g => (w -= g[2]) < 0) ?? groups[0];
        return { type: R.SELECT_IDLECMD, action, index: Math.floor(r() * list.length) };
      }
      return { type: R.SELECT_IDLECMD, action: m.to_bp ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP, index: null };
    }
    case M.SELECT_BATTLECMD:
      if (m.attacks.length && s.attacks < 6 && tries < 3) { s.attacks++; return { type: R.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: Math.floor(r() * m.attacks.length) }; }
      return { type: R.SELECT_BATTLECMD, action: m.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP, index: null };
    case M.SELECT_CHAIN:
      if (m.selects.length && (m.forced || (r() < 0.6 && tries === 0))) return { type: R.SELECT_CHAIN, index: m.forced ? 0 : Math.floor(r() * m.selects.length) };
      return { type: R.SELECT_CHAIN, index: null };
    case M.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: tries === 0 && r() < 0.85 };
    case M.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: tries === 0 && r() < 0.85 };
    case M.SELECT_OPTION: return { type: R.SELECT_OPTION, index: Math.floor(r() * m.options.length) };
    case M.SELECT_CARD: {
      const n = Math.min(m.selects.length, Math.max(m.min, 1) + tries, m.max);
      return { type: R.SELECT_CARD, indicies: pickN(r, n, m.selects.length) };
    }
    case M.SELECT_UNSELECT_CARD:
      if ((m.can_finish && (tries > 0 || r() < 0.5)) || !m.select_cards.length) return { type: R.SELECT_UNSELECT_CARD, index: null };
      return { type: R.SELECT_UNSELECT_CARD, index: Math.floor(r() * m.select_cards.length) };
    case M.SELECT_TRIBUTE: return { type: R.SELECT_TRIBUTE, indicies: pickN(r, Math.min(m.selects.length, tries ? m.max : m.min), m.selects.length) };
    case M.SELECT_SUM: return { type: R.SELECT_SUM, indicies: solveSum(m) };
    case M.SELECT_PLACE: return { type: R.SELECT_PLACE, places: freePlaces(m, m.count, r) };
    case M.SELECT_DISFIELD: return { type: R.SELECT_DISFIELD, places: freePlaces(m, m.count, r) };
    case M.SELECT_POSITION: {
      const pref = [OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEDOWN_ATTACK].filter(p => m.positions & p);
      return { type: R.SELECT_POSITION, position: pref[tries % pref.length] };
    }
    case M.SELECT_COUNTER: {
      let left = m.count;
      return { type: R.SELECT_COUNTER, counters: m.cards.map((c: any) => { const k = Math.min(c.count, left); left -= k; return k; }) };
    }
    case M.SORT_CARD: case M.SORT_CHAIN: return { type: R.SORT_CARD, order: null };
    case M.ANNOUNCE_RACE: case M.ANNOUNCE_ATTRIB: {
      const bits: bigint[] = [];
      for (let b = 0n; b < 64n && bits.length < m.count; b++) if (BigInt(m.available) & (1n << b)) bits.push(1n << b);
      return m.type === M.ANNOUNCE_RACE ? { type: R.ANNOUNCE_RACE, races: bits } : { type: R.ANNOUNCE_ATTRIB, attributes: bits.map(Number) };
    }
    case M.ANNOUNCE_CARD: {
      const fit = declarableCodes(cards, m.opcodes);   // the engine's own rule (the wrapper's matcher misreads Attributes)
      return { type: R.ANNOUNCE_CARD, card: fit.length ? fit[Math.floor(r() * fit.length)] : 46986414 };
    }
    // the engine wants the option's position in the list, not the number itself
    case M.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: tries ? 0 : Math.floor(r() * m.options.length) };
    case M.ROCK_PAPER_SCISSORS: return { type: R.ROCK_PAPER_SCISSORS, value: 1 + Math.floor(r() * 3) };
  }
  return null;
}

/** Every message type that waits for an answer. */
export const PROMPTS = new Set<number>([
  M.SELECT_BATTLECMD, M.SELECT_IDLECMD, M.SELECT_EFFECTYN, M.SELECT_YESNO, M.SELECT_OPTION, M.SELECT_CARD, M.SELECT_CHAIN,
  M.SELECT_PLACE, M.SELECT_POSITION, M.SELECT_TRIBUTE, M.SORT_CHAIN, M.SELECT_COUNTER, M.SELECT_SUM, M.SELECT_DISFIELD, M.SORT_CARD,
  M.SELECT_UNSELECT_CARD, M.ANNOUNCE_RACE, M.ANNOUNCE_ATTRIB, M.ANNOUNCE_CARD, M.ANNOUNCE_NUMBER, M.ROCK_PAPER_SCISSORS,
]);

// ---------- the smart bot ----------

const FACEDOWN = 0xa, DEFENSE = 0xc;
const HARMFUL = new Set([502, 503, 505, 507, 520, 530, 575, 576]);       // destroy, banish, bounce, spin, steal, "opponent's card", negate, change ATK
const HELPFUL = new Set([506, 508, 509, 510, 518, 527, 529, 573]);       // add to hand, summon, Set, equip, place, "your card"
const COSTS = new Set([500, 501, 511, 512, 513, 519, 531, 533, 578]);    // Tribute, discard, materials, detach

/** Rough worth of a card: monsters by ATK (or Level), Spells/Traps a flat amount. */
function worth(cards: Map<number, EngineCard>, code: number, onField?: [number, number, number | null, number | null, ...unknown[]] | null): number {
  if (onField && onField[2] !== null) return Math.max(onField[2] as number, (onField[3] as number | null) ?? 0);
  const c = cards.get(code);
  if (!c) return 1000;
  if (c.type & (OcgType.SPELL | OcgType.TRAP)) return 1200;
  return Math.max(c.attack, c.defense, c.level * 300);
}
const fieldCard = (v: BotView, c: any) => (c.location === OcgLocation.MZONE ? v.board[c.controller as Side]?.m[c.sequence] : c.location === OcgLocation.SZONE ? v.board[c.controller as Side]?.s[c.sequence] : null) ?? null;

/** Can a monster with this ATK beat that monster in battle (destroy it and survive or trade evenly)? */
function beats(atk: number, target: [number, number, number | null, number | null, ...unknown[]] | null): boolean {
  if (!target) return false;
  if (target[1] & FACEDOWN) return atk >= 1600;   // unknown: only with a decent attacker
  return target[1] & DEFENSE ? atk > (target[3] ?? 0) : atk > (target[2] ?? 0);
}

function smart(m: any, r: Rng, s: BotState, cards: Map<number, EngineCard>, v: BotView): any {
  const me = m.player as Side, them = (1 - me) as Side;
  const theirMonsters = v.board[them].m.filter(Boolean) as NonNullable<SideView['m'][number]>[];
  const theirBest = Math.max(0, ...theirMonsters.filter(c => !(c[1] & FACEDOWN)).map(c => (c[2] ?? 0)));
  const myAttackers = (v.board[me].m.filter(Boolean) as NonNullable<SideView['m'][number]>[]).filter(c => !(c[1] & DEFENSE));
  const worthwhileBattle = () => myAttackers.some(c => !theirMonsters.length || theirMonsters.some(t => beats(c[2] ?? 0, t)));
  const hint = Number(v.hint);

  switch (m.type) {
    case M.SELECT_IDLECMD: {
      // weigh every possible action; weaker monsters are Set rather than summoned into a stronger board
      const options: [number, number, number][] = [];   // [action, index, weight]
      const add = (action: number, list: any[], weigh: (c: any) => number) => list.forEach((c, i) => { const w = weigh(c); if (w > 0) options.push([action, i, w]); });
      const atk = (c: any) => cards.get(c.code)?.attack ?? 0;
      add(SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, m.special_summons, () => 5);
      add(SelectIdleCMDAction.SELECT_ACTIVATE, m.activates, () => 4);
      add(SelectIdleCMDAction.SELECT_SUMMON, m.summons, c => (atk(c) >= theirBest || atk(c) >= 1800 ? 4 : 1.5));
      add(SelectIdleCMDAction.SELECT_MONSTER_SET, m.monster_sets, c => (atk(c) < theirBest && atk(c) < 1800 ? 3 : 0.3));
      add(SelectIdleCMDAction.SELECT_SPELL_SET, m.spell_sets, c => ((cards.get(c.code)?.type ?? 0) & OcgType.TRAP ? 2.5 : (cards.get(c.code)?.type ?? 0) & OcgType.QUICKPLAY ? 1 : 0.2));
      if (options.length && s.acts < 25) {
        s.acts++;
        let w = r() * options.reduce((a, o) => a + o[2], 0);
        const [action, index] = options.find(o => (w -= o[2]) < 0) ?? options[0];
        return { type: R.SELECT_IDLECMD, action, index };
      }
      // only go to battle when an attack is worth making
      if (m.to_bp && worthwhileBattle()) return { type: R.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
      return { type: R.SELECT_IDLECMD, action: m.to_ep ? SelectIdleCMDAction.TO_EP : SelectIdleCMDAction.TO_BP, index: null };
    }
    case M.SELECT_BATTLECMD: {
      if (m.chains.length && r() < 0.25) return { type: R.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index: Math.floor(r() * m.chains.length) };
      // the strongest attacker that can either attack directly or beat something
      let best = -1, bestAtk = -1;
      (m.attacks as any[]).forEach((a, i) => {
        const atk = (fieldCard(v, a)?.[2] as number | null) ?? 0;
        const useful = (a.can_direct && !theirMonsters.length) || theirMonsters.some(t => beats(atk, t));
        if (useful && atk > bestAtk) { best = i; bestAtk = atk; }
      });
      if (best >= 0 && s.attacks < 8) { s.attacks++; s.attackerAtk = bestAtk; return { type: R.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: best }; }
      return { type: R.SELECT_BATTLECMD, action: m.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP, index: null };
    }
    case M.SELECT_CHAIN: {
      if (!m.selects.length) return { type: R.SELECT_CHAIN, index: null };
      if (m.forced) return { type: R.SELECT_CHAIN, index: 0 };
      const top = v.chain.at(-1);
      // triggers (listed first, spe_count of them) are worth using; otherwise answer the opponent, not ourselves
      if (m.spe_count > 0 && r() < 0.9) return { type: R.SELECT_CHAIN, index: Math.floor(r() * Math.min(m.spe_count, m.selects.length)) };
      const chance = !top ? 0.2 : top.p === them ? 0.8 : 0.05;
      return { type: R.SELECT_CHAIN, index: r() < chance ? Math.floor(r() * m.selects.length) : null };
    }
    case M.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: r() < 0.92 };
    case M.SELECT_CARD: case M.SELECT_TRIBUTE: {
      const list = m.selects as any[];
      const value = (c: any) => worth(cards, c.code, fieldCard(v, c));
      const idx = list.map((_, i) => i);
      let order: number[], count: number;
      if (m.type === M.SELECT_CARD && hint === 549) {
        // attack target: the most valuable monster this attacker beats, else the weakest one
        const atk = s.attackerAtk ?? 0;
        const beatable = idx.filter(i => beats(atk, fieldCard(v, list[i])));
        order = beatable.length ? beatable.sort((a, b) => value(list[b]) - value(list[a])) : idx.sort((a, b) => value(list[a]) - value(list[b]));
        count = 1;
      } else if (m.type === M.SELECT_TRIBUTE || COSTS.has(hint)) {
        order = idx.sort((a, b) => value(list[a]) - value(list[b]));                      // pay with the least useful cards
        count = Math.max(m.min, 1);
      } else {
        const theirs = (i: number) => list[i].controller !== me;
        const harmful = HARMFUL.has(hint) || (!HELPFUL.has(hint) && idx.some(theirs) && idx.some(i => !theirs(i)));
        order = idx.sort((a, b) => (harmful ? Number(theirs(b)) - Number(theirs(a)) : Number(theirs(a)) - Number(theirs(b))) || value(list[b]) - value(list[a]));
        count = harmful ? m.max : Math.max(m.min, 1);
      }
      if (m.type === M.SELECT_TRIBUTE) {
        // enough Tributes (some monsters count as two)
        const picked: number[] = []; let total = 0;
        for (const i of order) { if (total >= m.min) break; picked.push(i); total += list[i].release_param || 1; }
        return { type: R.SELECT_TRIBUTE, indicies: picked.sort((a, b) => a - b) };
      }
      return { type: R.SELECT_CARD, indicies: order.slice(0, Math.min(Math.max(count, m.min), m.max, list.length)).sort((a, b) => a - b) };
    }
    // SELECT_UNSELECT_CARD (one card at a time, e.g. materials) stays with the random bot: ordering those picks
    // by worth measured slightly worse over 1,000 duels
    case M.SELECT_POSITION: {
      const c = cards.get(m.code);
      const attack = !c || c.attack >= c.defense || c.attack >= Math.max(1600, theirBest);
      const pref = attack ? [OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE] : [OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEUP_ATTACK];
      const position = pref.find(p => m.positions & p);
      return position ? { type: R.SELECT_POSITION, position } : undefined;
    }
  }
  return undefined;   // everything else: the random bot's answer is fine
}
