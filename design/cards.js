// Local card database for the mockups: loads cards-index.json once, then every search is instant (no network).
// The real site should serve the same kind of index from its own server (DeckForge already caches every card).

const CARDS = {};        // id -> card
const BY_NAME = {};      // name -> card
let ALTS = {};           // alternate artwork id -> main id
let CARD_LIST = [];
const BAN_NAMES = ['Forbidden', 'Limited', 'Semi-Limited'];

async function loadCardIndex(){
  const [rows, alts] = await Promise.all([fetch('cards-index.json').then(r => r.json()), fetch('cards-alts.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))]);
  ALTS = alts;
  CARD_LIST = rows.map(([id, name, frameType, type, race, attribute, lv, atk, def, lim, views]) => {
    const c = {id, name, frameType, type, race, attribute, atk: atk < 0 ? null : atk, def: def < 0 ? null : def, _lc: name.toLowerCase(), _pop: Math.log10((views || 0) + 10)};
    if (frameType === 'link') c.linkval = lv; else if (lv) c.level = lv;
    if (lim < 3) c.banlist_info = {ban_tcg: BAN_NAMES[lim]};
    CARDS[id] = c; BY_NAME[name] = c;
    return c;
  });
  loadCardText();   // card text (4.6 MB) follows in the background
  return CARD_LIST;
}

// any passcode (including alternate artworks other sims export) -> the id the card data uses
const cardIdOf = id => CARDS[id] ? id : ALTS[id] ?? null;

let textReady = null;
function loadCardText(){
  return textReady ??= fetch('cards-text.json').then(r => r.json()).then(t => { Object.entries(t).forEach(([id, d]) => CARDS[id] && (CARDS[id].desc = d)); });
}

// Every word must appear in the name. Exact names win; otherwise how well it matches (starts with > word starts with > contains) is weighed against popularity
function searchCards(q, keep = () => true, limit = 60){
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const full = words.join(' '), out = [];
  for (const c of CARD_LIST) {
    const n = c._lc;
    if (!words.every(w => n.includes(w)) || !keep(c)) continue;
    const tier = n === full ? -100 : n.startsWith(full) ? 0 : n.startsWith(words[0]) ? 1 : (' ' + n).includes(' ' + words[0]) ? 2 : 3;
    out.push([tier * 1.5 - c._pop, n.length, c]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, limit).map(x => x[2]);
}
