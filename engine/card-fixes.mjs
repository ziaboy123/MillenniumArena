// Fixes for two ways Project Ignis's card data lags behind real releases, written to engine/data/card-fixes.json:
// 1. "official": brand-new cards have temporary numbers (9 digits, e.g. 101402090) for weeks, but YGOPRODeck, DeckForge
//    and .ydk files already use the official ones (50284408). Matched by name on YGOPRODeck:
//    { "50284408": { "engine": 101402090, "tcg": "2026-10-08", "ocg": null } }
// 2. "released": cards it hasn't marked as out yet in the TCG (still OCG-only or "not released") get their real
//    release dates from YGOPRODeck: { "31114334": { "tcg": "2026-09-03", "ocg": "2026-02-28" } }
// The server counts a card as released where its date has passed.
// Also engine/data/picture-ids.json: every picture number YGOPRODeck has (Skill cards and other cards duels don't use
// included), so the server knows which pictures it may fetch and re-host for DeckForge (server/src/images.ts). It's
// downloaded again only when YGOPRODeck's database version changes. Run by fetch-data.sh. Needs Node 22.13+ (node:sqlite).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dir = new URL('./data/BabelCDB/', import.meta.url);
const out = new URL('./data/card-fixes.json', import.meta.url);
// the same databases the server loads (see cardDatabases() in server/src/cards.ts)
const files = readdirSync(dir).filter(f => /^(cards|release-.*|prerelease-(?!cards-rush).*)\.cdb$/.test(f));

const known = new Set(), temporary = new Map(), notTcg = [];   // temporary number -> name; official numbers not out in the TCG
for (const f of files) {
  const db = new DatabaseSync(new URL(f, dir), { readOnly: true });
  for (const { id, ot, name } of db.prepare('SELECT d.id, d.ot, t.name FROM datas d JOIN texts t ON t.id = d.id').all()) {
    const code = Number(id);
    known.add(code);
    if (code > 99_999_999) temporary.set(code, String(name));
    else if (!(ot & 0x2) || (ot & 0x100)) notTcg.push(code);
  }
  db.close();
}

const dates = c => ({ tcg: c.misc_info?.[0]?.tcg_date ?? null, ocg: c.misc_info?.[0]?.ocg_date ?? null });
async function ask(query) {   // YGOPRODeck skips names/numbers it doesn't know
  const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&${query}`, { headers: { 'User-Agent': 'MillenniumArena-data' } });
  await new Promise(r => setTimeout(r, 120));   // well under YGOPRODeck's rate limit
  return res.ok ? (await res.json()).data ?? [] : [];
}

const official = {};
const byName = new Map([...temporary].map(([id, name]) => [name.trim().toLowerCase(), id]));
const names = [...temporary.values()];
for (let i = 0; i < names.length; i += 25)
  for (const c of await ask('name=' + names.slice(i, i + 25).map(encodeURIComponent).join('|'))) {
    const engine = byName.get(String(c.name).trim().toLowerCase());
    if (engine && c.id < 100_000_000 && !known.has(c.id)) official[c.id] = { engine, ...dates(c) };   // only cards it doesn't have under the official number
  }

const released = {};
for (let i = 0; i < notTcg.length; i += 50)
  for (const c of await ask('id=' + notTcg.slice(i, i + 50).join(','))) { const d = dates(c); if (d.tcg) released[c.id] = d; }

writeFileSync(out, JSON.stringify({ official, released }, null, 1) + '\n');
console.log(`card-fixes.json: ${Object.keys(official).length} of ${temporary.size} temporarily numbered cards matched to official numbers; ` +
  `${Object.keys(released).length} of ${notTcg.length} cards not marked as out in the TCG have a TCG release date`);

// picture numbers: the whole database is one download, so only when YGOPRODeck says it has changed (a failure keeps the old list)
const pictures = new URL('./data/picture-ids.json', import.meta.url);
try {
  const have = existsSync(pictures) ? JSON.parse(readFileSync(pictures, 'utf8')) : null;
  const version = (await (await fetch('https://db.ygoprodeck.com/api/v7/checkDBVer.php', { headers: { 'User-Agent': 'MillenniumArena-data' } })).json())?.[0]?.database_version;
  if (have && version && have.version === version) console.log(`picture-ids.json: up to date (YGOPRODeck database ${version})`);
  else {
    const res = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php', { headers: { 'User-Agent': 'MillenniumArena-data' } });
    if (!res.ok) throw new Error(`YGOPRODeck answered ${res.status}`);
    const ids = new Set();
    for (const c of (await res.json()).data ?? []) for (const im of c.card_images ?? [{ id: c.id }]) ids.add(Number(im.id));
    if (ids.size < 5000) throw new Error(`only ${ids.size} pictures listed`);
    writeFileSync(pictures, JSON.stringify({ version: version ?? null, ids: [...ids].sort((a, b) => a - b) }) + '\n');
    console.log(`picture-ids.json: ${ids.size} picture numbers (YGOPRODeck database ${version})`);
  }
} catch (e) { console.log(`picture-ids.json: not updated (${e.message})`); }
