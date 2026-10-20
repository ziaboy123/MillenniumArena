// Project Ignis gives brand-new cards temporary numbers (9 digits, e.g. 101402090) until it switches them to the
// official ones, but YGOPRODeck, DeckForge and .ydk files already use the official numbers (e.g. 50284408). This finds
// the official number of every temporarily numbered card by its name on YGOPRODeck and writes
// engine/data/official-ids.json ({ "50284408": 101402090, ... }), so decks with official numbers work straight away.
// Run by fetch-data.sh. Needs Node 22.13+ (node:sqlite).
import { readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dir = new URL('./data/BabelCDB/', import.meta.url);
const out = new URL('./data/official-ids.json', import.meta.url);
// the same databases the server loads (see cardDatabases() in server/src/cards.ts)
const files = readdirSync(dir).filter(f => /^(cards|release-.*|prerelease-(?!cards-rush).*)\.cdb$/.test(f));

const known = new Set(), temporary = new Map();   // temporary number -> name
for (const f of files) {
  const db = new DatabaseSync(new URL(f, dir), { readOnly: true });
  for (const { id, name } of db.prepare('SELECT d.id, t.name FROM datas d JOIN texts t ON t.id = d.id').all()) {
    known.add(Number(id));
    if (id > 99_999_999) temporary.set(Number(id), String(name));
  }
  db.close();
}

const byName = new Map([...temporary].map(([id, name]) => [name.trim().toLowerCase(), id]));
const names = [...temporary.values()];
const ids = {};
for (let i = 0; i < names.length; i += 25) {   // a few names per request; YGOPRODeck skips names it doesn't know
  const query = names.slice(i, i + 25).map(encodeURIComponent).join('|');
  const res = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${query}`, { headers: { 'User-Agent': 'MillenniumArena-data' } });
  const page = res.ok ? await res.json() : {};
  for (const c of page.data ?? []) {
    const engine = byName.get(String(c.name).trim().toLowerCase());
    // only cards the database doesn't already have under their official number
    if (engine && c.id < 100_000_000 && !known.has(c.id)) ids[c.id] = engine;
  }
  await new Promise(r => setTimeout(r, 120));   // well under YGOPRODeck's rate limit
}
writeFileSync(out, JSON.stringify(ids, null, 1) + '\n');
console.log(`official-ids.json: ${Object.keys(ids).length} of ${temporary.size} temporarily numbered cards matched to their official numbers`);
