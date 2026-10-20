// Messages between the duel server and the browser. Both sides import this file.

export type Side = 0 | 1;

/** A card on the field: [code, position flags, ATK, DEF, Xyz materials, card type, flags, counters]. Code 0 = hidden from this viewer. */
export type FieldCard = [code: number, position: number, atk: number | null, def: number | null, materials: number, type: number, flags: number, counters: number];
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
  /** Monsters summoned in this step, for the summon effect. */
  summons: { zone: ZoneRef; code: number; kind: SummonKind }[];
  /** Cards that left the field in this step, for the exit effect. Code 0 when the card was never revealed. */
  leaves: { zone: ZoneRef; code: number; to: LeaveTo }[];
  /** The chain link resolving right now (1 = the first link), or null. */
  solving: number | null;
  board: [SideView, SideView];
}

export type SummonKind = 'normal' | 'tribute' | 'flip' | 'special' | 'ritual' | 'fusion' | 'synchro' | 'xyz' | 'link';
/** Where a card that left the field went ('material' = it became an Xyz Material). */
export type LeaveTo = 'gy' | 'ban' | 'hand' | 'deck' | 'extra' | 'material';

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
  /** Both sides are people (the other side isn't the bot). */
  people?: boolean;
  /** Joining a timed duel mid-turn (a reload, a reconnect, watching): the turn player's turn time left then, in ms. */
  clock?: { side: Side; turn: number; left: number };
  /** Rejoin key for this seat (players only): sent back with `resume` after a dropped connection or a page reload. */
  seat?: string;
  /** A coin toss decided who goes first (solo against the bot): the side that goes first, from this viewer's point of view
   *  (0 = you). Only sent when the duel starts, so a page reload doesn't toss again. */
  coin?: { first: Side };
}

/** How long a coin toss holds back the start of a duel: the coin lands and the result shows before the first move. */
export const COIN_TOSS_MS = 3000;

/** When to ask you to respond: 'smart' skips moments after your own actions (your triggers are still offered). */
export type Responses = 'smart' | 'always';

// ---------- accounts ----------
/** What a player has chosen in Settings (saved to their account). */
export interface UserSettings {
  theme?: 'a' | 'b' | 'c' | 'd';
  /** The card whose artwork fills the Home screen's Duel tile. */
  artwork?: number;
  responses?: Responses;
  speed?: Speed;
  timer?: number;
  /** The light, mist and particles behind every screen: on (default) or off for slower laptops. */
  effects?: boolean;
  /** Volume, 0-100. */
  sound?: number;
}
/** The logged-in account. `username` is null until chosen (accounts made on DeckForge start without one). */
/** `terms`: has agreed to the current Terms (and confirmed being 13 or older). */
export interface Me { id: string; email: string; username: string | null; verified: boolean; settings: UserSettings; nextNameChange: string | null; terms: boolean }

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

/** A deck to duel with: ours and tournament decks on the server, plus (logged in) your own, whose ids start "acct:". */
export interface DeckSummary {
  id: string; name: string; main: number; extra: number; source: 'mine' | 'tournament' | 'account';
  /** Your decks only: legal in its format, and (even if not) able to be played at all (right size, known cards). */
  legal?: boolean; playable?: boolean;
}

