// What each viewer is allowed to see. Hidden information is removed on the server, so it never reaches a
// browser where it could be read from dev tools. Rules (agreed for live duels):
//   - your own hand and face-down cards are yours; the opponent's show as code 0
//   - GY is public; face-down banished cards stay hidden from the opponent
//   - your Extra Deck is visible to you; the opponent's only shows its face-up cards
//   - nobody sees Deck contents during a duel
// `fullView` (bot-vs-bot testing, replays) shows everything.
import type { FieldCard, Frame, Side, SideView } from '@arena/shared';

const FACEDOWN = 0xa, FACEUP = 0x5;

export function frameFor(frame: Frame, viewer: Side | null, fullView: boolean): Frame {
  if (fullView) return frame;
  const board = frame.board.map((side, p): SideView => {
    const mine = viewer === p;
    const field = (c: FieldCard | null): FieldCard | null => (c && (c[1] & FACEDOWN) && !mine ? [0, c[1], null, null, c[4], 0] : c);
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
