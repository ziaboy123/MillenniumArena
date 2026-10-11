# Engine test

Proves Millennium Arena can run real, current Yu-Gi-Oh! duels: our own WebAssembly build of EDOPro's rules engine (`ygopro-core`, at its latest commit) plays full duels in Node between real tournament decks, using Project Ignis's card database and card scripts. Both players are random bots that answer every prompt the engine sends, which exercises card effects in odd orders and board states (good for finding bugs, not a measure of play skill).

```bash
npm install                          # uses the engine build in ../engine/ocgcore (rebuild: npm run engine)
npm run data                         # card database + card scripts, latest (../engine/data, not committed)
npm run meta-decks                   # 30 recent tournament-topping decks from YGOPRODeck as .ydk (../engine/data/decks/)

node duel.js --meta                  # round robin between every deck (435 duels)
node duel.js --meta --games 870      # ...each pairing twice, both going first
node duel.js --meta --only "Lunalight,Fiendsmith Sacred Beasts" --seed 20737   # replay one duel
node duel.js                         # Dark Magician vs Blue-Eyes (the mockup decks), readable log
DEBUG_PROFILE=1 node duel.js ...     # time every card's condition/target checks
```

Needs Node 22.13 or newer (built-in `node:sqlite`).

## Results (11 Oct 2026)

Engine: ygopro-core `93eff32` (11 Oct 2026), CardScripts and BabelCDB at their 11 Oct commits.

- **30 tournament decks** from September–October 2026 WCQ Regionals and YCSs: Mitsurugi, Ryzeal, Fiendsmith, Branded Despia, Snake-Eye, Sky Striker, Maliss, Elfnote, Angelechy, Blitzclique, Light and Darkness Ritual, Memento, Primite Dracotail and more.
- **870 / 870 duels finish** (every pairing, both going first): no script errors, no decoder mismatches, nothing missing.
- **62 ms of engine time per duel on average**, ~13 turns. See `meta-report.txt`, `sample-meta-duel.txt` (a 5-link chain on turn 2) and `sample-duel.txt`.

## What we learned

1. **Build the engine ourselves.** Card scripts update almost daily and newer scripts need a newer engine. The published `ocgcore-wasm` npm build is from April 2026: 26 of the 30 decks contained cards it couldn't run. `../engine/build-core.sh` compiles the latest engine in about a minute, so engine and scripts can always be updated together.
2. **The wrapper's message decoders lag the engine.** Three didn't match today's engine and are fixed in `../engine/patches/wrapper-fixes.patch`: card moves (missing the move *reason*), shuffling Set cards (wrong count size and order), and declaring an Attribute (wrong size). The patch also adds a **mismatch detector**: any decoder that doesn't read exactly the bytes it was given is reported per message type, so future engine changes get caught automatically. (Upstream's own source had already fixed a fourth, `select_sum`, which was broken in the npm build.) Worth sending upstream.
3. **Emscripten 6 needs one extra flag** (`wasmBinary`) and the engine should be built for speed (`-O3`, ~12% faster than the wrapper's size-optimised default). Both are in `../engine/build-core.sh`. A fourth fix came later: the board query decoder didn't skip data for flags it doesn't handle.
4. **A few cards are slow to check.** The worst: **Lunalight Fusion**, which can fuse from the Deck once the opponent has summoned from the Extra Deck, so every "can I activate this?" check searches material combinations across the whole Deck (mostly Lunalight Liger Dancer's). In one duel that made each chain check take ~1.4 s. Other hotspots: Dominus Impulse, Fiendsmith Engraver. **The real server must run each duel in its own worker thread** so one slow check never stalls other duels, and the duel screen should show a "thinking" state when the engine takes a moment.
5. **Prompts the UI must handle** (most to least common): respond to chain, main phase actions, choose a zone, choose cards, battle actions, select/unselect cards, choose position, yes/no on an effect, declare a card, order cards, yes/no, Level-sum selection, choose an option, Tribute selection, declare a number, declare an Attribute, place counters. ~92% of "respond?" prompts have nothing to activate, so the UI must auto-pass them.
6. **The engine doesn't enforce the banlist.** Deck legality is ours to check before a duel, as the Decks page does.

## Licences

`ygopro-core` and Project Ignis's CardScripts are AGPL-3.0. Practically: the duel server's **source code** must be available to its players (a public GitHub repo linked from the site). That's code only; it doesn't expose servers, network details, passwords or keys, which stay out of the repo as usual. Card data in `../engine/data/` is downloaded, not committed.
