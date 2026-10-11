// Engine test: EDOPro's ygopro-core (ocgcore-wasm) plays full duels between two real decks in Node.
// Both sides are simple random bots that answer every prompt the engine asks, so this proves the rules engine,
// card database and card scripts all work, and lists every prompt type the real UI has to handle.
//
//   npm run data                        (once: downloads card database + card scripts)
//   node duel.js                        one duel with a readable log
//   node duel.js --games 50 --quiet     many duels, summary only
//   node duel.js --seed 7               replay a specific duel
//   node duel.js --meta                 round robin between every tournament deck in engine/data/decks (npm run meta-decks)
//   node duel.js --meta --games 1000    ... with a set number of duels
//   node duel.js --ydk my.ydk            your own deck vs a random tournament deck, readable log
//   node duel.js --ydk my.ydk --vs Mitsurugi --games 50   ...vs a chosen deck (or --vs other.ydk), summary
//   node duel.js --ydk my.ydk --vs my.ydk --record ../design/replays/x.json   save a replay for the visual viewer
//   node duel.js --meta --only "Lunalight,Fiendsmith Sacred Beasts" --seed 20737   replay one matchup (first deck goes first)
import createCore, {
  OcgDuelMode, OcgPhase, OcgLocation, OcgMessageType, OcgPosition, OcgProcessResult, OcgResponseType, OcgQueryFlags,
  SelectBattleCMDAction, SelectIdleCMDAction, cardMatchesOpcode, ocgMessageTypeStrings,
} from 'ocgcore-wasm';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.join(here, '../engine/data');   // shared with the server: npm run data
const SCRIPTS = path.join(DATA, 'CardScripts');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] ?? true : fallback; };
const META = process.argv.includes('--meta');
const RECORD = arg('record', null);   // write a replay (one duel) for design/replay.html
let GAMES = +arg('games', 1), QUIET = process.argv.includes('--quiet'), FIRST_SEED = +arg('seed', Date.now() % 100000);

// ---------- card database (Project Ignis BabelCDB) ----------
if (!existsSync(path.join(DATA, 'BabelCDB'))) { console.error('Card data missing: run `npm run data` first.'); process.exit(1); }
const cards = new Map(), byName = new Map();
const cdbs = readdirSync(path.join(DATA, 'BabelCDB')).filter(f => /^(cards|release-.*|prerelease-(?!cards-rush).*)\.cdb$/.test(f)).sort((a, b) => (a === 'cards.cdb' ? -1 : b === 'cards.cdb' ? 1 : a.localeCompare(b)));
for (const file of cdbs) {
  const db = new DatabaseSync(path.join(DATA, 'BabelCDB', file), { readOnly: true });
  const query = db.prepare('SELECT d.id, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.name FROM datas d JOIN texts t ON t.id = d.id');
  query.setReadBigInts(true);   // setcode and race are 64-bit
  const rows = query.all();
  for (const r of rows) {
    const code = Number(r.id), type = Number(r.type), level = Number(r.level), isLink = (type & 0x4000000) !== 0;
    const setcodes = []; for (let s = BigInt(r.setcode); s > 0n; s >>= 16n) if (s & 0xffffn) setcodes.push(Number(s & 0xffffn));
    cards.set(code, {
      code, alias: Number(r.alias), setcodes, type, level: level & 0xff, attribute: Number(r.attribute), race: BigInt(r.race),
      attack: Number(r.atk), defense: isLink ? 0 : Number(r.def), lscale: (level >> 24) & 0xff, rscale: (level >> 16) & 0xff,
      link_marker: isLink ? Number(r.def) : 0, name: r.name,
    });
    if (!byName.has(r.name)) byName.set(r.name, code);
  }
  db.close();
}
const nameOf = code => cards.get(code)?.name ?? `#${code}`;

