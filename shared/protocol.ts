// Messages between the duel server and the browser. Both sides import this file.

export type Side = 0 | 1;

/** A card on the field: [code, position flags, ATK, DEF, Xyz materials, card type, flags]. Code 0 = hidden from this viewer. */
export type FieldCard = [code: number, position: number, atk: number | null, def: number | null, materials: number, type: number, flags: number];
/** FieldCard flags: its effects are negated. */
export const NEGATED = 1;

export interface SideView {
  lp: number;
  /** Card codes; 0 = a card this viewer can't see. */
  hand: number[];
  /** Monster zones 0-6 (5 and 6 are the Extra Monster Zones). */
  m: (FieldCard | null)[];
  /** Spell/Trap zones 0-4, 5 = Field Spell, 6-7 = Pendulum. */
  s: (FieldCard | null)[];
  gy: number[];
  /** [code, position]; face-down banished cards have code 0 for viewers who can't see them. */
  ban: [number, number][];
  deck: number;
  extra: number;
  /** Deck contents, top card first. Only sent when this viewer may see them (replays/spectating with full view). */
  dk?: number[];
  /** Extra Deck as [code, position]; face-down cards are 0 unless this viewer owns them. */
  ex?: [number, number][];
}

export interface ZoneRef { p: Side; loc: 'm' | 's' | 'hand' | 'other'; seq: number }

export type Phase = 'DP' | 'SP' | 'M1' | 'BP' | 'M2' | 'EP';

/** One visible step of the duel: what happened (lines) and the board afterwards. */
export interface Frame {
  step: number;
  turn: number;
  turnPlayer: Side;
  phase: Phase;
  lines: string[];
  attack: { from: ZoneRef; to: ZoneRef | null } | null;
  chain: (ZoneRef & { code: number })[];
  damage: { p: Side; amount: number; cost?: boolean }[];
  highlight: ZoneRef[];
  /** Columns whose cards are negated for the rest of the turn (e.g. a Set Infinite Impermanence), named by player p's Spell/Trap zone `seq`. */
  columns: { p: Side; seq: number }[];
  board: [SideView, SideView];
}

export interface DuelInfo {
  id: string;
  /** Names and decks from this viewer's point of view: a player is always side 0 (the bottom of the screen). */
  players: [string, string];
  decks: [string, string];
  /** 0 when this connection plays, null when watching. */
  you: Side | null;
  /** Watching with every card visible (bot-vs-bot testing). */
  fullView: boolean;
  engine: string;
  /** Seconds each player gets per turn (0 = no timer). */
  timer: number;
}

/** How fast the bot's moves play out. */
export type Speed = 'slow' | 'normal' | 'fast' | 'instant';

// ---------- prompts: the engine asking a player to choose ----------
// Sides in prompts are relative to the player being asked: 0 = you, 1 = your opponent.

export type Loc = 'hand' | 'm' | 's' | 'gy' | 'ban' | 'deck' | 'extra';

/** A card offered in a prompt. Code 0 = a card you can't see. `mat` = it's an Xyz Material of the monster at m/seq. */
export interface PromptCard { code: number; p: Side; loc: Loc; seq: number; pos: number; mat?: boolean; desc?: string }

export type IdleAct = 'summon' | 'spsummon' | 'repos' | 'mset' | 'sset' | 'activate';
/** One thing you can do with a card right now: `index` is its position in the engine's list for that kind of action. */
export interface PromptAction { act: IdleAct | 'attack'; index: number; card: PromptCard; label: string }

/** `time`: milliseconds left to answer when it was sent; `turn` = it comes out of your turn's time (else it's a response limit). */
export type Prompt = { id: number; title: string; retry?: boolean; time?: { left: number; turn: boolean } } & (
  /** Main Phase: use a card, or move on. */
  | { kind: 'idle'; actions: PromptAction[]; toBP: boolean; toEP: boolean }
  /** Battle Phase: attack, use a card, or move on. */
  | { kind: 'battle'; actions: PromptAction[]; toM2: boolean; toEP: boolean }
  /** Respond with one of these cards (or pass, unless forced). */
  | { kind: 'chain'; cards: PromptCard[]; forced: boolean }
  | { kind: 'yesno'; text: string; card?: PromptCard }
  | { kind: 'option'; options: string[]; code?: number }
  /** Choose min..max cards. `weights` (Tributes): how many Tributes each card counts as. */
  | { kind: 'cards'; cards: PromptCard[]; min: number; max: number; canCancel: boolean; weights?: number[] }
  /** Choose cards one at a time: `picked` are already chosen (click again to take back). */
  | { kind: 'unselect'; cards: PromptCard[]; picked: PromptCard[]; min: number; max: number; canFinish: boolean; canCancel: boolean }
  /** Choose `count` of these free zones. */
  | { kind: 'place'; count: number; zones: ZoneRef[] }
  | { kind: 'position'; code: number; positions: number[] }
  /**
   * Choose cards whose values (usually Levels) add up to `target`: exactly, or (`exact` false, Ritual style) at
   * least the target with no card to spare. A card may offer two values. `must` cards are already included.
   */
  | { kind: 'sum'; cards: SumCard[]; must: SumCard[]; target: number; exact: boolean; min: number; max: number }
  /** Remove `count` counters in total from these cards (`has` = how many each holds). */
  | { kind: 'counters'; counter: string; count: number; cards: (PromptCard & { has: number })[] }
  /** Put these cards in order: the first is placed on top (or resolves first, for a chain). */
  | { kind: 'sort'; cards: PromptCard[]; chain: boolean }
  /** Declare `count` Types or Attributes from the options. */
  | { kind: 'declare'; what: 'type' | 'attribute'; count: number; options: { bit: number; label: string }[] }
  /** Declare a card name: `codes` are every card that may be declared. */
  | { kind: 'cardname'; codes: number[] }
  | { kind: 'number'; options: number[] }
  /** Rock, paper, scissors (1 scissors, 2 rock, 3 paper, as the engine counts them). */
  | { kind: 'rps' }
);
export type SumCard = PromptCard & { values: number[] };

