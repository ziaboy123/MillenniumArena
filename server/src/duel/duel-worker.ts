// Runs one duel in its own worker thread, so a slow card check (some cards search every material
// combination in the Deck) never stalls other duels. Posts a frame after every engine step, and a prompt
// whenever a human player has to choose (the bot answers everything else).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import createCore, {
  OcgDuelMode, OcgHintType, OcgLocation, OcgMessageType as M, OcgPhase, OcgPosition, OcgProcessResult, OcgQueryFlags, OcgResponseType,
} from 'ocgcore-wasm';
import type { Frame, Phase, Prompt, PromptAnswer, Side, SideView, ZoneRef } from '@arena/shared';
import { loadCards } from '../cards.ts';
import { ENGINE_DATA } from '../config.ts';
import { victoryString } from '../strings.ts';
import { PROMPTS, decide, rng, shuffle, type BotState } from './bot.ts';
import { NOT_YET, describe, toPrompt, toResponse } from './prompts.ts';

export interface WorkerInput {
  decks: [{ name: string; main: number[]; extra: number[] }, { name: string; main: number[]; extra: number[] }];
  players: [string, string];
  /** Engine sides played by people; the bot plays the rest. Side 0 goes first. */
  humans: Side[];
  seed: number;
}
export type WorkerOutput =
  | { type: 'frame'; frame: Frame }
  | { type: 'prompt'; side: Side; prompt: Prompt }
  | { type: 'end'; winner: Side | 2 | null; reason: string; turns: number }
  | { type: 'error'; message: string };
export type WorkerCommand = { type: 'answer'; id: number; answer: PromptAnswer };

const input = workerData as WorkerInput;
const post = (msg: WorkerOutput) => parentPort!.postMessage(msg);

// a person's answer arrives from the room as a message; the duel loop waits for it
let waiting: { id: number; resolve: (a: PromptAnswer) => void } | null = null;
parentPort!.on('message', (msg: WorkerCommand) => {
  if (msg?.type === 'answer' && waiting && msg.id === waiting.id) { const w = waiting; waiting = null; w.resolve(msg.answer); }
});
const answerTo = (id: number) => new Promise<PromptAnswer>(resolve => { waiting = { id, resolve }; });

const cards = loadCards();
const nameOf = (code: number) => cards.get(code)?.name ?? `#${code}`;

// card scripts: official first, then pre-release (new sets), then older rulings and unofficial
const SCRIPTS = path.join(ENGINE_DATA, 'CardScripts');
const SCRIPT_DIRS = ['official', 'pre-release', 'pre-errata', 'unofficial'];
function readScript(name: string): string | null {
  const base = path.basename(name);
  const tries = /^c\d+\.lua$/.test(base) ? SCRIPT_DIRS.map(d => path.join(SCRIPTS, d, base))
    : [SCRIPTS, ...SCRIPT_DIRS.map(d => path.join(SCRIPTS, d))].map(d => path.join(d, base));
  for (const f of tries) if (existsSync(f)) return readFileSync(f, 'utf8');
  return null;   // Normal Monsters and tokens have no script
}

const PHASES: Record<number, Phase> = {
  [OcgPhase.DRAW]: 'DP', [OcgPhase.STANDBY]: 'SP', [OcgPhase.MAIN1]: 'M1', [OcgPhase.BATTLE_START]: 'BP', [OcgPhase.BATTLE_STEP]: 'BP',
  [OcgPhase.DAMAGE]: 'BP', [OcgPhase.DAMAGE_CAL]: 'BP', [OcgPhase.BATTLE]: 'BP', [OcgPhase.MAIN2]: 'M2', [OcgPhase.END]: 'EP',
};
const QF = OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE | OcgQueryFlags.OVERLAY_CARD | OcgQueryFlags.TYPE;