// ---------- decks: the same lists the Decks page mockup uses ----------
const DECK_LISTS = vm.runInNewContext(readFileSync(path.join(here, '../design/decks-data.js'), 'utf8') + ';DECK_LISTS', {});
function loadDeck(deckName){
  const d = DECK_LISTS.find(x => x.name === deckName), missing = [];
  const expand = list => list.flatMap(([n, k]) => { const c = byName.get(n); if (!c) { missing.push(n); return []; } return Array(k).fill(c); });
  const deck = { name: d.name, main: expand(d.main), extra: expand(d.extra) };
  if (missing.length) console.warn(`${deckName}: not in the card database: ${missing.join(', ')}`);
  return deck;
}
// .ydk decks (meta mode). YGOPRODeck sometimes uses IDs the engine's database doesn't have (new or alternate
// artworks), so unknown IDs fall back to matching the card's name through the mockup's card index.
const ygoNames = (() => { try { return new Map(JSON.parse(readFileSync(path.join(here, '../design/cards-index.json'), 'utf8')).map(r => [r[0], r[1]])); } catch { return new Map(); } })();
const resolve = id => cards.has(id) ? id : byName.get(ygoNames.get(id));
function loadYdk(file){
  const deck = { name: path.basename(file, '.ydk'), main: [], extra: [], unknown: [] };
  let zone = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#name ')) deck.name = line.slice(6).trim();
    else if (line.startsWith('#event ')) deck.event = line.slice(7).trim();
    else if (line === '#main') zone = 'main'; else if (line === '#extra') zone = 'extra'; else if (line === '!side') zone = null;
    else if (zone && /^\d+$/.test(line.trim())) { const c = resolve(+line); if (c) deck[zone].push(c); else deck.unknown.push(+line); }
  }
  return deck;
}
const ONLY = arg('only', null)?.split(',').map(x => x.trim());
let POOL = META
  ? readdirSync(path.join(DATA, 'decks')).filter(f => f.endsWith('.ydk')).sort().map(f => loadYdk(path.join(DATA, 'decks', f)))
  : [loadDeck('Dark Magician'), loadDeck('Blue-Eyes')];
if (ONLY) POOL = ONLY.map(n => POOL.find(d => d.name === n) ?? (() => { throw new Error(`no deck named ${n}`); })());

// --ydk: your own deck file against a tournament deck (--vs <name or .ydk>, default random)
const MINE = arg('ydk', null);
if (MINE) {
  const mine = loadYdk(path.resolve(MINE));
  mine.name = `You (${mine.name})`;
  const meta = existsSync(path.join(DATA, 'decks')) ? readdirSync(path.join(DATA, 'decks')).filter(f => f.endsWith('.ydk')).map(f => loadYdk(path.join(DATA, 'decks', f))) : [];
  const vs = arg('vs', null);
  const opp = vs?.endsWith('.ydk') ? loadYdk(path.resolve(vs))
    : vs ? meta.find(d => d.name.toLowerCase() === vs.toLowerCase()) ?? meta.find(d => d.name.toLowerCase().includes(vs.toLowerCase()))
    : meta[Math.floor(Math.random() * meta.length)];
  if (opp && vs?.endsWith('.ydk')) opp.name = `Opponent (${opp.name})`;
  // mirror match (same file both sides): just "You" and "Opponent"
  if (vs?.endsWith('.ydk') && path.resolve(vs) === path.resolve(MINE)) { console.log(`Mirror match: ${path.basename(MINE, '.ydk').replace(/_/g, ' ')}`); mine.name = 'You'; opp.name = 'Opponent'; }
  if (!opp) { console.error(vs ? `No tournament deck matches "${vs}". Options: ${meta.map(d => d.name).join(', ')}` : 'No opponent decks: run `npm run meta-decks` first.'); process.exit(1); }
  POOL = [mine, opp];
  checkDeck(mine);
}

// legality on today's TCG banlist (the engine itself doesn't enforce it): warn, don't block
function checkDeck(d){
  const limits = (() => { try { return new Map(JSON.parse(readFileSync(path.join(here, '../design/cards-index.json'), 'utf8')).map(r => [r[1], r[9]])); } catch { return new Map(); } })();
  const problems = [], copies = new Map();
  [...d.main, ...d.extra].forEach(c => copies.set(nameOf(c), (copies.get(nameOf(c)) || 0) + 1));   // alternate artworks share a name
  if (d.main.length < 40 || d.main.length > 60) problems.push(`Main Deck has ${d.main.length} cards (40-60)`);
  if (d.extra.length > 15) problems.push(`Extra Deck has ${d.extra.length} cards (max 15)`);
  for (const [n, k] of copies) { const lim = limits.get(n) ?? 3; if (k > lim) problems.push(`${n}: ${k} copies (${['Forbidden', 'Limited', 'Semi-Limited'][lim] ?? 'max 3'}${lim < 3 ? `, max ${lim}` : ''})`); }
  if (d.unknown.length) problems.push(`card IDs not found: ${d.unknown.join(', ')}`);
  console.log(`${d.name}: ${d.main.length} main + ${d.extra.length} extra · ${problems.length ? 'NOT legal on today\'s TCG list:\n  - ' + problems.join('\n  - ') : 'legal on today\'s TCG list'}\n`);
}
const PAIRS = [];
for (let i = 0; i < POOL.length; i++) for (let j = i + 1; j < POOL.length; j++) PAIRS.push([POOL[i], POOL[j]]);
if (META && !process.argv.includes('--games')) GAMES = PAIRS.length;

