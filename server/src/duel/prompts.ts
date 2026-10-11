// Turns the engine's prompts into what the duel screen shows, and a player's answers back into engine
// responses. Answers are checked here first, so a mistaken (or tampered) answer never reaches the engine.
// Sides in prompts are relative to the player being asked: 0 = them, 1 = their opponent.
import {
  OcgLocation as L, OcgMessageType as M, OcgPosition as P, OcgResponseType as R, OcgType as T,
  SelectBattleCMDAction as B, SelectIdleCMDAction as I,
} from 'ocgcore-wasm';
import type { IdleAct, Loc, Prompt, PromptAction, PromptAnswer, PromptCard, Side, SideView, ZoneRef } from '@arena/shared';
import type { EngineCard } from '../cards.ts';
import { sysString } from '../strings.ts';

export interface PromptContext {
  cards: Map<number, EngineCard>;
  /** The board as the engine sees it (absolute sides). */
  board: [SideView, SideView];
  /** The engine's latest "select ..." hint for this player (0n = none). */
  hint: bigint;
  /** The newest card on the chain (0 = no chain). */
  chainTop: number;
  /** The card this player last chose to use, for titles like 'Choose a zone for "X"'. */
  lastCard: number;
}

const FACEDOWN = 0xa;
const LOCS: Record<number, Loc> = { [L.HAND]: 'hand', [L.MZONE]: 'm', [L.SZONE]: 's', [L.GRAVE]: 'gy', [L.REMOVED]: 'ban', [L.DECK]: 'deck', [L.EXTRA]: 'extra' };
const LOC_NAMES: Record<number, string> = { [L.HAND]: 'Hand', [L.MZONE]: 'Monster Zone', [L.SZONE]: 'Spell & Trap Zone', [L.GRAVE]: 'GY', [L.REMOVED]: 'Banished', [L.DECK]: 'Deck', [L.EXTRA]: 'Extra Deck' };

/** Fill in the engine's %ls / %d placeholders in order. */
function fmt(text: string, ...args: (string | number)[]) {
  let i = 0;
  return text.replace(/%ls|%d|%s/g, () => String(args[i++] ?? ''));
}

/** Engine description numbers: below 10000 a system string, otherwise card code << 20 | which of the card's strings. */
export function describe(cards: Map<number, EngineCard>, desc: bigint | number | undefined, ...args: (string | number)[]): string {
  const d = BigInt(desc ?? 0);
  if (d <= 0n) return '';
  const text = d < 10000n ? sysString(Number(d)) : cards.get(Number(d >> 20n))?.strings[Number(d & 0xfffffn)] ?? '';
  return fmt(text, ...args).trim();
}

const nameOf = (ctx: PromptContext, code: number) => ctx.cards.get(code)?.name ?? 'this card';

/** A card in a prompt, hidden (code 0) when the player being asked isn't allowed to see it. */
function card(ctx: PromptContext, c: any, player: Side, desc?: string): PromptCard {
  const p: Side = c.controller === player ? 0 : 1;
  const loc = LOCS[c.location] ?? 'gy';
  const mat = c.overlay_sequence !== undefined;
  let pos = c.position ?? 0;
  if (!pos && (loc === 'm' || loc === 's')) pos = ctx.board[c.controller as Side][loc][c.sequence]?.[1] ?? 0;
  const hidden = p === 1 && !mat && (loc === 'hand' || loc === 'deck' || ((pos & FACEDOWN) !== 0 && loc !== 'gy'));
  return { code: hidden ? 0 : c.code, p, loc, seq: c.sequence, pos, ...(mat ? { mat } : {}), ...(desc ? { desc } : {}) };
}

/**
 * Deck order is secret, so cards offered from a Deck are listed by name (after any others), and their place in
 * the Deck is replaced by their place in that list. The order is kept on the message so answers map back.
 */
function offered(ctx: PromptContext, m: any, key: 'selects' | 'select_cards' | 'unselect_cards', player: Side): PromptCard[] {
  const list: any[] = m[key];
  const order = list.map((_, i) => i);
  const fromDeck = (c: any) => (c.location === L.DECK ? 1 : 0), name = (c: any) => ctx.cards.get(c.code)?.name ?? '';
  if (list.some(fromDeck)) order.sort((a, b) => fromDeck(list[a]) - fromDeck(list[b]) || (fromDeck(list[a]) ? name(list[a]).localeCompare(name(list[b])) : a - b));
  (m.order ??= {})[key] = order;
  return order.map((i, shown) => { const c = card(ctx, list[i], player); return c.loc === 'deck' ? { ...c, seq: shown } : c; });
}
/** The engine's index for the card shown at `i` (see `offered`). */
const engineIndex = (m: any, key: string, i: number) => m.order?.[key]?.[i] ?? i;

