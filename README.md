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
- Next: the Decks page and editor (on DeckForge's decks), the real Duel page (solo vs the bot and Private duels between two people), then Profile and match history.

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
npm run data        # card database + card scripts (first time, and after new sets)
npm run dev         # duel server on :3017 and the app on http://localhost:5185/millennium/
```

## Production

One Node process serves everything under one path (default `/millennium`): the built app, the card data API and the duel WebSocket.

```bash
npm ci
npm run data
npm run build       # builds the app into client/dist
ARENA_PORT=3017 npm start
```

Settings (environment variables): `ARENA_DEV=1` (development only: offers test scenarios in the lobby, see `server/src/duel/scenarios.ts`), `ARENA_PORT` (default 3017), `BASE_PATH` (default `/millennium`), `MAX_DUELS` (duels running at once, default 8; each uses roughly 90 MB), `ENGINE_DATA` (where the card data lives), `ARENA_PACE` (duel playback speed, 1 = normal, 0 = no pauses for automated tests).

Behind a reverse proxy, pass `<BASE_PATH>/` through unchanged (including the `Host` header, which the server compares with `Origin`) and allow WebSocket upgrades on `<BASE_PATH>/ws`.

### Accounts

Accounts live in DeckForge's PostgreSQL database: its `users`, `decks` and `deck_cards` tables, plus an `arena` schema the server creates on start (usernames, settings, login sessions, trusted devices, email codes). Without a database the site runs as the duel lab only.

- Database: the standard `PGHOST`, `PGUSER`, `PGDATABASE` variables. Use peer authentication over a Unix socket, so no password is stored anywhere.
- `ARENA_SECRET`: at least 32 random characters; protects the emailed codes.
- Email: `RESEND_API_KEY` and `ARENA_MAIL_FROM`. In development (`ARENA_DEV=1`) emails are printed instead, and `GET <BASE_PATH>/api/dev/mail?to=<email>` shows the last one.

Passwords use bcrypt (cost 12, like DeckForge). Login, device and code values are stored only as hashes. The login cookie is HttpOnly and SameSite=Strict. Changes must be JSON from this site, and logins, sign-ups and codes are rate-limited. Changing or resetting the password, or "log out everywhere", also signs out DeckForge.

## Updating cards and the engine

New sets arrive in Project Ignis's card scripts quickly, sometimes needing a newer engine. To update both together:

```bash
brew install emscripten   # once
npm run engine            # rebuild engine/ocgcore from the latest ygopro-core
npm run data              # latest card database + scripts
cd engine-test && node duel.js --meta --games 870   # check everything still plays
```

## Licences and credits

- The rules engine (`ygopro-core`) and Project Ignis's card scripts are licensed under the **AGPL-3.0**, so this project's source code will be public when the site goes live.
- The WebAssembly wrapper is [`ocgcore-wasm`](https://github.com/n1xx1/ocgcore-wasm) (MIT), with our fixes in `engine/patches/`.
- Card data, card scripts and EDOPro's system strings from [Project Ignis](https://github.com/ProjectIgnis); card images from [YGOPRODeck](https://ygoprodeck.com).
- Millennium Arena is a free fan project. It is not affiliated with or endorsed by Konami. Yu-Gi-Oh! card names, artwork and game mechanics belong to their owners.