// ---------- card scripts (Project Ignis CardScripts) ----------
const SCRIPT_DIRS = ['official', 'pre-release', 'pre-errata', 'unofficial'];
const missingScripts = new Set();
function readScript(name){
  const base = path.basename(name);
  const tries = /^c\d+\.lua$/.test(base) ? SCRIPT_DIRS.map(d => path.join(SCRIPTS, d, base)) : [SCRIPTS, ...SCRIPT_DIRS.map(d => path.join(SCRIPTS, d))].map(d => path.join(d, base));
  for (const f of tries) if (existsSync(f)) return readFileSync(f, 'utf8');
  // Normal Monsters and tokens have no script by design; anything else missing is worth knowing about
  const card = cards.get(+base.slice(1, -4));
  if (base !== 'c0.lua' && (!card || (card.type & 0x20) || !(card.type & 0x4011))) missingScripts.add(base);
  return null;
}

// ---------- bots ----------
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function pickN(r, n, len){ const idx = [...Array(len).keys()]; for (let i = len - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.slice(0, n).sort((a, b) => a - b); }

// zone bitmask: a set bit means "can't use". Bits 0-6 own monster zones (5-6 = Extra Monster Zones),
// 8-15 own spell/trap zones (13 = field, 14-15 = pendulum); +16 for the opponent's side.
function freePlaces(m, count, r){
  const own = [], theirs = [];
  for (let bit = 0; bit < 32; bit++) {
    const b = bit % 16, isMonster = b < 8, seq = b % 8;
    if ((isMonster && seq > 6) || ((m.field_mask >>> bit) & 1)) continue;
    (bit < 16 ? own : theirs).push({ player: bit < 16 ? m.player : 1 - m.player, location: isMonster ? OcgLocation.MZONE : OcgLocation.SZONE, sequence: seq });
  }
  const shuffle = a => a.sort(() => r() - .5);
  return [...shuffle(own), ...shuffle(theirs)].slice(0, count);
}
// choose cards whose values (usually Levels) add up to the amount; each card may count as one of two values.
// select_max 0 = exactly the amount (e.g. Xyz/Synchro-style costs), 1 = at least the amount with no card left
// over (Ritual tributes: the total can go past the Level, but dropping any one card must leave it short)
function solveSum(m){
  const vals = c => [c.amount & 0xffff, c.amount >> 16].filter((v, i) => i === 0 || v);
  let base = 0; for (const c of m.selects_must) base += vals(c)[0];
  const target = m.amount - base, sel = m.selects, chosen = [], used = [];
  const atLeast = m.select_max !== 0;
  const ok = sum => atLeast ? sum >= target && used.every(v => sum - v < target) : sum === target;
  const dfs = (i, sum) => {
    if (chosen.length >= m.min && chosen.length && ok(sum)) return true;
    if (i >= sel.length || chosen.length >= (m.max || sel.length) || (!atLeast && sum > target)) return false;
    for (const v of vals(sel[i])) { chosen.push(i); used.push(v); if (dfs(i + 1, sum + v)) return true; chosen.pop(); used.pop(); }
    return dfs(i + 1, sum);
  };
  return dfs(0, 0) ? chosen : [...Array(Math.max(m.min, 1)).keys()];
}

function decide(m, r, s, tries){
  const T = OcgMessageType;
  switch (m.type) {
    case T.SELECT_IDLECMD: {
      const groups = [
        [SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, m.special_summons, 4], [SelectIdleCMDAction.SELECT_SUMMON, m.summons, 4],
        [SelectIdleCMDAction.SELECT_ACTIVATE, m.activates, 3], [SelectIdleCMDAction.SELECT_MONSTER_SET, m.monster_sets, 1],
        [SelectIdleCMDAction.SELECT_SPELL_SET, m.spell_sets, 1],
      ].filter(([, list]) => list.length);
      if (groups.length && s.acts < 25 && tries < 3) {
        s.acts++;
        let w = r() * groups.reduce((a, g) => a + g[2], 0);
        const [action, list] = groups.find(g => (w -= g[2]) < 0) ?? groups[0];
        return { type: OcgResponseType.SELECT_IDLECMD, action, index: Math.floor(r() * list.length) };
      }
      return { type: OcgResponseType.SELECT_IDLECMD, action: m.to_bp ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP, index: null };
    }
    case T.SELECT_BATTLECMD:
      if (m.attacks.length && s.attacks < 6 && tries < 3) { s.attacks++; return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: Math.floor(r() * m.attacks.length) }; }
      return { type: OcgResponseType.SELECT_BATTLECMD, action: m.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP, index: null };
    case T.SELECT_CHAIN:
      if (m.selects.length && (m.forced || (r() < 0.6 && tries === 0))) return { type: OcgResponseType.SELECT_CHAIN, index: m.forced ? 0 : Math.floor(r() * m.selects.length) };
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    case T.SELECT_EFFECTYN: return { type: OcgResponseType.SELECT_EFFECTYN, yes: tries === 0 && r() < 0.85 };
    case T.SELECT_YESNO: return { type: OcgResponseType.SELECT_YESNO, yes: tries === 0 && r() < 0.85 };
    case T.SELECT_OPTION: return { type: OcgResponseType.SELECT_OPTION, index: Math.floor(r() * m.options.length) };
    case T.SELECT_CARD: {
      const n = Math.min(m.selects.length, Math.max(m.min, 1) + (tries ? tries : 0), m.max);
      return { type: OcgResponseType.SELECT_CARD, indicies: pickN(r, n, m.selects.length) };
    }
    case T.SELECT_UNSELECT_CARD:
      if ((m.can_finish && (tries > 0 || r() < 0.5)) || !m.select_cards.length) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: Math.floor(r() * m.select_cards.length) };
    case T.SELECT_TRIBUTE: return { type: OcgResponseType.SELECT_TRIBUTE, indicies: pickN(r, Math.min(m.selects.length, tries ? m.max : m.min), m.selects.length) };
    case T.SELECT_SUM: return { type: OcgResponseType.SELECT_SUM, indicies: solveSum(m) };
    case T.SELECT_PLACE: return { type: OcgResponseType.SELECT_PLACE, places: freePlaces(m, m.count, r) };
    case T.SELECT_DISFIELD: return { type: OcgResponseType.SELECT_DISFIELD, places: freePlaces(m, m.count, r) };
    case T.SELECT_POSITION: {
      const pref = [OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEDOWN_ATTACK].filter(p => m.positions & p);
      return { type: OcgResponseType.SELECT_POSITION, position: pref[tries % pref.length] };
    }
    case T.SELECT_COUNTER: {
      let left = m.count; const counters = m.cards.map(c => { const k = Math.min(c.count, left); left -= k; return k; });
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }
    case T.SORT_CARD: case T.SORT_CHAIN: return { type: OcgResponseType.SORT_CARD, order: null };
    case T.ANNOUNCE_RACE: case T.ANNOUNCE_ATTRIB: {
      const bits = []; for (let b = 0n; b < 64n && bits.length < m.count; b++) if (BigInt(m.available) & (1n << b)) bits.push(1n << b);
      return m.type === T.ANNOUNCE_RACE ? { type: OcgResponseType.ANNOUNCE_RACE, races: bits } : { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: bits.map(Number) };
    }
    case T.ANNOUNCE_CARD: {
      const fit = [...cards.values()].filter(c => cardMatchesOpcode(c, m.opcodes));
      return { type: OcgResponseType.ANNOUNCE_CARD, card: fit.length ? pick(r, fit).code : 46986414 };
    }
    case T.ANNOUNCE_NUMBER: return { type: OcgResponseType.ANNOUNCE_NUMBER, value: tries ? Number(m.options[0]) : Math.floor(r() * m.options.length) };
    case T.ROCK_PAPER_SCISSORS: return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 + Math.floor(r() * 3) };
  }
  return null;
}
const PROMPTS = new Set(['SELECT_BATTLECMD', 'SELECT_IDLECMD', 'SELECT_EFFECTYN', 'SELECT_YESNO', 'SELECT_OPTION', 'SELECT_CARD', 'SELECT_CHAIN',
  'SELECT_PLACE', 'SELECT_POSITION', 'SELECT_TRIBUTE', 'SORT_CHAIN', 'SELECT_COUNTER', 'SELECT_SUM', 'SELECT_DISFIELD', 'SORT_CARD',
  'SELECT_UNSELECT_CARD', 'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_CARD', 'ANNOUNCE_NUMBER', 'ROCK_PAPER_SCISSORS'].map(k => OcgMessageType[k]));

