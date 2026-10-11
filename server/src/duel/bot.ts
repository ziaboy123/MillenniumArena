// A simple bot that answers every prompt the engine sends. It plays legally and keeps duels moving, but it
// isn't smart: it picks summons/activations/attacks at random with a few sensible preferences.
import {
  OcgLocation, OcgMessageType as M, OcgPosition, OcgResponseType as R, SelectBattleCMDAction, SelectIdleCMDAction, cardMatchesOpcode,
} from 'ocgcore-wasm';
import type { EngineCard } from '../cards.ts';

export type Rng = () => number;
export interface BotState { acts: number; attacks: number }

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
export function decide(m: any, r: Rng, s: BotState, tries: number, cards: Map<number, EngineCard>): any {
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
      const fit = [...cards.values()].filter(c => cardMatchesOpcode(c as any, m.opcodes));
      return { type: R.ANNOUNCE_CARD, card: fit.length ? fit[Math.floor(r() * fit.length)].code : 46986414 };
    }
    case M.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: tries ? Number(m.options[0]) : Math.floor(r() * m.options.length) };
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
