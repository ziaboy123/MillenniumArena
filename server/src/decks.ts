// Decks from .ydk files: ours in server/decks, plus tournament decks downloaded into engine/data/decks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DeckSummary } from '@arena/shared';
import { DECK_DIRS } from './config.ts';
import type { EngineCard } from './cards.ts';

export interface Deck { id: string; name: string; main: number[]; extra: number[]; source: DeckSummary['source']; /** the card on its tile */ cover?: number | null }

export function parseYdk(text: string, fallbackName: string, cards: Map<number, EngineCard>) {
  const deck = { name: fallbackName, main: [] as number[], extra: [] as number[], unknown: [] as number[] };
  let zone: 'main' | 'extra' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#name ')) deck.name = line.slice(6).trim();
    else if (line === '#main') zone = 'main';
    else if (line === '#extra') zone = 'extra';
    else if (line === '!side') zone = null;
    else if (zone && /^\d+$/.test(line)) (cards.has(+line) ? deck[zone] : deck.unknown).push(+line);
  }
  return deck;
}

export function loadDecks(cards: Map<number, EngineCard>): Map<string, Deck> {
  const decks = new Map<string, Deck>();
  for (const [source, dir] of Object.entries(DECK_DIRS) as [Deck['source'], string][]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ydk')).sort()) {
      const id = `${source}/${path.basename(file, '.ydk')}`;
      const { name, main, extra } = parseYdk(readFileSync(path.join(dir, file), 'utf8'), path.basename(file, '.ydk').replace(/_/g, ' '), cards);
      decks.set(id, { id, name, main, extra, source });
    }
  }
  return decks;
}

export const summarise = (d: Deck): DeckSummary => ({ id: d.id, name: d.name, main: d.main.length, extra: d.extra.length, source: d.source });