export type ServerMessage =
  /** `scenarios`: test set-ups, only offered by a development server. */
  | { type: 'decks'; decks: DeckSummary[]; scenarios?: { id: string; name: string }[]; /** your "Dueling with" deck */ active?: string | null }
  | { type: 'duel'; duel: DuelInfo }
  | { type: 'frame'; frame: Frame }
  /** Your turn to choose (null: nothing to answer right now). */
  | { type: 'prompt'; prompt: Prompt | null }
  /** Duels between people: the duel is waiting on this player to choose (null = on nobody), and their clock as it was when sent. */
  | { type: 'waiting'; side: Side | null; time?: { left: number; turn: boolean } }
  /** After rejoining: the duel log so far. */
  | { type: 'backlog'; lines: { step: number; turn: number; text: string }[] }
  /** The duel you asked to rejoin has ended or doesn't exist any more. */
  | { type: 'gone' }
  /** Cards the engine shows you (e.g. Galaxy Hundred lets you look at the opponent's Extra Deck). `brief`: just a glimpse, it closes itself. */
  | { type: 'reveal'; title: string; cards: number[]; brief: boolean }
  | { type: 'end'; winner: Side | 2 | null; reason: string; turns: number }
  | { type: 'error'; message: string }
  // ----- private rooms -----
  /** Your room as it is now (null: you're not in one). */
  | { type: 'room'; room: RoomView | null }
  /** What a room code leads to, before joining (null: no such room). */
  | { type: 'room.preview'; preview: RoomPreview | null; code: string }
  /** You're no longer in the room: it closed, you were removed, or a watch request was declined. */
  | { type: 'room.closed'; reason: string }
  /** Unranked search: whether you're searching, since when (ms since epoch), and how many players are online now. */
  | { type: 'queue'; searching: boolean; since: number | null; online: number }
  /** New chat lines (all of them after joining or rejoining). */
  | { type: 'chat'; lines: ChatLine[]; reset?: boolean };

export type ClientMessage =
  | { type: 'listDecks' }
  /** Milestone 1: two bots duel and this connection watches. */
  | { type: 'watch'; decks: [string, string]; fullView?: boolean; seed?: number; speed?: Speed }
  /** Milestone 2: duel the bot. */
  | { type: 'play'; deck: string; botDeck: string; first: 'me' | 'bot' | 'random'; name?: string; seed?: number; speed?: Speed; timer?: number; responses?: Responses; scenario?: string }
  /** Rejoin a duel in progress with the seat key from DuelInfo. */
  | { type: 'resume'; duel: string; seat: string }
  | { type: 'answer'; id: number; answer: PromptAnswer }
  /** Give up the duel against the bot (it counts as a loss). */
  | { type: 'surrender' }
  | { type: 'leave' }
  // ----- private rooms (logged in only); decks are your own decks' ids (without "acct:") -----
  | { type: 'room.create'; rules: RoomRules; password?: string; deck: string }
  | { type: 'room.peek'; code: string }
  | { type: 'room.join'; code: string; password?: string; deck: string }
  /** Ask to watch a room's duels (both duelists must accept). */
  | { type: 'room.watch'; code: string; password?: string }
  /** Back into your room after a reload or a dropped connection. */
  | { type: 'room.resume' }
  | { type: 'room.deck'; deck: string }
  | { type: 'room.ready'; ready: boolean }
  /** Host: both duelists are ready, toss the coin. */
  | { type: 'room.start' }
  /** Whoever won the toss (or lost the last game) picks. */
  | { type: 'room.choose'; first: boolean }
  /** Best of 3: your deck after side decking between games. */
  | { type: 'room.side'; main: number[]; extra: number[]; side: number[] }
  /** Duelists: answer a watch request, or remove a spectator. */
  | { type: 'room.request'; id: string; accept: boolean }
  | { type: 'room.kick'; id: string }
  /** Give up the current game (the match goes on in a best of 3). */
  | { type: 'room.surrender' }
  /** Host, after a match: back to the room for another. */
  | { type: 'room.again' }
  | { type: 'room.leave' }
  /** Unranked: look for an opponent with this deck (one of yours, or a borrowed tournament deck), or stop looking. */
  | { type: 'queue.join'; deck: string }
  | { type: 'queue.leave' }
  | { type: 'chat'; text: string };

// ---------- private rooms ----------
export interface RoomRules {
  /** Best of 1 or 3 (side decking between games). */
  bo: 1 | 3;
  /** Seconds per turn, 0 = no timer. */
  timer: 0 | 60 | 90 | 180;
  banlist: 'TCG' | 'OCG' | 'none';
  lp: 4000 | 8000 | 16000;
  /** Decks must be legal for the banlist (off lets friends test anything). */
  check: boolean;
  spectators: 'ask' | 'off';
}
export const DEFAULT_RULES: RoomRules = { bo: 1, timer: 90, banlist: 'TCG', lp: 8000, check: true, spectators: 'ask' };
/** Unranked matches: quick and standard (his call, 2026-10-20). */
/** The chat's quick replies (the only chat when Unranked is switched to quick replies only). */
export const QUICK_REPLIES = ['GG', 'Good luck!', 'Nice play', 'Thinking…'];
export const UNRANKED_RULES: RoomRules = { bo: 1, timer: 90, banlist: 'TCG', lp: 8000, check: true, spectators: 'off' };

