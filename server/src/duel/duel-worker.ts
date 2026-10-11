// Runs one duel in its own worker thread, so a slow card check (some cards search every material
// combination in the Deck) never stalls other duels. Posts a frame after every engine step.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import createCore, {
  OcgDuelMode, OcgLocation, OcgMessageType as M, OcgPhase, OcgPosition, OcgProcessResult, OcgQueryFlags,
} from 'ocgcore-wasm';
import type { Frame, Phase, Side, SideView, ZoneRef } from '@arena/shared';
import { loadCards } from '../cards.ts';
import { ENGINE_DATA } from '../config.ts';
import { PROMPTS, decide, rng, type BotState } from './bot.ts';

export interface WorkerInput {
  decks: [{ name: string; main: number[]; extra: number[] }, { name: string; main: number[]; extra: number[] }];
  players: [string, string];
  seed: number;
}
export type WorkerOutput =
  | { type: 'frame'; frame: Frame }
  | { type: 'end'; winner: Side | 2 | null; reason: string; turns: number }
  | { type: 'error'; message: string };

const input = workerData as WorkerInput;
const post = (msg: WorkerOutput) => parentPort!.postMessage(msg);

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
  input.decks.forEach((deck, team) => {
    const add = (code: number, location: number) => lib.duelNewCard(handle, { team: team as Side, duelist: 0, code, controller: team as Side, location, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
    deck.main.forEach(c => add(c, OcgLocation.DECK));
    deck.extra.forEach(c => add(c, OcgLocation.EXTRA));
  });

  const players = input.players, lp = [8000, 8000];
  const r = rng(input.seed), bots: BotState[] = [{ acts: 0, attacks: 0 }, { acts: 0, attacks: 0 }];
  const chain: (ZoneRef & { code: number })[] = [];
  let turn = 0, turnPlayer: Side = 0, phase: Phase = 'DP', winner: Side | 2 | null = null, step = 0;
  let lines: string[] = [], attack: Frame['attack'] = null, damage: Frame['damage'] = [], highlight: ZoneRef[] = [];
  let lastKey = '', lastPrompt: any = null, tries = 0, responses = 0;

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
    const board = snapshot(), key = JSON.stringify([board, phase, turn]);
    if (!lines.length && !attack && key === lastKey) return;   // nothing visible changed
    lastKey = key;
    post({ type: 'frame', frame: { step: step++, turn, turnPlayer, phase, lines, attack, chain: chain.map(c => ({ ...c })), damage, highlight, board } });
    lines = []; attack = null; damage = []; highlight = [];
  }
  const say = (s: string) => lines.push(s);

  lib.startDuel(handle);
  say(`${players[0]} (${input.decks[0].name}) vs ${players[1]} (${input.decks[1].name})`);

  while (true) {
    const status = lib.duelProcess(handle);
    for (const m of lib.duelGetMessage(handle) as any[]) {
      if (PROMPTS.has(m.type)) { lastPrompt = m; tries = 0; }
      if (m.type === M.RETRY) tries++;
      switch (m.type) {
        case M.NEW_PHASE: phase = PHASES[m.phase] ?? phase; break;
        case M.NEW_TURN: turn++; turnPlayer = m.player; phase = 'DP'; bots.forEach(b => { b.acts = 0; b.attacks = 0; }); say(`Turn ${turn} · ${players[m.player]}`); break;
        case M.DRAW: say(`${players[m.player]} draws ${m.drawn.length}`); break;
        case M.SUMMONING: highlight.push(zoneOf(m)); say(`${players[m.controller]} Normal Summons ${nameOf(m.code)}`); break;
        case M.SPSUMMONING: highlight.push(zoneOf(m)); say(`${players[m.controller]} Special Summons ${nameOf(m.code)}`); break;
        case M.FLIPSUMMONING: highlight.push(zoneOf(m)); say(`${players[m.controller]} Flip Summons ${nameOf(m.code)}`); break;
        case M.SET: say(`${players[m.controller]} Sets a card`); break;
        case M.CHAINING: chain.push({ code: m.code, ...zoneOf(m) }); highlight.push(zoneOf(m)); say(`${players[m.controller]} activates ${nameOf(m.code)}${m.chain_size > 1 ? ` (chain link ${m.chain_size})` : ''}`); break;
        case M.CHAIN_NEGATED: say(`Chain link ${m.chain_size} is negated`); break;
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
        case M.MOVE:
          if (m.to.location === OcgLocation.GRAVE && (m.from.location & OcgLocation.ONFIELD)) say(`${nameOf(m.card)} goes to the GY`);
          if (m.to.location === OcgLocation.REMOVED && (m.from.location & OcgLocation.ONFIELD)) say(`${nameOf(m.card)} is banished`);
          break;
        case M.WIN: if (winner === null) { winner = m.player; say(m.player === 2 ? 'The duel is a draw' : `${players[m.player]} wins`); } break;
      }
    }
    frame();
    if (status === OcgProcessResult.END || winner !== null) break;   // the host ends the duel once a winner is announced
    if (status === OcgProcessResult.CONTINUE) continue;
    if (++responses > 20000 || turn > 80 || tries > 40) { post({ type: 'end', winner: null, reason: 'The duel was stopped (it went on too long)', turns: turn }); return; }
    // Milestone 1: bots answer for both players. Milestone 2 will wait here for a human's answer instead.
    lib.duelSetResponse(handle, decide(lastPrompt, r, bots[lastPrompt.player] ?? bots[0], tries, cards));
  }
  lib.destroyDuel(handle);
  post({ type: 'end', winner, reason: winner === 2 ? 'Draw' : winner === null ? 'Ended' : `${players[winner]} wins`, turns: turn });
}

run().catch(err => post({ type: 'error', message: String(err?.message ?? err) }));