async function run() {
  const lib = await createCore({ sync: true });
  const handle = lib.createDuel({
    flags: OcgDuelMode.MODE_MR5 | OcgDuelMode.TCG_SEGOC_NONPUBLIC | OcgDuelMode.TCG_SEGOC_FIRSTTRIGGER,
    seed: [BigInt(input.seed) + 1n, BigInt(input.seed) * 7n + 3n, 0x9e3779b9n, BigInt(input.seed) ^ 0xabcdefn],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader: (code: number) => cards.get(code) ?? null,
    scriptReader: readScript,
    errorHandler: (_type: number, text: string) => { if (!text.startsWith('stack traceback')) console.warn(`[duel ${input.seed}] script: ${text.split('\n')[0]}`); },
  });
  if (!handle) throw new Error('the engine could not create the duel');
  for (const f of ['constant.lua', 'utility.lua']) lib.loadScript(handle, f, readScript(f)!);
  // the engine doesn't shuffle at the start (EDOPro's host does), so decks are shuffled here, from the duel's seed
  const shuffler = rng(input.seed ^ 0x5bd1e995);
  input.decks.forEach((deck, team) => {
    const add = (code: number, location: number) => lib.duelNewCard(handle, { team: team as Side, duelist: 0, code, controller: team as Side, location, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
    shuffle([...deck.main], shuffler).forEach(c => add(c, OcgLocation.DECK));
    deck.extra.forEach(c => add(c, OcgLocation.EXTRA));
  });

  const players = input.players, lp = [8000, 8000], humans = new Set(input.humans);
  const r = rng(input.seed), bots: BotState[] = [{ acts: 0, attacks: 0 }, { acts: 0, attacks: 0 }];
  const chain: (ZoneRef & { code: number })[] = [];
  let turn = 0, turnPlayer: Side = 0, phase: Phase = 'DP', winner: Side | 2 | null = null, winReason = '', step = 0;
  let lines: string[] = [], attack: Frame['attack'] = null, damage: Frame['damage'] = [], highlight: ZoneRef[] = [];
  let lastKey = '', lastPrompt: any = null, tries = 0, responses = 0, board: [SideView, SideView] | null = null, promptId = 0;
  const hints: [bigint, bigint] = [0n, 0n], lastCard = [0, 0];

  const zoneOf = (l: any): ZoneRef => ({ p: l.controller, loc: l.location === OcgLocation.MZONE ? 'm' : l.location === OcgLocation.SZONE ? 's' : l.location === OcgLocation.HAND ? 'hand' : 'other', seq: l.sequence });
  const codeAt = (l: any) => lib.duelQuery(handle, { flags: OcgQueryFlags.CODE, controller: l.controller, location: l.location, sequence: l.sequence, overlaySequence: 0 })?.code;

  function snapshot(): [SideView, SideView] {
    const side = (p: Side): SideView => {
      const q = (location: number) => lib.duelQueryLocation(handle, { flags: QF, controller: p, location }) as any[];
      const card = (c: any) => c && c.code ? [c.code, c.position, c.attack ?? null, c.defense ?? null, c.overlayCards?.length || 0, c.type ?? 0] as any : null;
      return {
        lp: Math.max(lp[p], 0), hand: q(OcgLocation.HAND).map(c => c?.code ?? 0), m: q(OcgLocation.MZONE).map(card), s: q(OcgLocation.SZONE).map(card),
        gy: q(OcgLocation.GRAVE).map(c => c?.code ?? 0), ban: q(OcgLocation.REMOVED).map(c => [c?.code ?? 0, c?.position ?? 1]),
        deck: lib.duelQueryCount(handle, p, OcgLocation.DECK), extra: lib.duelQueryCount(handle, p, OcgLocation.EXTRA),
        dk: q(OcgLocation.DECK).map(c => c?.code ?? 0).reverse(), ex: q(OcgLocation.EXTRA).map(c => [c?.code ?? 0, c?.position ?? 0]),
      };
    };
    return [side(0), side(1)];
  }
  function frame() {
    board = snapshot();
    const key = JSON.stringify([board, phase, turn, chain.length]);
    if (!lines.length && !attack && key === lastKey) return;   // nothing visible changed
    lastKey = key;
    post({ type: 'frame', frame: { step: step++, turn, turnPlayer, phase, lines, attack, chain: chain.map(c => ({ ...c })), damage, highlight, board } });
    lines = []; attack = null; damage = []; highlight = [];
  }
  const say = (s: string) => lines.push(s);

  /** Ask a person, and keep asking until the answer is one the prompt allows. */
  async function ask(m: any): Promise<any> {
    const p = m.player as Side;
    // most "respond?" moments offer nothing to activate: pass without asking
    if (m.type === M.SELECT_CHAIN && !m.selects.length && !m.forced) return { type: OcgResponseType.SELECT_CHAIN, index: null };
    const prompt = toPrompt(m, { cards, board: board ?? snapshot(), hint: m.selectHint ?? 0n, chainTop: chain.at(-1)?.code ?? 0, lastCard: lastCard[p] });
    if (!prompt) {
      say(`${players[p]}: ${NOT_YET[m.type] ?? 'a choice'} was picked automatically (this choice comes in a later update)`);
      frame();
      return decide(m, r, bots[p], tries, cards);
    }
    let retry = tries > 0;
    while (true) {
      const id = ++promptId;
      post({ type: 'prompt', side: p, prompt: { ...prompt, id, ...(retry ? { retry } : {}) } });
      const answer = await answerTo(id);
      const res = toResponse(m, answer);
      if (res) {
        const used = res.index ?? null;   // remember which card was used, for later prompt titles
        if (m.type === M.SELECT_IDLECMD && used !== null && answer.kind === 'idle') {
          const lists: Record<string, string> = { summon: 'summons', spsummon: 'special_summons', repos: 'pos_changes', mset: 'monster_sets', sset: 'spell_sets', activate: 'activates' };
          lastCard[p] = m[lists[answer.act]]?.[used]?.code ?? lastCard[p];
        } else if (m.type === M.SELECT_CHAIN && used !== null) lastCard[p] = m.selects[used].code;
        else if (m.type === M.SELECT_BATTLECMD && used !== null) lastCard[p] = (answer.kind === 'battle' && answer.act === 'attack' ? m.attacks : m.chains)[used]?.code ?? lastCard[p];
        return res;
      }
      retry = true;
    }
  }

  lib.startDuel(handle);
  say(`${players[0]} (${input.decks[0].name}) vs ${players[1]} (${input.decks[1].name})`);

  while (true) {
    const status = lib.duelProcess(handle);
    for (const m of lib.duelGetMessage(handle) as any[]) {
      if (PROMPTS.has(m.type)) { lastPrompt = m; tries = 0; m.selectHint = hints[m.player as Side]; hints[m.player as Side] = 0n; }   // the hint names what this prompt is for
      if (m.type === M.RETRY) tries++;
      switch (m.type) {
        case M.HINT:
          if (m.hint_type === OcgHintType.SELECTMSG) hints[m.player as Side] = BigInt(m.hint);
          // the engine isn't consistent about whose choice this was, so the line doesn't name anyone
          else if (m.hint_type === OcgHintType.OPSELECTED) { const t = describe(cards, m.hint); if (t) say(`Chosen: ${t}`); }
          break;
        case M.NEW_PHASE: phase = PHASES[m.phase] ?? phase; break;
        case M.NEW_TURN: turn++; turnPlayer = m.player; phase = 'DP'; bots.forEach(b => { b.acts = 0; b.attacks = 0; }); say(`Turn ${turn} · ${players[m.player]}`); break;
        case M.DRAW: say(`${players[m.player]} draws ${m.drawn.length}`); break;
        case M.SUMMONING: highlight.push(zoneOf(m)); say(`${players[m.controller]} Normal Summons ${nameOf(m.code)}`); break;
        case M.SPSUMMONING: highlight.push(zoneOf(m)); say(`${players[m.controller]} Special Summons ${nameOf(m.code)}`); break;
        case M.FLIPSUMMONING: highlight.push(zoneOf(m)); say(`${players[m.controller]} Flip Summons ${nameOf(m.code)}`); break;
        case M.SET: say(`${players[m.controller]} Sets a card`); break;
        case M.CHAINING: chain.push({ code: m.code, ...zoneOf(m) }); highlight.push(zoneOf(m)); say(`${players[m.controller]} activates ${nameOf(m.code)}${m.chain_size > 1 ? ` (chain link ${m.chain_size})` : ''}`); break;
        case M.CHAIN_NEGATED: say(`Chain link ${m.chain_size}'s activation is negated`); break;
        case M.CHAIN_DISABLED: say(`Chain link ${m.chain_size}'s effect is negated`); break;
        case M.CHAIN_END: chain.length = 0; break;
        case M.ATTACK: {
          attack = { from: zoneOf(m.card), to: m.target ? zoneOf(m.target) : null };
          const a = codeAt(m.card), d = m.target && codeAt(m.target);
          say(`${nameOf(a)} attacks ${d ? nameOf(d) : 'directly'}`);
          break;
        }
        case M.DAMAGE: damage.push({ p: m.player, amount: m.amount }); lp[m.player] -= m.amount; say(`${players[m.player]} takes ${m.amount} damage`); break;
        case M.PAY_LPCOST: damage.push({ p: m.player, amount: m.amount, cost: true }); lp[m.player] -= m.amount; say(`${players[m.player]} pays ${m.amount} LP`); break;
        case M.RECOVER: lp[m.player] += m.amount; say(`${players[m.player]} gains ${m.amount} LP`); break;
        case M.LPUPDATE: lp[m.player] = m.lp; break;
        case M.MOVE: {
          // only moves everyone can see are named (the log goes to both players): never a card going into a hand or Deck.
          // Xyz Materials are reported at their Xyz monster's location, with an overlay_sequence
          const from = m.from.location, to = m.to.location, L = OcgLocation;
          if (m.to.overlay_sequence !== undefined) break;   // becoming material: the summon line covers it
          const fromWhere = m.from.overlay_sequence !== undefined ? '' : from === L.DECK ? ' from the Deck' : from === L.HAND ? ' from the hand' : from === L.EXTRA ? ' from the Extra Deck' : '';
          if (to === L.GRAVE && from !== L.GRAVE) say(`${nameOf(m.card)} is sent to the GY${fromWhere}`);
          else if (to === L.REMOVED && from !== L.REMOVED) say(m.to.position & OcgPosition.FACEDOWN ? 'A card is banished face-down' : `${nameOf(m.card)} is banished${fromWhere}`);
          else if (to === L.HAND && from === L.DECK) say(`${players[m.to.controller]} adds a card from the Deck to their hand`);
          else if (to === L.HAND && (from === L.GRAVE || from === L.REMOVED || (from & L.ONFIELD))) say(`${nameOf(m.card)} returns to ${players[m.to.controller]}'s hand`);
          else if ((to === L.DECK || to === L.EXTRA) && (from === L.GRAVE || from === L.REMOVED || (from & L.ONFIELD))) say(`${nameOf(m.card)} returns to the ${to === L.DECK ? 'Deck' : 'Extra Deck'}`);
          break;
        }
        case M.CONFIRM_CARDS:
          // a player showing their own hand or Deck cards to the opponent (e.g. a searched card) is public;
          // a player privately looking at something (their Deck, a face-down card) isn't logged
          if (m.cards.length && m.cards.every((c: any) => c.controller !== m.player && (c.location === OcgLocation.HAND || c.location === OcgLocation.DECK))) say(`${players[m.cards[0].controller]} reveals ${m.cards.map((c: any) => nameOf(c.code)).join(', ')}`);
          break;
        case M.WIN: if (winner === null) { winner = m.player; winReason = victoryString(m.reason); say(m.player === 2 ? 'The duel is a draw' : `${players[m.player]} wins`); } break;
      }
    }
    frame();
    if (status === OcgProcessResult.END || winner !== null) break;   // the host ends the duel once a winner is announced
    if (status === OcgProcessResult.CONTINUE) continue;
    if (++responses > 20000 || turn > 80 || tries > 40) { post({ type: 'end', winner: null, reason: 'The duel was stopped (it went on too long)', turns: turn }); return; }
    const p = lastPrompt.player as Side;
    lib.duelSetResponse(handle, humans.has(p) ? await ask(lastPrompt) : decide(lastPrompt, r, bots[p] ?? bots[0], tries, cards));
  }
  lib.destroyDuel(handle);
  post({ type: 'end', winner, reason: winReason || (winner === 2 ? 'Draw' : winner === null ? 'Ended' : `${players[winner]} wins`), turns: turn });
}

run().catch(err => post({ type: 'error', message: String(err?.message ?? err) })).finally(() => parentPort!.unref());   // let the thread finish
