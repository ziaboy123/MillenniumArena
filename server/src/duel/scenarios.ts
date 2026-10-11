// Test scenarios (dev server only): a duel that starts with chosen cards already in place, so a particular
// situation can be checked by eye without playing up to it. Cards are added on top of the two decks.
import type { Side } from '@arena/shared';

type Place = 'hand' | 'm' | 's' | 'gy';
interface SetupCard { who: 'you' | 'bot'; code: number; place: Place; seq?: number; faceDown?: boolean }
export interface Scenario { name: string; setup: SetupCard[] }

export const SCENARIOS: Record<string, Scenario> = {
  showcase: {
    name: 'Impermanence column + Galaxy Hundred',
    setup: [
      // Set Infinite Impermanence in your middle Spell/Trap zone, with an effect monster of the bot's to aim it at
      { who: 'you', code: 10045474, place: 's', seq: 2, faceDown: true },
      { who: 'bot', code: 60764609, place: 'm', seq: 2 },          // Fiendsmith Engraver
      // Galaxy Hundred face-up, two 2000 ATK monsters to Tribute, and Galaxy-Eyes Photon Dragon in hand
      { who: 'you', code: 897409, place: 's', seq: 0 },
      { who: 'you', code: 46659709, place: 'm', seq: 0 },          // Galaxy Soldier
      { who: 'you', code: 46659709, place: 'm', seq: 1 },
      { who: 'you', code: 93717133, place: 'hand' },
    ],
  },
};

/** Engine placements for a scenario, given which engine side the person plays. */
export function setupFor(id: string | undefined, human: Side) {
  const sc = id ? SCENARIOS[id] : undefined;
  if (!sc) return undefined;
  const LOC: Record<Place, number> = { hand: 0x2, m: 0x4, s: 0x8, gy: 0x10 };   // OcgLocation values
  return sc.setup.map(c => ({
    team: (c.who === 'you' ? human : 1 - human) as Side, code: c.code, location: LOC[c.place], sequence: c.seq ?? 0,
    position: c.faceDown ? 0xa : c.place === 'hand' || c.place === 'gy' ? 0xa : 0x1,   // face-down / face-up Attack
  }));
}
