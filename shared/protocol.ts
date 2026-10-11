// Messages between the duel server and the browser. Both sides import this file.

export type Side = 0 | 1;

/** A card on the field: [code, position flags, ATK, DEF, Xyz materials, card type]. Code 0 = hidden from this viewer. */
export type FieldCard = [code: number, position: number, atk: number | null, def: number | null, materials: number, type: number];

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
  board: [SideView, SideView];
}

export interface DuelInfo {
  id: string;
  players: [string, string];
  decks: [string, string];
  /** Which side this connection plays, or null when watching. */
  you: Side | null;
  /** Watching with every card visible (bot-vs-bot testing). */
  fullView: boolean;
  engine: string;
}

export interface DeckSummary { id: string; name: string; main: number; extra: number; source: 'mine' | 'tournament' }

export type ServerMessage =
  | { type: 'decks'; decks: DeckSummary[] }
  | { type: 'duel'; duel: DuelInfo }
  | { type: 'frame'; frame: Frame }
  | { type: 'end'; winner: Side | 2 | null; reason: string; turns: number }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'listDecks' }
  /** Milestone 1: two bots duel and this connection watches. */
  | { type: 'watch'; decks: [string, string]; fullView?: boolean; seed?: number }
  | { type: 'leave' };

/** Compact card data the browser needs for names, text and stats (GET <base>/api/cards). */
export type CardRow = [
  code: number, name: string, alias: number, frame: string, typeLine: string, attribute: string,
  level: number, atk: number, def: number, text: string,
];