// ---------- one duel ----------
const lib = await createCore({ sync: true });   // our build embeds the engine binary
const totals = { prompts: new Map(), events: new Map(), wins: [0, 0], draws: 0, stuck: 0, stops: new Map(), turns: [], ms: [], scriptErrors: new Map(), traces: new Map(), chainAsks: [0, 0], errorCards: new Map(), slowest: { ms: 0 }, decoder: new Map(), slowSteps: new Map(), profile: new Map() };
const deckStats = new Map(POOL.map(d => [d.name, { games: 0, wins: 0, losses: 0, draws: 0, stops: 0 }]));
const lastError = {}, profStack = [];
const msgName = t => ocgMessageTypeStrings.get(t) ?? `type_${t}`;

function playDuel(seed, DECKS){
  const PLAYERS = META || MINE ? DECKS.map(d => d.name) : ['Daniyal', 'Kaze'];
  const r = rng(seed), log = [], say = line => { if (!QUIET && GAMES === 1) console.log(line); log.push(line); if (RECORD) pending.push(line.trim()); };
  const handle = lib.createDuel({
    flags: OcgDuelMode.MODE_MR5 | OcgDuelMode.TCG_SEGOC_NONPUBLIC | OcgDuelMode.TCG_SEGOC_FIRSTTRIGGER,
    seed: [BigInt(seed) + 1n, BigInt(seed) * 7n + 3n, 0x9e3779b9n, BigInt(seed) ^ 0xabcdefn],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader: code => cards.get(code) ?? null,
    scriptReader: readScript,
    errorHandler: (type, text) => {
      if (text.startsWith('PT+ ')) { const [, kind, code] = text.split(' '); profStack.push([`${nameOf(+code)} (${kind})`, performance.now()]); return; }
      if (text === 'PT-') { const [k, t] = profStack.pop(); totals.profile.set(k, (totals.profile.get(k) || 0) + performance.now() - t); return; }
      if (text.startsWith('stack traceback')) {
        const card = text.match(/c(\d+)\.lua/), who = card ? nameOf(+card[1]) : '(shared script)';
        totals.errorCards.set(who, (totals.errorCards.get(who) || 0) + 1);
        if (!totals.traces.has(lastError.msg)) totals.traces.set(lastError.msg, text); return;
      }
      lastError.msg = text.split('\n')[0].slice(0, 160); totals.scriptErrors.set(lastError.msg, (totals.scriptErrors.get(lastError.msg) || 0) + 1);
    },
  });
  if (!handle) throw new Error('could not create the duel');
  for (const f of ['constant.lua', 'utility.lua']) lib.loadScript(handle, f, readScript(f));
  // DEBUG_PROFILE=1: count how often each card's condition/target checks run (finds combinatorial hotspots)
  if (process.env.DEBUG_PROFILE) lib.loadScript(handle, 'profile.lua', `
    local function wrap(kind, f, e)
      if type(f) ~= 'function' then return f end
      return function(...)
        -- Lua has no clock here, so JS times it: Debug.Message reaches our errorHandler synchronously
        Debug.Message('PT+ ' .. kind .. ' ' .. e:GetOwner():GetOriginalCode())
        local r = table.pack(f(...))
        Debug.Message('PT-')
        return table.unpack(r, 1, r.n)
      end
    end
    local sc, st = Effect.SetCondition, Effect.SetTarget
    function Effect.SetCondition(e, f) return sc(e, wrap('condition', f, e)) end
    function Effect.SetTarget(e, f) return st(e, wrap('target', f, e)) end
`);
  DECKS.forEach((deck, team) => {
    // the engine doesn't shuffle at the start (EDOPro's host does), so shuffle here from the duel's seed
    const main = [...deck.main];
    for (let i = main.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [main[i], main[j]] = [main[j], main[i]]; }
    for (const code of main) lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
    for (const code of deck.extra) lib.duelNewCard(handle, { team, duelist: 0, code, controller: team, location: OcgLocation.EXTRA, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
  });

  const t0 = performance.now(), lp = [8000, 8000], state = [{ acts: 0, attacks: 0 }, { acts: 0, attacks: 0 }];
  let turn = 0, winner = null, responses = 0, lastPrompt = null, tries = 0, badPrompt = null, lastActivated = null;
  const who = p => PLAYERS[p];
  // ---- replay recording: one frame per engine step, with a full board snapshot ----
  const frames = [], chain = [];
  let pending = [], attack = null, damage = [], phase = 'DP', turnPlayer = 0, highlight = [];
  const QF = OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE | OcgQueryFlags.OVERLAY_CARD | OcgQueryFlags.TYPE;
  const PHASES = { [OcgPhase.DRAW]: 'DP', [OcgPhase.STANDBY]: 'SP', [OcgPhase.MAIN1]: 'M1', [OcgPhase.BATTLE_START]: 'BP', [OcgPhase.BATTLE_STEP]: 'BP',
    [OcgPhase.DAMAGE]: 'BP', [OcgPhase.DAMAGE_CAL]: 'BP', [OcgPhase.BATTLE]: 'BP', [OcgPhase.MAIN2]: 'M2', [OcgPhase.END]: 'EP' };
  const zoneOf = l => ({ p: l.controller, loc: l.location === OcgLocation.MZONE ? 'm' : l.location === OcgLocation.SZONE ? 's' : l.location === OcgLocation.HAND ? 'hand' : 'other', seq: l.sequence });
  function snapshot(){
    const side = p => {
      const q = location => lib.duelQueryLocation(handle, { flags: QF, controller: p, location });
      const card = c => c && c.code ? [c.code, c.position, c.attack ?? null, c.defense ?? null, c.overlayCards?.length || 0, c.type ?? 0] : null;
      return { lp: Math.max(lp[p], 0), hand: q(OcgLocation.HAND).map(c => c?.code ?? 0), m: q(OcgLocation.MZONE).map(card), s: q(OcgLocation.SZONE).map(card),
        gy: q(OcgLocation.GRAVE).map(c => c?.code ?? 0), ban: q(OcgLocation.REMOVED).map(c => [c?.code ?? 0, c?.position ?? 1]),
        deck: lib.duelQueryCount(handle, p, OcgLocation.DECK), extra: lib.duelQueryCount(handle, p, OcgLocation.EXTRA),
        // contents for the replay's pile viewer (deck listed top card first; extra with position, face-up = Pendulum)
        dk: q(OcgLocation.DECK).map(c => c?.code ?? 0).reverse(), ex: q(OcgLocation.EXTRA).map(c => [c?.code ?? 0, c?.position ?? 0]) };
    };
    return [side(0), side(1)];
  }
  function frame(){
    if (!RECORD) return;
    const board = snapshot(), key = JSON.stringify([board, phase, turn]);   // phase changes get a frame too
    if (!pending.length && !attack && frames.length && frames[frames.length - 1].key === key) return;   // nothing visible changed
    frames.push({ key, turn, turnPlayer, phase, lines: pending, attack, chain: chain.map(c => ({ ...c })), damage, highlight, board });
    pending = []; attack = null; damage = []; highlight = [];
  }
  const codeAt = loc => lib.duelQuery(handle, { flags: OcgQueryFlags.CODE, controller: loc.controller, location: loc.location, sequence: loc.sequence, overlaySequence: 0 })?.code;
  lib.startDuel(handle);
  say(META || MINE ? `${PLAYERS[0]} vs ${PLAYERS[1]} · seed ${seed}` : `${PLAYERS[0]} (${DECKS[0].name}) vs ${PLAYERS[1]} (${DECKS[1].name}) · seed ${seed}`);

  while (true) {
    const s0 = performance.now(), status = lib.duelProcess(handle), stepMs = performance.now() - s0;
    if (stepMs > totals.slowest.ms) totals.slowest = { ms: stepMs, seed, decks: PLAYERS.join(' vs '), turn };
    if (stepMs > 500 && process.env.DEBUG_SLOW) {
      const n = (p, loc) => lib.duelQueryCount(handle, p, loc);
      console.log(`slow step ${stepMs.toFixed(0)} ms on turn ${turn} after ${lastActivated}: ` + [0, 1].map(p => `${PLAYERS[p]} hand ${n(p, OcgLocation.HAND)} field ${n(p, OcgLocation.MZONE) + n(p, OcgLocation.SZONE)} GY ${n(p, OcgLocation.GRAVE)} banished ${n(p, OcgLocation.REMOVED)} extra ${n(p, OcgLocation.EXTRA)}`).join(' | '));
    }
    if (stepMs > 100) { const k = `${lastActivated ?? '(no activation yet)'} → then ${msgName(lastPrompt?.type)}`; totals.slowSteps.set(k, (totals.slowSteps.get(k) || 0) + stepMs); }
    for (const m of lib.duelGetMessage(handle)) {
      const T = OcgMessageType, name = msgName(m.type);
      totals.events.set(name, (totals.events.get(name) || 0) + 1);
      if (PROMPTS.has(m.type)) { lastPrompt = m; tries = 0; totals.prompts.set(name, (totals.prompts.get(name) || 0) + 1); }
      if (m.type === T.SELECT_CHAIN) totals.chainAsks[m.selects.length ? 1 : 0]++;   // [nothing to activate, has options]
      if (m.type === T.RETRY) tries++;   // last answer was invalid: answer the same prompt differently
      if (m.type === -1) {   // our wrapper patch: a decoder whose layout doesn't match the engine
        const k = `${msgName(m.failedType)}: ${m.problem.replace(/\d+/g, 'N')}`;
        totals.decoder.set(k, (totals.decoder.get(k) || 0) + 1);
        if (PROMPTS.has(m.failedType)) badPrompt = msgName(m.failedType);
      }
      switch (m.type) {
        case T.NEW_PHASE: phase = PHASES[m.phase] ?? phase; break;
        case T.NEW_TURN: turnPlayer = m.player; phase = 'DP'; turn++; state.forEach(s => { s.acts = 0; s.attacks = 0; }); say(`\n— Turn ${turn} · ${who(m.player)} · LP ${lp[0]} / ${lp[1]}`); break;
        case T.DRAW: say(`  ${who(m.player)} draws ${m.drawn.length}`); break;
        case T.SUMMONING: highlight.push(zoneOf(m)); say(`  ${who(m.controller)} Normal Summons ${nameOf(m.code)}`); break;
        case T.SPSUMMONING: highlight.push(zoneOf(m)); say(`  ${who(m.controller)} Special Summons ${nameOf(m.code)}`); break;
        case T.FLIPSUMMONING: say(`  ${who(m.controller)} Flip Summons ${nameOf(m.code)}`); break;
        case T.SET: say(`  ${who(m.controller)} Sets a card`); break;
        case T.CHAINING: lastActivated = nameOf(m.code); chain.push({ code: m.code, ...zoneOf(m) }); highlight.push(zoneOf(m)); say(`  ${who(m.controller)} activates ${nameOf(m.code)}${m.chain_size > 1 ? ` (chain link ${m.chain_size})` : ''}`); break;
        case T.CHAIN_NEGATED: say(`  chain link ${m.chain_size} negated`); break;
        case T.CHAIN_END: chain.length = 0; break;
        case T.ATTACK: { attack = { from: zoneOf(m.card), to: m.target ? zoneOf(m.target) : null }; const a = codeAt(m.card), d = m.target && codeAt(m.target); say(`  ${nameOf(a)} attacks ${d ? nameOf(d) : 'directly'}`); break; }
        case T.DAMAGE: damage.push({ p: m.player, amount: m.amount }); lp[m.player] -= m.amount; say(`  ${who(m.player)} takes ${m.amount} damage → ${Math.max(lp[m.player], 0)} LP`); break;
        case T.PAY_LPCOST: damage.push({ p: m.player, amount: m.amount, cost: true }); lp[m.player] -= m.amount; say(`  ${who(m.player)} pays ${m.amount} LP → ${lp[m.player]} LP`); break;
        case T.RECOVER: lp[m.player] += m.amount; say(`  ${who(m.player)} gains ${m.amount} LP`); break;
        case T.LPUPDATE: lp[m.player] = m.lp; break;
        case T.MOVE:
          if (m.to.location === OcgLocation.GRAVE && (m.from.location & OcgLocation.ONFIELD)) say(`  ${nameOf(m.card)} goes to the GY`);
          if (m.to.location === OcgLocation.REMOVED && (m.from.location & OcgLocation.ONFIELD)) say(`  ${nameOf(m.card)} is banished`);
          break;
        case T.WIN: if (winner !== null) break; winner = m.player; say(`\n${m.player === 2 ? 'Draw' : who(m.player) + ' wins'} (turn ${turn}, LP ${Math.max(lp[0], 0)} / ${Math.max(lp[1], 0)})`); break;
      }
    }
    frame();
    if (status === OcgProcessResult.END || winner !== null) break;   // the host ends the duel once a winner is announced
    if (status === OcgProcessResult.CONTINUE) continue;
    if (badPrompt || ++responses > 20000 || turn > 60 || tries > 40) {
      const why = badPrompt ? `couldn't decode a ${badPrompt} prompt` : turn > 60 ? 'turn limit (60)' : responses > 20000 ? 'response limit' : 'bot kept giving invalid answers to ' + msgName(lastPrompt?.type);
      totals.stuck++; totals.stops.set(why, (totals.stops.get(why) || 0) + 1); say(`\nStopped: ${why}`); break;
    }
    const reply = decide(lastPrompt, r, state[lastPrompt.player] ?? state[0], tries);
    if (!reply) { totals.stuck++; say(`\nStopped: no handler for ${msgName(lastPrompt.type)}`); break; }
    lib.duelSetResponse(handle, reply);
  }
  if (RECORD) {
    frames.forEach(f => delete f.key);
    mkdirSync(path.dirname(path.resolve(RECORD)), { recursive: true });
    writeFileSync(path.resolve(RECORD), JSON.stringify({ players: PLAYERS, decks: DECKS.map(d => d.name), seed, winner, turns: turn, engine: 'ygopro-core ' + ((() => { try { return readFileSync(path.join(here, '../engine/ENGINE_COMMIT'), 'utf8').slice(0, 8); } catch { return ''; } })()), frames }));
    console.log(`\nReplay saved: ${RECORD} (${frames.length} frames)`);
  }
  lib.destroyDuel(handle);
  totals.ms.push(performance.now() - t0); totals.turns.push(turn);
  if (winner === 0 || winner === 1) totals.wins[winner]++; else if (winner === 2) totals.draws++;
  DECKS.forEach((d, i) => { const st = deckStats.get(d.name); st.games++; if (winner === i) st.wins++; else if (winner === 1 - i) st.losses++; else if (winner === 2) st.draws++; else st.stops++; });
  return { seed, winner, turn, log, PLAYERS };
}

const started = performance.now();
for (let g = 0; g < GAMES; g++) {
  // meta: every pairing in turn, swapping who goes first on each pass through the list
  const pair = META ? PAIRS[g % PAIRS.length] : POOL;
  const decks = Math.floor(g / PAIRS.length) % 2 ? [pair[1], pair[0]] : pair;
  const res = playDuel(FIRST_SEED + g, decks);
  if (GAMES > 1 && !QUIET) console.log(`seed ${res.seed}: ${res.winner === null ? 'stopped' : res.winner === 2 ? 'draw' : res.PLAYERS[res.winner] + ' wins'} on turn ${res.turn}`);
}

// ---------- summary ----------
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const finished = GAMES - totals.stuck;
console.log(`\n=== ${GAMES} duel${GAMES > 1 ? 's' : ''} between ${POOL.length} decks · ${finished} finished${totals.draws ? ` (${totals.draws} draws)` : ''}${totals.stuck ? ` · ${totals.stuck} stopped early` : ''} · ${((performance.now() - started) / 1000).toFixed(0)} s total`);
console.log(`average ${avg(totals.turns).toFixed(1)} turns, ${avg(totals.ms).toFixed(0)} ms of engine time per duel (slowest duel ${Math.max(...totals.ms).toFixed(0)} ms)`);
console.log(`slowest single engine step: ${totals.slowest.ms.toFixed(1)} ms (${totals.slowest.decks}, seed ${totals.slowest.seed}, turn ${totals.slowest.turn})`);
console.log(`engine: ygopro-core ${(() => { try { return readFileSync(path.join(here, '../engine/ENGINE_COMMIT'), 'utf8').trim(); } catch { return 'npm build'; } })()} · cards in database: ${cards.size}`);
if (META) {
  console.log('\nDecks:');
  for (const d of POOL) {
    const st = deckStats.get(d.name);
    console.log(`  ${d.name.slice(0, 44).padEnd(45)} ${String(d.main.length).padStart(2)}+${String(d.extra.length).padEnd(2)} ${String(st.wins).padStart(3)}–${String(st.losses).padEnd(3)}${st.stops ? `  ${st.stops} stopped` : ''}${d.unknown.length ? `  unknown IDs: ${d.unknown.join(', ')}` : ''}`);
  }
} else console.log(`decks: ${POOL.map(d => `${d.name} ${d.main.length}+${d.extra.length}`).join(', ')} · ${POOL[0].name} ${totals.wins[0]} – ${totals.wins[1]} ${POOL[1].name}`);
console.log('\nPrompts the engine asked for (the UI must handle each):');

for (const [k, v] of [...totals.prompts].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);
console.log(`\nOther message types seen: ${[...totals.events.keys()].filter(k => !totals.prompts.has(k)).sort().join(', ')}`);
console.log(`\n"Respond?" prompts: ${totals.chainAsks[0]} with nothing to activate, ${totals.chainAsks[1]} with real options`);
if (missingScripts.size) console.log(`\nMissing scripts: ${[...missingScripts].join(', ')}`);
if (totals.stops.size) { console.log('\nWhy duels stopped early:'); for (const [k, v] of totals.stops) console.log(`  ${v}× ${k}`); }
if (totals.profile.size) { console.log('\nSlowest card checks (total ms; nested checks count inside their caller too):'); for (const [k, v] of [...totals.profile].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v.toFixed(0).padStart(8)} ms  ${k}`); }
if (totals.slowSteps.size) { console.log('\nEngine steps over 100 ms (total time, by the last card activated before it):'); for (const [k, v] of [...totals.slowSteps].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(v / 1000).toFixed(1).padStart(5)} s  ${k}`); }
if (totals.decoder.size) { console.log('\nDecoder mismatches (wrapper vs engine):'); for (const [k, v] of [...totals.decoder].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`); }
if (totals.errorCards.size) { console.log('\nCards whose scripts hit errors:'); for (const [k, v] of [...totals.errorCards].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`); }
if (totals.scriptErrors.size) { console.log('\nScript errors:'); for (const [k, v] of totals.scriptErrors) console.log(`  ${v}× ${k}\n${(totals.traces.get(k) || '').split('\n').slice(0, 6).map(l => '      ' + l).join('\n')}`); }
