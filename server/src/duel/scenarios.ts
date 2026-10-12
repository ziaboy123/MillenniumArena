// Test scenarios (dev server only): a duel that starts with chosen cards already in place, so a particular
// situation can be checked by eye without playing up to it. Cards are added on top of the two decks.
import type { Side } from '@arena/shared';

type Place = 'hand' | 'm' | 's' | 'gy';
interface SetupCard { who: 'you' | 'bot'; code: number; place: Place; seq?: number; faceDown?: boolean }
/** `lua` runs once the cards are in place (e.g. to put counters on them); {you} and {bot} become engine sides.
 *  `first` overrides who goes first when the situation needs it. */
export interface Scenario { name: string; setup: SetupCard[]; lua?: string; first?: 'you' | 'bot' }

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
  declares: {
    name: 'Declare a card name, Type and Attribute',
    setup: [
      { who: 'you', code: 43711255, place: 'hand' },                       // Prohibition: declare a card name
      { who: 'you', code: 74701381, place: 's', seq: 1, faceDown: true },  // DNA Surgery: declare a Type
      { who: 'you', code: 56769674, place: 's', seq: 3, faceDown: true },  // DNA Transplant: declare an Attribute
      { who: 'bot', code: 60764609, place: 'm', seq: 2 },                  // something on the field to look at
    ],
  },
  ritual: {
    name: 'Level sum (Ritual Summon)',
    setup: [
      { who: 'you', code: 55761792, place: 'hand' },                       // Black Luster Ritual: Tribute Levels totalling 8 or more
      { who: 'you', code: 5405694, place: 'hand' },                        // Black Luster Soldier
      { who: 'you', code: 89132148, place: 'hand' },                       // Photon Orbital (Level 4)
      { who: 'you', code: 46659709, place: 'm', seq: 1 },                  // Galaxy Soldier (Level 5)
      { who: 'you', code: 47051709, place: 'm', seq: 3 },                  // Photon Delta Wing (Level 4)
    ],
  },
  bigeye: {
    name: 'Declare a number + card order (Big Eye)',
    setup: [
      { who: 'you', code: 16768387, place: 'm', seq: 2, faceDown: true },  // Big Eye: Flip Summon it, look at up to 5, put them back in any order
    ],
  },
  counters: {
    name: 'Remove counters (Miracle Restoring)',
    setup: [
      { who: 'you', code: 70791313, place: 'm', seq: 1 },                  // Royal Magical Library, 2 Spell Counters
      { who: 'you', code: 70791313, place: 'm', seq: 3 },                  // Royal Magical Library, 1 Spell Counter
      { who: 'you', code: 46986414, place: 'gy' },                         // Dark Magician to bring back
      { who: 'you', code: 68334074, place: 's', seq: 2, faceDown: true },  // Miracle Restoring: remove 2 Spell Counters from your field
    ],
    lua: 'Duel.GetFieldCard({you},LOCATION_MZONE,1):AddCounter(COUNTER_SPELL,2) Duel.GetFieldCard({you},LOCATION_MZONE,3):AddCounter(COUNTER_SPELL,1)',
  },
  rps: {
    // the bot goes first; on your turn attack its face-down monster and activate Transmission Gear during damage calculation
    name: 'Rock, paper, scissors (Transmission Gear)',
    first: 'bot',
    setup: [
      { who: 'you', code: 46986414, place: 'm', seq: 2 },                  // Dark Magician, to attack with
      { who: 'you', code: 58297729, place: 's', seq: 2, faceDown: true },  // Transmission Gear: rock-paper-scissors during damage calculation
      { who: 'bot', code: 89631139, place: 'm', seq: 2, faceDown: true },  // a face-down Blue-Eyes (face-down monsters can't become Link Material)
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
    position: c.faceDown ? (c.place === 'm' ? 0x8 : 0xa) : c.place === 'hand' || c.place === 'gy' ? 0xa : 0x1,   // face-down (Defense) / face-up Attack
  }));
}

/** Who goes first, when the scenario needs a particular order. */
export const firstFor = (id: string | undefined) => (id ? SCENARIOS[id]?.first : undefined);

/** The scenario's Lua, with {you}/{bot} filled in. */
export function luaFor(id: string | undefined, human: Side) {
  const lua = id ? SCENARIOS[id]?.lua : undefined;
  return lua?.replaceAll('{you}', String(human)).replaceAll('{bot}', String(1 - human));
}