export type RoomRole = 'host' | 'guest';
export interface RoomPlayer {
  name: string; role: RoomRole; you: boolean; ready: boolean; connected: boolean; wins: number;
  /** Your own deck's name and cover; for the opponent only whether they've picked one. */
  deck: { name: string; cover: number | null } | null; hasDeck: boolean;
}
export type RoomPhase = 'lobby' | 'toss' | 'choose' | 'dueling' | 'siding' | 'over';
export interface RoomView {
  /** A private room (friends, a code) or an unranked match the server paired up (fixed rules, no lobby). */
  kind: 'private' | 'unranked';
  /** Chat is quick replies only (Unranked, while the owner has switched free text off). */
  quickOnly?: boolean;
  code: string; you: RoomRole | 'spectator' | 'asking';
  rules: RoomRules; password: boolean;
  /** Host first; the guest's place is null until someone joins. */
  players: [RoomPlayer, RoomPlayer | null];
  phase: RoomPhase;
  /** The game being played (or just played), from 1. */
  game: number;
  /** Who picks going first or second (after the toss, or the loser of the last game). */
  chooser: RoomRole | null;
  /** Who won the coin toss (game 1). */
  toss: RoomRole | null;
  /** The game that just ended. */
  last: { winner: RoomRole | null; reason: string } | null;
  /** The match is over: who won it. */
  winner: RoomRole | null;
  spectators: { id: string; name: string }[];
  /** Duelists only: people asking to watch, and whether you've said yes. */
  requests: { id: string; name: string; accepted: boolean }[];
  /** Side decking (best of 3, between games): your deck right now and the Side Deck size to keep. */
  siding: { main: number[]; extra: number[]; side: number[]; done: boolean } | null;
}
export interface RoomPreview {
  host: string; rules: RoomRules; password: boolean;
  /** open: there's room for you; full / dueling: you can only ask to watch (if spectators are allowed). */
  state: 'open' | 'full' | 'dueling';
}
export interface ChatLine { from: string; role: RoomRole | 'spectator' | 'system'; text: string; at: number }

/** Compact card data the browser needs for names, text and stats (GET <base>/api/cards). */
export type CardRow = [
  code: number, name: string, alias: number, frame: string, typeLine: string, attribute: string,
  level: number, atk: number, def: number, text: string,
  /** Where it's released: 0x1 OCG, 0x2 TCG, 0x100 not out yet. */
  ot: number,
  /** A brand-new card listed under its official number: the temporary number duels use for it. */
  engine?: number,
];

/** A device that skips the login code (from POST /api/account/devices). */
export interface TrustedDevice { id: string; label: string; created_at: string; expires_at: string; current: boolean }

// ---------- profiles and match history ----------
export type MatchResult = 'win' | 'loss' | 'draw';
export type MatchKind = 'private' | 'unranked' | 'bot';
export interface RecordStats {
  duels: number; wins: number; losses: number; draws: number;
  /** The run you're on now (most recent results first). */
  streak: { result: MatchResult; length: number } | null;
  bestWinStreak: number;
  /** The last 10 results, newest first. */
  form: MatchResult[];
}
export interface HistoryRow {
  id: number; kind: MatchKind; bo: number; opponent: string; deck: string; cover: number | null; result: MatchResult;
  scoreFor: number; scoreAgainst: number; games: number; turns: number; reason: string; startedAt: string; endedAt: string;
}
export interface DeckRecord { name: string; cover: number | null; duels: number; wins: number; losses: number }
/** A profile: anyone logged in can see the record; the rest (history, decks, cards) only its owner. */
export interface Profile {
  name: string; memberSince: string; artwork: number | null; you: boolean;
  stats: Record<'all' | MatchKind, RecordStats>;
  decks?: Record<'all' | MatchKind, DeckRecord[]>;
  history?: HistoryRow[];
  /** Cards you summon, activate or Set most, most first. */
  mostPlayed?: number[];
}