/** Do these cards' values reach the target the way the engine requires? Each card counts as one of its values. */
export function sumIsValid(cards: number[][], target: number, exact: boolean): boolean {
  if (!cards.length) return false;
  if (!exact) {
    // at least the target, and dropping any one card would fall short (no spare card)
    const low = cards.map(v => Math.min(...v)), high = cards.map(v => Math.max(...v));
    const sum = low.reduce((a, b) => a + b, 0);
    return high.reduce((a, b) => a + b, 0) >= target && sum - Math.min(...low) < target;
  }
  const reach = (i: number, left: number): boolean => (i === cards.length ? left === 0 : cards[i].some(v => v > 0 && v <= left && reach(i + 1, left - v)));
  return reach(0, target);
}
export type PromptKind = Prompt['kind'];

export type PromptAnswer =
  | { kind: 'idle'; act: IdleAct | 'bp' | 'ep'; index?: number }
  | { kind: 'battle'; act: 'attack' | 'activate' | 'm2' | 'ep'; index?: number }
  | { kind: 'chain'; index: number | null }
  | { kind: 'yesno'; yes: boolean }
  | { kind: 'option'; index: number }
  | { kind: 'cards'; indices: number[] | null }
  /** index into cards, then picked (cards.length + i); null = finish (or cancel) */
  | { kind: 'unselect'; index: number | null }
  | { kind: 'place'; zones: ZoneRef[] }
  | { kind: 'position'; position: number }
  | { kind: 'sum'; indices: number[] }
  /** counters removed from each card, in the prompt's order */
  | { kind: 'counters'; counts: number[] }
  /** order[i] = the place given to cards[i] (0 = first); null keeps the current order */
  | { kind: 'sort'; order: number[] | null }
  | { kind: 'declare'; bits: number[] }
  | { kind: 'cardname'; code: number }
  | { kind: 'number'; index: number }
  | { kind: 'rps'; hand: 1 | 2 | 3 };

export interface DeckSummary { id: string; name: string; main: number; extra: number; source: 'mine' | 'tournament' }

export type ServerMessage =
  /** `scenarios`: test set-ups, only offered by a development server. */
  | { type: 'decks'; decks: DeckSummary[]; scenarios?: { id: string; name: string }[] }
  | { type: 'duel'; duel: DuelInfo }
  | { type: 'frame'; frame: Frame }
  /** Your turn to choose (null: nothing to answer right now). */
  | { type: 'prompt'; prompt: Prompt | null }
  /** Cards the engine shows you (e.g. Galaxy Hundred lets you look at the opponent's Extra Deck). `brief`: just a glimpse, it closes itself. */
  | { type: 'reveal'; title: string; cards: number[]; brief: boolean }
  | { type: 'end'; winner: Side | 2 | null; reason: string; turns: number }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'listDecks' }
  /** Milestone 1: two bots duel and this connection watches. */
  | { type: 'watch'; decks: [string, string]; fullView?: boolean; seed?: number; speed?: Speed }
  /** Milestone 2: duel the bot. */
  | { type: 'play'; deck: string; botDeck: string; first: 'me' | 'bot' | 'random'; name?: string; seed?: number; speed?: Speed; timer?: number; scenario?: string }
  | { type: 'answer'; id: number; answer: PromptAnswer }
  | { type: 'leave' };

/** Compact card data the browser needs for names, text and stats (GET <base>/api/cards). */
export type CardRow = [
  code: number, name: string, alias: number, frame: string, typeLine: string, attribute: string,
  level: number, atk: number, def: number, text: string,
];