/** Free zones from a SELECT_PLACE mask (a set bit = can't use): own monster zones bits 0-6, own spell/trap 8-13, opponent +16. */
function freeZones(mask: number): ZoneRef[] {
  const zones: ZoneRef[] = [];
  for (let bit = 0; bit < 32; bit++) {
    const b = bit % 16, monster = b < 8, seq = b % 8;
    if ((monster && seq > 6) || (!monster && seq > 5) || ((mask >>> bit) & 1)) continue;
    zones.push({ p: bit < 16 ? 0 : 1, loc: monster ? 'm' : 's', seq });
  }
  return zones;
}

const IDLE_LISTS: [IdleAct, string, number][] = [
  ['summon', 'summons', I.SELECT_SUMMON], ['spsummon', 'special_summons', I.SELECT_SPECIAL_SUMMON], ['repos', 'pos_changes', I.SELECT_POS_CHANGE],
  ['mset', 'monster_sets', I.SELECT_MONSTER_SET], ['sset', 'spell_sets', I.SELECT_SPELL_SET], ['activate', 'activates', I.SELECT_ACTIVATE],
];

function idleLabel(ctx: PromptContext, act: IdleAct, c: any): string {
  const info = ctx.cards.get(c.code);
  switch (act) {
    case 'summon': return 'Normal Summon';
    case 'spsummon': {
      if (c.location !== L.EXTRA || !info) return 'Special Summon';
      return info.type & T.XYZ ? 'Xyz Summon' : info.type & T.SYNCHRO ? 'Synchro Summon' : info.type & T.LINK ? 'Link Summon' : 'Special Summon';
    }
    case 'repos': {
      const pos = ctx.board[c.controller as Side].m[c.sequence]?.[1] ?? 0;
      return pos & FACEDOWN ? 'Flip Summon' : pos & P.FACEUP_ATTACK ? 'Change to Defense' : 'Change to Attack';
    }
    case 'mset': case 'sset': return 'Set';
    case 'activate': return describe(ctx.cards, c.description, info?.name ?? '') || 'Activate';
  }
}

