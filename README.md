# Millennium Arena

Browser Yu-Gi-Oh! duels with automated rules: every card free, no ads, no payments. Built on EDOPro's rules engine (`ygopro-core`) and Project Ignis's card scripts.

**Status:** in development.
- Milestone 1 (done): the duel server runs real duels on the engine and streams them live to the duel screen.
- Milestone 2 (done): you duel a simple bot in the browser. Cards you can use glow and open a menu. Battle Phase and End Turn are buttons. You choose zones, positions, cards and options, and respond to chains. You're only asked to respond when you have something to activate.
- Since then:
  - Bot speed (Slow / Normal / Fast / Instant) and a turn timer (Off / 60 / 90 / 180 s per turn, 30 s per response on the opponent's turn; when time runs out the turn moves on).
  - Negated cards get an X, and a Set Infinite Impermanence marks its column as negated for the turn.
  - Cards an effect shows you (e.g. Galaxy Hundred and the opponent's Extra Deck) open in a window and can be picked from.
  - A smarter bot: it wins about 69% of duels against the old random bot over 1,000 test duels.
- Milestone 3 (done): every choice the engine can ask for has its own screen: Level sums (e.g. Ritual Tributes), removing counters, ordering cards, declaring a Type, Attribute, number or card name (search with cards seen this duel offered first), and rock-paper-scissors. Field cards show their counters. The dev server has a test setup for each.
- Milestone 4 (done): summon effects (Xyz, Synchro, Link, Fusion and Ritual each look different, with a banner), cards shattering, dissolving or sliding away as they leave the field, attackers lunging, the resolving chain link highlighted, life points counting down, an animated Victory/Defeat screen, and a "thinking" indicator. Responses: Smart (default: you're not asked to respond right after your own actions; your triggers and the opponent's moves still ask) or Always ask. A dropped connection or page reload rejoins the same duel (the seat is kept for 60 s).
- The real pages, step 1 (done): accounts shared with DeckForge (same email and password, same decks). Sign up with an email code, a code when logging in on a new device (or trust it for 30 days), forgot password, Privacy and Terms (drafts), Home, and Settings (theme, Home artwork, field effects, username, email, password, trusted devices, log out everywhere, delete account, Responses, bot speed). The duel lab is the Duel page for now.
- Any window shape: the background fills the window, the duel screen keeps its layout centred, and pages rearrange themselves in smaller windows instead of shrinking.
- The real pages, step 2 (done): the Decks page and deck editor, on the same decks as DeckForge. Legality is checked live against the current TCG banlist (copy limits, Forbidden/Limited/Semi-Limited, deck sizes, cards not released in the TCG). Card search, drag and drop, right-click for the Side Deck, undo, sort, stats with opening-hand odds, test hands, .ydk import and export, a cover card, and a "Dueling with" deck that the duel lobby picks by default. Changes save themselves.
- The real pages, step 3 (done): the Duel page. Solo vs the bot with any of your decks. Private duels: the host picks the rules (best of 1 or 3, turn timer, TCG/OCG/no banlist, starting life points, deck check, spectators, optional password) and shares a 6-character code or an invite link; the friend joins, both get ready, a coin toss decides who picks going first. Best of 3 has side decking between games and the loser of a game picks next. Chat and the duel log share a panel (quick replies, mute). People can ask to watch; everyone playing has to accept, and spectators only see public cards. Nobody learns the opponent's deck name. A reload or dropped connection finds your room again; leaving mid-match loses it; a room whose players have gone closes itself.
- The real pages, step 4 (done): the Profile page. Win rate, wins and losses, win/loss ratio, current and best streaks, the last 10 results, decks played, most-played cards (counted from what you summon, activate and Set), and your match history (All / Wins / Losses, and All duels / Private / Solo vs bot). Other players see only your record at `/u/<name>`. Home shows your record, and your three most-played cards once you've played 10 duels. Leaving or surrendering a duel against the bot counts as a loss; a private match is saved when it's decided or someone leaves it.

## Layout

| Folder | What it is |
|---|---|
| `client/` | The browser app (React + Vite + TypeScript). The duel screen, carried over from the design mockups. |
| `server/` | The duel server (Node + TypeScript + WebSockets). Each duel runs in its own worker thread. Hides each player's private information before anything is sent, turns the engine's prompts into choices for the duel screen, and checks every answer before it reaches the engine. |
| `shared/` | Message types used by both the server and the app. |
| `engine/` | Our build of the engine. `build-core.sh` compiles the latest `ygopro-core` to WebAssembly into `engine/ocgcore/` (committed, so servers don't need a compiler). `fetch-data.sh` downloads the card database and card scripts. |
| `engine-test/` | Stress test: random bots play hundreds of duels between real tournament decks to catch engine, script and decoding problems. See its README. |
| `design/` | The HTML design mockups (every page in four themes) and a replay viewer. |

## Run it locally

Needs Node 22.13 or newer.

```bash
npm install
npm run data        # card database, card scripts and banlists, at the commits in engine/DATA_COMMITS
npm run dev         # duel server on :3017 and the app on http://localhost:5185/millennium/
```

## Production

One Node process serves everything under one path (default `/millennium`): the built app, the card data API and the duel WebSocket.

```bash
npm ci
npm run data
node engine-test/fetch-meta-decks.js   # the bot's tournament decks (or copy engine/data/decks from a machine that has them)
npm run build       # builds the app into client/dist
ARENA_PORT=3017 ARENA_HOST=127.0.0.1 npm start
```

On the homelab server it runs under PM2 with `ecosystem.config.cjs`, which loads its settings from `/var/www/millennium/.env`.

Settings (environment variables): `ARENA_DEV=1` (development only: offers test scenarios in the lobby, see `server/src/duel/scenarios.ts`; refuses any database but `arena_dev`), `ARENA_PORT` (default 3017), `ARENA_HOST` (the address to listen on; `127.0.0.1` behind a proxy on the same machine, default every interface), `BASE_PATH` (default `/millennium`), `MAX_DUELS` (duels running at once, default 8; each uses roughly 90 MB), `ENGINE_DATA` (where the card data lives), `ARENA_PACE` (duel playback speed, 1 = normal, 0 = no pauses for automated tests).

Behind a reverse proxy, pass `<BASE_PATH>/` through unchanged (including the `Host` header, which the server compares with `Origin`) and allow WebSocket upgrades on `<BASE_PATH>/ws`.

### Accounts

Accounts live in DeckForge's PostgreSQL database: its `users`, `decks` and `deck_cards` tables, plus an `arena` schema (usernames, settings, login sessions, trusted devices, email codes, match history). The server creates the schema if it's missing and its tables on start; in production the database owner makes the schema once, owned by Arena's login, so that login needs no right to create anything else. Without a database the site runs as the duel lab only.

- Database: the standard `PGHOST`, `PGUSER`, `PGDATABASE` variables. Use peer authentication over a Unix socket, so no password is stored anywhere.
- `ARENA_SECRET`: at least 32 random characters; protects the emailed codes. Without it or the email settings, signing up and logging in answer 503 instead of half working.
- Email: `RESEND_API_KEY` and `ARENA_MAIL_FROM`. In development (`ARENA_DEV=1`) emails are printed instead, and `GET <BASE_PATH>/api/dev/mail?to=<email>` shows the last one.

Decks are DeckForge's own `decks` and `deck_cards` rows (one row per card and zone, with a copy count), so a deck changed on either site shows up on the other; DeckForge's unused `thumbnail` column holds the cover card. The deck rules live in `shared/decks.ts`, used by both the editor and the server, which refuses to start a duel with a deck that's the wrong size or has unknown cards.

Passwords use bcrypt (cost 12, like DeckForge). Login, device and code values are stored only as hashes. The login cookie is HttpOnly and SameSite=Strict. Changes must be JSON from this site, and logins, sign-ups and codes are rate-limited. Changing or resetting the password, or "log out everywhere", also signs out DeckForge.

## Updating cards and the engine

New sets arrive in Project Ignis's card scripts quickly, sometimes needing a newer engine. To update both together:

```bash
brew install emscripten   # once
npm run engine            # rebuild engine/ocgcore from the latest ygopro-core
npm run data -- latest    # latest card database + scripts
cd engine-test && node duel.js --meta --games 870   # check everything still plays
```

Then copy the commits `npm run data -- latest` printed into `engine/DATA_COMMITS`, so servers get exactly what was tested.

## Licences and credits

- The rules engine (`ygopro-core`) and Project Ignis's card scripts are licensed under the **AGPL-3.0**, so this project's source code will be public when the site goes live.
- The WebAssembly wrapper is [`ocgcore-wasm`](https://github.com/n1xx1/ocgcore-wasm) (MIT), with our fixes in `engine/patches/`.
- Card data, card scripts and EDOPro's system strings from [Project Ignis](https://github.com/ProjectIgnis); card images from [YGOPRODeck](https://ygoprodeck.com).
- Millennium Arena is a free fan project. It is not affiliated with or endorsed by Konami. Yu-Gi-Oh! card names, artwork and game mechanics belong to their owners.
