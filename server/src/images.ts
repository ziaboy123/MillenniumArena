// Card pictures, re-hosted. YGOPRODeck asks sites not to hotlink its images but to download and serve their own
// copies. So each picture is fetched from YGOPRODeck the first time anyone needs it, saved under images/ (or
// ARENA_IMAGES), and served from here from then on with a year-long cache. Only real card numbers are fetched, a
// few at a time, and a picture YGOPRODeck doesn't have isn't asked for again for an hour.
// DeckForge, on the same site, uses these too: <base>/img/{cards,small,cropped}/<card number>.jpg
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream';

const SOURCE: Record<string, string> = { cards: 'cards', small: 'cards_small', cropped: 'cards_cropped' };
const DIR = process.env.ARENA_IMAGES || path.resolve(import.meta.dirname, '../../images');
const MAX_BYTES = 4_000_000;
const PARALLEL = 4;

const missing = new Map<string, number>();            // "kind/code" → don't ask YGOPRODeck again until then
const fetching = new Map<string, Promise<boolean>>();  // one download per picture, however many people ask at once
let active = 0;
const queue: (() => void)[] = [];

/** Serves `/img/<kind>/<code>.jpg` (true if `rel` was one); `known` says whether a number is a real card. */
export async function serveImage(res: ServerResponse, rel: string, known: (code: number) => boolean): Promise<boolean> {
  const m = /^\/img\/(cards|small|cropped)\/(\d{1,10})\.jpg$/.exec(rel);
  if (!m) return false;
  const kind = m[1], code = Number(m[2]), file = path.join(DIR, kind, `${code}.jpg`);
  let size = await sizeOf(file);
  if (size === null && known(code) && await download(kind, code, file)) size = await sizeOf(file);
  if (size === null) {
    // not a card, or YGOPRODeck has no picture yet (brand-new cards): the page shows a card back and tries again later
    res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'public, max-age=3600' });
    res.end('No picture');
    return true;
  }
  if (res.destroyed) return true;   // the visitor went while we were fetching it: don't open the file
  res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': size, 'cache-control': 'public, max-age=31536000, immutable' });
  pipeline(createReadStream(file), res, () => {});   // closes the file if the visitor goes before it's all sent
  return true;
}

const sizeOf = (file: string) => stat(file).then(s => (s.isFile() && s.size > 0 ? s.size : null), () => null);

function download(kind: string, code: number, file: string): Promise<boolean> {
  const key = `${kind}/${code}`;
  if ((missing.get(key) ?? 0) > Date.now()) return Promise.resolve(false);
  let job = fetching.get(key);
  if (!job) {
    job = (async () => {
      if (active >= PARALLEL) await new Promise<void>(go => queue.push(go));
      active++;
      const tmp = `${file}.${process.pid}.part`;
      try {
        const res = await fetch(`https://images.ygoprodeck.com/images/${SOURCE[kind]}/${code}.jpg`, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'MillenniumArena (daniyalzia.co.uk)' } });
        const type = res.headers.get('content-type') ?? '', length = Number(res.headers.get('content-length') ?? 0);
        if (!res.ok || !type.startsWith('image/') || length > MAX_BYTES) { missing.set(key, Date.now() + 3600_000); return false; }
        const body = Buffer.from(await res.arrayBuffer());
        if (!body.length || body.length > MAX_BYTES) { missing.set(key, Date.now() + 3600_000); return false; }
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(tmp, body);
        await rename(tmp, file);   // whole pictures only: a half-written file is never served
        return true;
      } catch (e: any) {
        console.error(`card picture ${key}: ${e?.message ?? e}`);
        missing.set(key, Date.now() + 300_000);   // a network hiccup: try again in a few minutes
        await unlink(tmp).catch(() => {});
        return false;
      } finally {
        active--;
        queue.shift()?.();
        fetching.delete(key);
      }
    })();
    fetching.set(key, job);
  }
  return job;
}

// forget old "YGOPRODeck has no picture" notes now and then
setInterval(() => { const now = Date.now(); for (const [k, until] of missing) if (until < now) missing.delete(k); }, 600_000).unref();
