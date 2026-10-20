// Card names, text and stats, loaded once from the server (the same card database the engine uses).
import { useEffect, useState } from 'react';
import type { CardRow } from '@arena/shared';

export interface CardInfo { code: number; name: string; alias: number; frame: string; typeLine: string; attribute: string; level: number; atk: number | null; def: number | null; text: string; ot: number }

const cards = new Map<number, CardInfo>();
/** Brand-new cards come under their official numbers; duels use Project Ignis's temporary ones, which lead here. */
const byEngine = new Map<number, CardInfo>();
let loading: Promise<void> | null = null;

export function loadCards(): Promise<void> {
  return (loading ??= fetch(`${import.meta.env.BASE_URL}api/cards`)
    .then(r => { if (!r.ok) throw new Error(`card data: ${r.status}`); return r.json() as Promise<CardRow[]>; })
    .then(rows => {
      for (const [code, name, alias, frame, typeLine, attribute, level, atk, def, text, ot, engine] of rows) {
        const info: CardInfo = { code, name, alias, frame, typeLine, attribute, level, atk: atk < 0 ? null : atk, def: def < 0 ? null : def, text, ot: ot ?? 3 };   // 3 (released everywhere) if an older cached list has no ot
        cards.set(code, info);
        if (engine) byEngine.set(engine, info);
      }
    }));
}

export const card = (code: number) => cards.get(code) ?? byEngine.get(code);
/** Every card, for searching by name. */
export const allCards = () => cards.values();
export const cardName = (code: number) => card(code)?.name ?? `#${code}`;

// Card pictures are YGOPRODeck's, re-hosted by our own server (server/src/images.ts), never loaded from YGOPRODeck
// directly. Alternate artworks without a picture of their own fall back to the original card.
const IMAGES = `${import.meta.env.BASE_URL}img`;
/** YGOPRODeck knows brand-new cards only by their official numbers. */
const imageCode = (code: number) => byEngine.get(code)?.code ?? code;
export const smallImage = (code: number) => `${IMAGES}/small/${imageCode(code)}.jpg`;
export const bigImage = (code: number) => `${IMAGES}/cards/${imageCode(code)}.jpg`;
export function imageFallback(e: React.SyntheticEvent<HTMLImageElement>, code: number) {
  const alias = card(code)?.alias;
  const img = e.currentTarget;
  if (alias && !img.dataset.fallback) { img.dataset.fallback = '1'; img.src = img.src.replace(String(imageCode(code)), String(alias)); }
}
/** A card's big picture for the detail panels. A new card's picture is loaded in the background and only shown once it
 *  has arrived, so the previous one stays meanwhile instead of the panel going blank; alternate artworks without a
 *  picture of their own get the original card's. */
export function useBigImage(code: number | null): string | null {
  const [shown, setShown] = useState<string | null>(code ? bigImage(code) : null);
  useEffect(() => {
    if (!code) return;
    let current = true;
    const load = (url: string, otherwise?: string) => {
      const img = new Image();
      img.onload = () => { if (current) setShown(url); };
      img.onerror = () => { if (current && otherwise) load(otherwise); };
      img.src = url;
    };
    const alias = card(code)?.alias;
    load(bigImage(code), alias ? bigImage(alias) : undefined);
    return () => { current = false; };
  }, [code]);
  return shown;
}
/** Just the artwork, cropped out of the card. */
export const cropImage = (code: number) => `${IMAGES}/cropped/${imageCode(code)}.jpg`;
