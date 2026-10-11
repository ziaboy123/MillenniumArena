// Downloads recent tournament-topping decklists from YGOPRODeck as .ydk files into engine/data/decks/,
// one per deck name (newest first). These are the combo-heavy decks real players bring.
//   node fetch-meta-decks.js [how many, default 30]
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';

const WANT = +(process.argv[2] || 30);
const out = new URL('../engine/data/decks/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.ydk')) unlinkSync(new URL(f, out));

const seen = new Set();
const ids = s => JSON.parse(s || '[]').map(Number);
const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
for (let offset = 0; seen.size < WANT && offset < 500; offset += 50) {
  const url = `https://ygoprodeck.com/api/decks/getDecks.php?format=Tournament%20Meta%20Decks&offset=${offset}&limit=50`;
  const page = await (await fetch(url, { headers: { 'User-Agent': 'MillenniumArena-engine-test' } })).json();
  if (!Array.isArray(page) || !page.length) break;
  for (const d of page) {
    const key = d.deck_name.trim().toLowerCase();
    if (seen.has(key) || seen.size >= WANT) continue;
    seen.add(key);
    const info = plain(d.deck_description || '');
    const event = (info.match(/Tournament:\s*(.*?)\s*Placement:\s*(\S+(?: \d+)?)/) || []).slice(1).join(' · ');
    const file = d.deck_name.replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '') + '.ydk';
    writeFileSync(new URL(file, out), [`#name ${d.deck_name}`, `#event ${event}`, '#main', ...ids(d.main_deck), '#extra', ...ids(d.extra_deck), '!side', ...ids(d.side_deck), ''].join('\n'));
    console.log(`${d.deck_name.padEnd(32)} ${event}`);
  }
}
console.log(`\n${seen.size} decks saved to engine/data/decks/`);