/** The prompt to show for an engine message, or null for kinds the duel screen doesn't handle yet. */
export function toPrompt(m: any, ctx: PromptContext): Prompt | null {
  const player = m.player as Side;
  const hinted = (fallback: string) => describe(ctx.cards, ctx.hint, nameOf(ctx, ctx.lastCard)) || fallback;
  const base = { id: 0 };
  switch (m.type) {
    case M.SELECT_IDLECMD: {
      const actions: PromptAction[] = IDLE_LISTS.flatMap(([act, list]) =>
        (m[list] as any[]).map((c, index) => ({ act, index, card: card(ctx, c, player), label: idleLabel(ctx, act, c) })));
      return { ...base, kind: 'idle', title: 'Your move', actions, toBP: m.to_bp, toEP: m.to_ep };
    }
    case M.SELECT_BATTLECMD: {
      const theirMonsters = ctx.board[(1 - player) as Side].m.some(Boolean);
      const actions: PromptAction[] = [
        ...(m.attacks as any[]).map((c, index) => ({ act: 'attack' as const, index, card: card(ctx, c, player), label: c.can_direct && !theirMonsters ? 'Attack directly' : 'Attack' })),
        ...(m.chains as any[]).map((c, index) => ({ act: 'activate' as const, index, card: card(ctx, c, player), label: idleLabel(ctx, 'activate', c) })),
      ];
      return { ...base, kind: 'battle', title: 'Battle Phase', actions, toM2: m.to_m2, toEP: m.to_ep };
    }
    case M.SELECT_CHAIN:
      return {
        ...base, kind: 'chain', forced: m.forced,
        title: m.forced ? 'Activate an effect' : ctx.chainTop ? `Respond to ${nameOf(ctx, ctx.chainTop)}?` : sysString(203) || 'Activate a card or effect?',
        cards: (m.selects as any[]).map(c => card(ctx, c, player, describe(ctx.cards, c.description, nameOf(ctx, c.code)))),
      };
    case M.SELECT_EFFECTYN: {
      const name = nameOf(ctx, m.code), where = LOC_NAMES[m.location] ?? '';
      const d = Number(m.description);
      const text = d === 0 ? fmt(sysString(200) || 'Use the effect of "%ls"?', name, where)
        : d === 221 ? fmt(sysString(221), name, where) : describe(ctx.cards, m.description, name);
      return { ...base, kind: 'yesno', title: name, text: text || `Use the effect of "${name}"?`, card: card(ctx, m, player) };
    }
    case M.SELECT_YESNO:
      return { ...base, kind: 'yesno', title: hinted(ctx.chainTop ? nameOf(ctx, ctx.chainTop) : ctx.lastCard ? nameOf(ctx, ctx.lastCard) : 'Your choice'), text: describe(ctx.cards, m.description, nameOf(ctx, ctx.lastCard)) || 'Yes or no?' };
    case M.SELECT_OPTION:
      return { ...base, kind: 'option', title: hinted(sysString(555) || 'Select an option'), options: (m.options as bigint[]).map((o, i) => describe(ctx.cards, o) || `Option ${i + 1}`) };
    case M.SELECT_CARD:
      return { ...base, kind: 'cards', title: hinted(sysString(560) || 'Select'), cards: offered(ctx, m, 'selects', player), min: m.min, max: m.max, canCancel: m.can_cancel };
    case M.SELECT_TRIBUTE:
      return {
        ...base, kind: 'cards', title: hinted(sysString(500) || 'Select the card(s) to Tribute'), cards: offered(ctx, m, 'selects', player),
        min: m.min, max: m.max, canCancel: m.can_cancel, weights: (m.order.selects as number[]).map(i => m.selects[i].release_param || 1),
      };
    case M.SELECT_UNSELECT_CARD:
      return {
        ...base, kind: 'unselect', title: hinted(sysString(560) || 'Select'), cards: offered(ctx, m, 'select_cards', player),
        picked: offered(ctx, m, 'unselect_cards', player), min: m.min, max: m.max, canFinish: m.can_finish, canCancel: m.can_cancel,
      };
    case M.SELECT_PLACE: case M.SELECT_DISFIELD: {
      const fallback = m.type === M.SELECT_DISFIELD ? sysString(570) || 'Choose zone(s) to make unusable'
        : ctx.lastCard ? `Choose a zone for "${nameOf(ctx, ctx.lastCard)}"` : 'Choose a zone';
      return { ...base, kind: 'place', title: hinted(fallback), count: m.count, zones: freeZones(m.field_mask) };
    }
    case M.SELECT_POSITION:
      return { ...base, kind: 'position', title: sysString(561) || 'Select the battle position', code: m.code, positions: [P.FACEUP_ATTACK, P.FACEUP_DEFENSE, P.FACEDOWN_DEFENSE, P.FACEDOWN_ATTACK].filter(p => m.positions & p) };
  }
  return null;
}

const isIndex = (i: unknown, n: number): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n;

