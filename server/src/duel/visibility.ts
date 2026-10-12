// What each viewer is allowed to see. Hidden information is removed on the server, so it never reaches a
// browser where it could be read from dev tools. Rules (agreed for live duels):
//   - your own hand and face-down cards are yours; the opponent's show as code 0
//   - GY is public; face-down banished cards stay hidden from the opponent
//   - your Extra Deck is visible to you; the opponent's only shows its face-up cards
//   - nobody sees Deck contents during a duel
// `fullView` (bot-vs-bot testing, replays) shows everything.
// Each player sees the duel from their own seat: whoever plays engine side 1 gets the board turned around,
// so in every frame they receive, side 0 (the bottom of the screen) is them.
import type { FieldCard, Frame, Side, SideView } from '@arena/shared';

const FACEDOWN = 0xa, FACEUP = 0x5;

export function frameFor(frame: Frame, viewer: Side | null, fullView: boolean): Frame {
  const seen = fullView ? frame : hide(frame, viewer);
  return viewer === 1 ? turnAround(seen) : seen;
}

const flip = <T extends { p: Side }>(z: T): T => ({ ...z, p: (1 - z.p) as Side });

function turnAround(f: Frame): Frame {
  return {
    ...f, turnPlayer: (1 - f.turnPlayer) as Side, board: [f.board[1], f.board[0]],
    attack: f.attack && { from: flip(f.attack.from), to: f.attack.to && flip(f.attack.to) },
    chain: f.chain.map(flip), damage: f.damage.map(flip), highlight: f.highlight.map(flip), columns: f.columns.map(flip),
  };
}

/** For engine-side lists that come from this viewer's seat (names, decks, winner). */
export const seat = <T>(pair: [T, T], viewer: Side | null): [T, T] => (viewer === 1 ? [pair[1], pair[0]] : pair);
export const seatSide = (side: Side | 2 | null, viewer: Side | null) => (viewer === 1 && (side === 0 || side === 1) ? ((1 - side) as Side) : side);

function hide(frame: Frame, viewer: Side | null): Frame {
  const board = frame.board.map((side, p): SideView => {
    const mine = viewer === p;
    const field = (c: FieldCard | null): FieldCard | null => (c && (c[1] & FACEDOWN) && !mine ? [0, c[1], null, null, c[4], 0, 0, c[7]] : c);
    return {
      lp: side.lp, deck: side.deck, extra: side.extra, gy: side.gy,
      hand: mine ? side.hand : side.hand.map(() => 0),
      m: side.m.map(field),
      s: side.s.map(field),
      ban: side.ban.map(([code, pos]) => ((pos & FACEDOWN) && !mine ? [0, pos] : [code, pos])),
      ex: side.ex?.map(([code, pos]) => (mine || (pos & FACEUP) ? [code, pos] : [0, pos])),
    };
  }) as [SideView, SideView];
  return { ...frame, board };
}
