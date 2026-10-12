// Which card names may be declared for a "declare a card name" prompt. A port of the engine's own check
// (is_declarable in ygopro-core's playerop.cpp), so the list we offer is exactly what the engine accepts.
// The prompt carries a small stack program (opcodes) that filters cards by code, type, Type, Attribute or archetype.
import type { EngineCard } from '../cards.ts';

const OP = {
  ADD: 0x4000000000000000n, SUB: 0x4000000100000000n, MUL: 0x4000000200000000n, DIV: 0x4000000300000000n,
  AND: 0x4000000400000000n, OR: 0x4000000500000000n, NEG: 0x4000000600000000n, NOT: 0x4000000700000000n,
  BAND: 0x4000000800000000n, BOR: 0x4000000900000000n, BNOT: 0x4000001000000000n, BXOR: 0x4000001100000000n,
  LSHIFT: 0x4000001200000000n, RSHIFT: 0x4000001300000000n, ALLOW_ALIASES: 0x4000001400000000n, ALLOW_TOKENS: 0x4000001500000000n,
  ISCODE: 0x4000010000000000n, ISSETCARD: 0x4000010100000000n, ISTYPE: 0x4000010200000000n, ISRACE: 0x4000010300000000n,
  ISATTRIBUTE: 0x4000010400000000n, GETCODE: 0x4000010500000000n, GETTYPE: 0x4000010700000000n, GETRACE: 0x4000010800000000n,
  GETATTRIBUTE: 0x4000010900000000n,
} as const;
const TYPE_MONSTER = 0x1, TYPE_TOKEN = 0x4000;
const MARINE_DOLPHIN = 78734254, TWINKLE_MOSS = 13857930;   // the engine always allows these two
const i64 = (v: bigint) => BigInt.asIntN(64, v);

export function declarable(c: EngineCard, opcodes: bigint[]): boolean {
  const stack: bigint[] = [];
  let alias = false, token = false;
  const two = (f: (l: bigint, r: bigint) => bigint) => { if (stack.length >= 2) { const r = stack.pop()!, l = stack.pop()!; stack.push(i64(f(l, r))); } };
  const one = (f: (v: bigint) => bigint) => { if (stack.length >= 1) stack.push(i64(f(stack.pop()!))); };
  const bool = (b: boolean) => (b ? 1n : 0n);
  for (const raw of opcodes) {
    const op = BigInt.asUintN(64, BigInt(raw));
    switch (op) {
      case OP.ADD: two((l, r) => l + r); break;
      case OP.SUB: two((l, r) => l - r); break;
      case OP.MUL: two((l, r) => l * r); break;
      case OP.DIV: two((l, r) => (r === 0n ? 0n : l / r)); break;
      case OP.AND: two((l, r) => bool(l !== 0n && r !== 0n)); break;
      case OP.OR: two((l, r) => bool(l !== 0n || r !== 0n)); break;
      case OP.NEG: one(v => -v); break;
      case OP.NOT: one(v => bool(v === 0n)); break;
      case OP.BAND: two((l, r) => l & r); break;
      case OP.BOR: two((l, r) => l | r); break;
      case OP.BXOR: two((l, r) => l ^ r); break;
      case OP.BNOT: one(v => ~v); break;
      case OP.LSHIFT: two((l, r) => l << r); break;
      case OP.RSHIFT: two((l, r) => l >> r); break;
      case OP.ISCODE: one(v => bool(BigInt(c.code) === BigInt.asUintN(32, v))); break;
      case OP.ISTYPE: one(v => BigInt(c.type) & v); break;
      case OP.ISRACE: one(v => c.race & v); break;
      case OP.ISATTRIBUTE: one(v => BigInt(c.attribute) & v); break;
      case OP.ISSETCARD: one(v => {
        const set = Number(BigInt.asIntN(32, v)), type = set & 0xfff, sub = set & 0xf000;
        return bool(c.setcodes.some(sc => (sc & 0xfff) === type && (sc & 0xf000 & sub) === sub));
      }); break;
      case OP.GETCODE: stack.push(BigInt(c.code)); break;
      case OP.GETTYPE: stack.push(BigInt(c.type)); break;
      case OP.GETRACE: stack.push(c.race); break;
      case OP.GETATTRIBUTE: stack.push(BigInt(c.attribute)); break;
      case OP.ALLOW_ALIASES: alias = true; break;
      case OP.ALLOW_TOKENS: token = true; break;
      default: stack.push(i64(op));
    }
  }
  if (stack.length !== 1 || stack[0] === 0n) return false;
  return c.code === MARINE_DOLPHIN || c.code === TWINKLE_MOSS
    || ((alias || !c.alias) && (token || (c.type & (TYPE_MONSTER | TYPE_TOKEN)) !== (TYPE_MONSTER | TYPE_TOKEN)));
}

/** Every card that may be declared, by code. */
export const declarableCodes = (cards: Map<number, EngineCard>, opcodes: bigint[]) =>
  [...cards.values()].filter(c => declarable(c, opcodes)).map(c => c.code);