/** The engine response for a player's answer, or null if the answer doesn't fit the prompt. */
export function toResponse(m: any, a: PromptAnswer): any | null {
  if (!a || typeof a !== 'object') return null;
  switch (m.type) {
    case M.SELECT_IDLECMD: {
      if (a.kind !== 'idle') return null;
      if (a.act === 'bp') return m.to_bp ? { type: R.SELECT_IDLECMD, action: I.TO_BP, index: null } : null;
      if (a.act === 'ep') return m.to_ep ? { type: R.SELECT_IDLECMD, action: I.TO_EP, index: null } : null;
      const list = IDLE_LISTS.find(([act]) => act === a.act);
      return list && isIndex(a.index, m[list[1]].length) ? { type: R.SELECT_IDLECMD, action: list[2], index: a.index } : null;
    }
    case M.SELECT_BATTLECMD: {
      if (a.kind !== 'battle') return null;
      if (a.act === 'm2') return m.to_m2 ? { type: R.SELECT_BATTLECMD, action: B.TO_M2, index: null } : null;
      if (a.act === 'ep') return m.to_ep ? { type: R.SELECT_BATTLECMD, action: B.TO_EP, index: null } : null;
      if (a.act === 'attack') return isIndex(a.index, m.attacks.length) ? { type: R.SELECT_BATTLECMD, action: B.SELECT_BATTLE, index: a.index } : null;
      if (a.act === 'activate') return isIndex(a.index, m.chains.length) ? { type: R.SELECT_BATTLECMD, action: B.SELECT_CHAIN, index: a.index } : null;
      return null;
    }
    case M.SELECT_CHAIN:
      if (a.kind !== 'chain') return null;
      if (a.index === null) return m.forced ? null : { type: R.SELECT_CHAIN, index: null };
      return isIndex(a.index, m.selects.length) ? { type: R.SELECT_CHAIN, index: a.index } : null;
    case M.SELECT_EFFECTYN: return a.kind === 'yesno' ? { type: R.SELECT_EFFECTYN, yes: !!a.yes } : null;
    case M.SELECT_YESNO: return a.kind === 'yesno' ? { type: R.SELECT_YESNO, yes: !!a.yes } : null;
    case M.SELECT_OPTION: return a.kind === 'option' && isIndex(a.index, m.options.length) ? { type: R.SELECT_OPTION, index: a.index } : null;
    case M.SELECT_CARD: case M.SELECT_TRIBUTE: {
      if (a.kind !== 'cards') return null;
      const type = m.type === M.SELECT_CARD ? R.SELECT_CARD : R.SELECT_TRIBUTE;
      if (a.indices === null) return m.can_cancel ? { type, indicies: null } : null;
      if (!Array.isArray(a.indices) || !a.indices.every(i => isIndex(i, m.selects.length))) return null;
      const picks = a.indices.map(i => engineIndex(m, 'selects', i));
      if (new Set(picks).size !== picks.length) return null;
      if (picks.length > m.max) return null;
      const amount = m.type === M.SELECT_TRIBUTE ? picks.reduce((s, i) => s + (m.selects[i].release_param || 1), 0) : picks.length;
      return amount >= m.min ? { type, indicies: [...picks].sort((x, y) => x - y) } : null;
    }
    case M.SELECT_UNSELECT_CARD:
      if (a.kind !== 'unselect') return null;
      if (a.index === null) return m.can_finish || m.can_cancel ? { type: R.SELECT_UNSELECT_CARD, index: null } : null;
      if (!isIndex(a.index, m.select_cards.length + m.unselect_cards.length)) return null;
      return { type: R.SELECT_UNSELECT_CARD, index: a.index < m.select_cards.length ? engineIndex(m, 'select_cards', a.index) : m.select_cards.length + engineIndex(m, 'unselect_cards', a.index - m.select_cards.length) };
    case M.SELECT_PLACE: case M.SELECT_DISFIELD: {
      if (a.kind !== 'place' || !Array.isArray(a.zones) || a.zones.length !== m.count) return null;
      const free = freeZones(m.field_mask), key = (z: ZoneRef) => `${z.p}${z.loc}${z.seq}`;
      const keys = a.zones.map(key);
      if (new Set(keys).size !== keys.length || !keys.every(k => free.some(z => key(z) === k))) return null;
      return {
        type: m.type === M.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD,
        places: a.zones.map(z => ({ player: z.p === 0 ? m.player : 1 - m.player, location: z.loc === 'm' ? L.MZONE : L.SZONE, sequence: z.seq })),
      };
    }
    case M.SELECT_POSITION:
      return a.kind === 'position' && [1, 2, 4, 8].includes(a.position) && (m.positions & a.position) ? { type: R.SELECT_POSITION, position: a.position } : null;
  }
  return null;
}

/** Names for the prompt kinds the duel screen doesn't handle yet (Milestone 3); the bot answers these for now. */
export const NOT_YET: Record<number, string> = {
  [M.SELECT_SUM]: 'cards adding up to a Level', [M.SELECT_COUNTER]: 'counters to remove', [M.SORT_CARD]: 'card order', [M.SORT_CHAIN]: 'chain order',
  [M.ANNOUNCE_RACE]: 'a Type to declare', [M.ANNOUNCE_ATTRIB]: 'an Attribute to declare', [M.ANNOUNCE_CARD]: 'a card name to declare',
  [M.ANNOUNCE_NUMBER]: 'a number to declare', [M.ROCK_PAPER_SCISSORS]: 'rock, paper, scissors',
};
