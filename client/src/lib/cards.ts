// Card names, text and stats, loaded once from the server (the same card database the engine uses).
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

// Artwork comes from YGOPRODeck for now (self-hosting images is a later step). Alternate artworks fall back to the original card.
const IMAGES = 'https://images.ygoprodeck.com/images';
/** YGOPRODeck knows brand-new cards only by their official numbers. */
const imageCode = (code: number) => byEngine.get(code)?.code ?? code;
export const smallImage = (code: number) => `${IMAGES}/cards_small/${imageCode(code)}.jpg`;
export const bigImage = (code: number) => `${IMAGES}/cards/${imageCode(code)}.jpg`;
export function imageFallback(e: React.SyntheticEvent<HTMLImageElement>, code: number) {
  const alias = card(code)?.alias;
  const img = e.currentTarget;
  if (alias && !img.dataset.fallback) { img.dataset.fallback = '1'; img.src = img.src.replace(String(imageCode(code)), String(alias)); }
}
/** Just the artwork, cropped out of the card. */
export const cropImage = (code: number) => `${IMAGES}/cards_cropped/${imageCode(code)}.jpg`;
