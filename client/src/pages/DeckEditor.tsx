// The deck editor: Main, Extra and Side Decks, card search, stats, test hands, .ydk import/export. Every change
// saves itself a moment later (to DeckForge's tables, so DeckForge sees it too); leaving the page saves at once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  baseCode, deckProblems, FORMAT_NAMES, LIMIT_NAMES, toYdk, ZONE_MAX, ZONES, type Banlist, type SavedDeck, type Zone,
} from '@arena/shared/decks';
import { api } from '../lib/api.ts';
import { allCards, bigImage, card, imageFallback, smallImage, type CardInfo } from '../lib/cards.ts';
import { isExtraCard, kindOf, limitOf, ruleCard, type Kind } from '../lib/decks.ts';
import { Link, navigate } from '../lib/router.tsx';
import { Page, useToast } from './common.tsx';
import { clearJustCreated, coverOf, ImportWindow, justCreated, message, useDeckRules } from './Decks.tsx';

const ZONE_NAMES: Record<Zone, string> = { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' };
const same = (a: number, b: number) => baseCode(a, ruleCard(a)) === baseCode(b, ruleCard(b));

export function DeckEditor({ id }: { id: string }) {
  const { rules, failed } = useDeckRules();
  const [deck, setDeck] = useState<SavedDeck | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  useEffect(() => { api<{ deck: SavedDeck }>('decks/get', { id }).then(r => setDeck(r.deck)).catch(e => setError(message(e))); }, [id]);

  if (error || failed) return <Page back="/home" className="center"><div className="panel auth"><h2>Can't open this deck</h2><p className="sub">{error || "Couldn't load the card data. Refresh to try again."}</p><button className="bigbtn" onClick={() => navigate('/decks')}>Back to Decks</button></div></Page>;
  if (!deck || !rules) return <Page back="/home" className="decks"><div className="loading">Opening your deck…</div></Page>;
  return <Editor initial={deck} banlist={rules.banlist} toast={toast} showToast={showToast} />;
}

function Editor({ initial, banlist, toast, showToast }: { initial: SavedDeck; banlist: Banlist | null; toast: React.ReactNode; showToast: (m: string) => void }) {
  const [deck, setDeck] = useState(initial);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [detail, setDetail] = useState<number | null>(null);
  const [pane, setPane] = useState<'search' | 'stats'>('search');
  const [overlay, setOverlay] = useState<'hand' | 'import' | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [pop, setPop] = useState<{ zone: Zone; index: number } | null>(null);
  const [drop, setDrop] = useState<Zone | null>(null);
  const history = useRef<SavedDeck[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const problems = useMemo(() => deckProblems(deck, ruleCard, banlist), [deck, banlist]);

  // ---------- saving: a moment after the last change, and at once when leaving ----------
  const latest = useRef(deck), version = useRef(0), saved = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const body = (d: SavedDeck) => ({ id: d.id, name: d.name.trim() || 'Untitled deck', cover: d.cover, main: d.main, extra: d.extra, side: d.side });
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const v = version.current;
    if (v === saved.current) return;
    try {
      await api('decks/save', body(latest.current));
      saved.current = Math.max(saved.current, v);
      if (version.current === v) setStatus('saved');
    } catch (e) { setStatus('error'); showToast(`Couldn't save: ${message(e)}`); }
  }, [showToast]);
  const change = (next: SavedDeck, remember = true) => {
    if (remember) history.current = [...history.current.slice(-49), latest.current];
    latest.current = next; version.current++;
    setDeck(next); setStatus('saving');
    clearTimeout(timer.current); timer.current = setTimeout(save, 700);
  };
  useEffect(() => {
    // closing the tab: send what's unsaved even as the page goes away
    const flush = () => {
      if (version.current === saved.current) return;
      fetch(`${import.meta.env.BASE_URL}api/decks/save`, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(latest.current)) });
      saved.current = version.current;
    };
    addEventListener('pagehide', flush);
    return () => { removeEventListener('pagehide', flush); save(); };   // leaving the editor in the app
  }, [save]);

  // a brand-new deck opens with its name selected, ready to type over
  useEffect(() => { if (justCreated === initial.id) { clearJustCreated(); nameInput.current?.select(); } }, [initial.id]);
  const undo = useCallback(() => { const prev = history.current.pop(); if (prev) change(prev, false); }, []);   // change only touches refs and setters
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOverlay(null); setShowProblems(false); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); undo(); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [undo]);

  // the problems list closes when you click anywhere else
  useEffect(() => {
    if (!showProblems) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.probwrap')) setShowProblems(false); };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [showProblems]);

  // ---------- changing the deck ----------
  const copiesOf = (code: number) => ZONES.reduce((n, z) => n + deck[z].filter(c => same(c, code)).length, 0);
  /** Puts a card next to its other copies in a zone (or at the end). */
  const insert = (list: number[], code: number) => { const at = list.lastIndexOf(code) + 1 || list.length; return { list: [...list.slice(0, at), code, ...list.slice(at)], at }; };
  const add = (code: number, toSide = false) => {
    const c = card(code);
    if (!c || c.frame === 'token') return;
    const zone: Zone = toSide ? 'side' : isExtraCard(c) ? 'extra' : 'main';
    const limit = limitOf(code, banlist, deck.format);
    if (limit === 0) return showToast(`${c.name} is Forbidden`);
    if (copiesOf(code) >= limit) return showToast(limit < 3 ? `${c.name} is ${LIMIT_NAMES[limit]}: ${limit} allowed` : `You already have 3 copies of ${c.name}`);
    if (deck[zone].length >= ZONE_MAX[zone]) return showToast(`The ${ZONE_NAMES[zone]} is full`);
    const { list, at } = insert(deck[zone], code);
    change({ ...deck, [zone]: list });
    setPop({ zone, index: at });
  };
  const remove = (zone: Zone, index: number) => change({ ...deck, [zone]: deck[zone].filter((_, i) => i !== index) });
  const move = (from: Zone, index: number, to: Zone) => {
    const code = deck[from][index], c = card(code);
    if (to !== 'side') to = c && isExtraCard(c) ? 'extra' : 'main';
    if (to === from) return;
    if (deck[to].length >= ZONE_MAX[to]) return showToast(`The ${ZONE_NAMES[to]} is full`);
    const { list, at } = insert(deck[to], code);
    change({ ...deck, [from]: deck[from].filter((_, i) => i !== index), [to]: list });
    setPop({ zone: to, index: at });
  };
  const sort = () => {
    const order: Record<Kind, number> = { monster: 0, spell: 1, trap: 2 };
    const frameRank = (c: CardInfo) => ['fusion', 'synchro', 'xyz', 'link'].findIndex(f => c.frame.startsWith(f));
    const by = (a: number, b: number) => {
      const x = card(a), y = card(b);
      if (!x || !y) return x ? -1 : y ? 1 : 0;
      return order[kindOf(x)] - order[kindOf(y)] || frameRank(x) - frameRank(y) || y.level - x.level || x.name.localeCompare(y.name) || a - b;
    };
    change({ ...deck, main: [...deck.main].sort(by), extra: [...deck.extra].sort(by), side: [...deck.side].sort(by) });
    showToast('Sorted: monsters, spells, traps');
  };
  const exportYdk = () => {
    const url = URL.createObjectURL(new Blob([toYdk(deck)], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${(deck.name.trim() || 'deck').replace(/[\\/:*?"<>|]+/g, ' ')}.ydk`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---------- drag and drop: from the search results, or between decks ----------
  type Drag = { code: number } | { zone: Zone; index: number };
  const onDragStart = (e: React.DragEvent, data: Drag) => { e.dataTransfer.setData('application/x-arena-card', JSON.stringify(data)); e.dataTransfer.effectAllowed = 'move'; };
  const zoneDrop = (zone: Zone) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('application/x-arena-card')) { e.preventDefault(); setDrop(zone); } },
    onDragLeave: () => setDrop(d => (d === zone ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDrop(null);
      try {
        const d: Drag = JSON.parse(e.dataTransfer.getData('application/x-arena-card'));
        if ('code' in d) add(d.code, zone === 'side'); else move(d.zone, d.index, zone);
      } catch {}
    },
  });

  const hover = (e: React.MouseEvent) => {
    const code = Number((e.target as HTMLElement).closest<HTMLElement>('[data-code]')?.dataset.code);
    if (code) setDetail(code);
  };
  const legal = !problems.length;
  const count = (z: Zone) => deck[z].length;
  const kinds = (k: Kind) => deck.main.filter(c => { const i = card(c); return i && kindOf(i) === k; }).length;
  const extraKinds = ['fusion', 'synchro', 'xyz', 'link'].map(f => [f, deck.extra.filter(c => card(c)?.frame.startsWith(f)).length] as const).filter(([, n]) => n)
    .map(([f, n]) => `${n} ${f === 'xyz' ? 'Xyz' : f[0].toUpperCase() + f.slice(1)}`).join(' · ');

  const mid = <>
    <Link to="/decks" className="tcrumb">← Decks</Link><span className="slash">/</span>
    <input ref={nameInput} className="dname" spellCheck={false} maxLength={60} value={deck.name} aria-label="Deck name"
      onChange={e => change({ ...deck, name: e.target.value }, false)} onBlur={() => { if (!deck.name.trim()) change({ ...deck, name: 'Untitled deck' }, false); }} />
    <div className="probwrap">
      <button className={`probs ${legal ? 'ok' : ''}`} onClick={() => !legal && setShowProblems(s => !s)}>
        {legal ? `Legal · ${FORMAT_NAMES[deck.format]}` : `Not legal · ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`}
      </button>
      {showProblems && !legal && <div className="panel probpop"><div className="eyebrow">{FORMAT_NAMES[deck.format]}{banlist ? ` · ${banlist.name} list` : ''}</div><ul>{problems.map(p => <li key={p.text}>{p.text}</li>)}</ul></div>}
    </div>
  </>;

  return (
    <Page back="/home" className="decks editing" mid={mid} over={<>
      {overlay === 'hand' && <TestHand main={deck.main} onClose={() => setOverlay(null)} />}
      {overlay === 'import' && <ImportWindow title={`Import into ${deck.name}`} button="Replace this deck's cards" note="It replaces this deck's cards (Undo brings them back)."
        onClose={() => setOverlay(null)}
        onImport={(lists, skipped) => {
          change({ ...deck, main: lists.main, extra: lists.extra, side: lists.side, name: deck.name === 'Untitled deck' && lists.name ? lists.name : deck.name });
          showToast(`Imported ${lists.main.length + lists.extra.length + lists.side.length} cards${skipped ? ` · ${skipped} left out (unknown, or over 3 copies)` : ''}`);
        }} />}
      {toast}
    </>}>
      <div className="editor" onMouseOver={hover}>
        <CardDetail code={detail} banlist={banlist} deck={deck} onCover={code => { change({ ...deck, cover: code }); showToast('Cover changed'); }} />

        <div className="ecol">
          <div className="etools">
            <span className="hint">Click to remove · right-click for Side · drag to move</span>
            <span className={`saved ${status}`}><i /><span>{status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : 'All changes saved'}</span></span>
            <button className="sbtn" disabled={!history.current.length} onClick={undo} title="Undo (⌘Z)">Undo</button>
            <button className="sbtn" onClick={sort}>Sort</button>
            <button className="sbtn" onClick={() => (deck.main.length < 5 ? showToast('Add at least 5 cards to the Main Deck first') : setOverlay('hand'))}>Test hand</button>
            <button className="sbtn" onClick={() => setOverlay('import')}>Import</button>
            <button className="sbtn" onClick={exportYdk}>Export .ydk</button>
          </div>
          <div className="panel zones">
            {ZONES.map(z => (
              <div key={z} className="zone-block">
                <div className="zh">
                  <b>{ZONE_NAMES[z]}</b>
                  <span className={`n ${(z === 'main' ? count(z) < 40 || count(z) > 60 : count(z) > 15) ? 'bad' : ''}`}>{z === 'main' ? count(z) : `${count(z)} / 15`}</span>
                  <span className="sub">{z === 'main' ? `${kinds('monster')} monsters · ${kinds('spell')} spells · ${kinds('trap')} traps` : z === 'extra' ? extraKinds : ''}</span>
                </div>
                <div className={`zgrid ${z} ${drop === z ? 'drop' : ''}`} {...zoneDrop(z)}>
                  {deck[z].map((code, i) => (
                    <DeckCard key={`${i}-${code}`} code={code} limit={limitOf(code, banlist, deck.format)} pop={pop?.zone === z && pop.index === i}
                      onClick={() => remove(z, i)} onContext={e => { e.preventDefault(); move(z, i, z === 'side' ? 'main' : 'side'); }}
                      onDragStart={e => onDragStart(e, { zone: z, index: i })} />
                  ))}
                  {!deck[z].length && <div className="zempty">{z === 'main' ? 'Search for cards on the right and click to add them.' : z === 'extra' ? 'Fusion, Synchro, Xyz and Link Monsters go here.' : 'Right-click a card to put it in the Side Deck.'}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel sidep">
          <div className="seg"><button className={pane === 'search' ? 'on' : ''} onClick={() => setPane('search')}>Card search</button><button className={pane === 'stats' ? 'on' : ''} onClick={() => setPane('stats')}>Stats</button></div>
          {pane === 'search'
            ? <Search banlist={banlist} deck={deck} copiesOf={copiesOf} onAdd={add} onDragStart={onDragStart} />
            : <Stats main={deck.main} />}
        </div>
      </div>
    </Page>
  );
}

function LimitBadge({ limit }: { limit: number }) {
  return limit === 0 ? <span className="lim f">✕</span> : limit === 1 ? <span className="lim">1</span> : limit === 2 ? <span className="lim s">2</span> : null;
}

function DeckCard({ code, limit, pop, onClick, onContext, onDragStart }: {
  code: number; limit: number; pop: boolean; onClick: () => void; onContext: (e: React.MouseEvent) => void; onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div className={`dc ${pop ? 'pop' : ''}`} data-code={code} draggable onClick={onClick} onContextMenu={onContext} onDragStart={onDragStart}>
      <span className="ph">{card(code)?.name ?? `Unknown card #${code}`}</span>
      <img src={smallImage(code)} alt="" loading="lazy" decoding="async" onError={e => imageFallback(e, code)} />
      <LimitBadge limit={limit} />
    </div>
  );
}

function CardDetail({ code, banlist, deck, onCover }: { code: number | null; banlist: Banlist | null; deck: SavedDeck; onCover: (code: number) => void }) {
  const c = code ? card(code) : undefined;
  if (!code || !c) return <div className="panel cdetail"><div className="empty">Hover any card to see it here.</div></div>;
  const limit = limitOf(code, banlist, deck.format);
  const meta = kindOf(c) === 'monster'
    ? [c.attribute, c.frame.startsWith('link') ? `Link ${c.level}` : c.frame.startsWith('xyz') ? `Rank ${c.level}` : `Level ${c.level}`, c.typeLine].filter(Boolean).join(' · ')
    : c.typeLine;
  const inDeck = ZONES.some(z => deck[z].includes(code)), isCover = coverOf(deck) === code;
  return (
    <div className="panel cdetail">
      <div className="img"><img src={bigImage(code)} alt="" onError={e => imageFallback(e, code)} /></div>
      <div className="dtext">
        <h2>{c.name}</h2>
        <div className="meta">{meta}</div>
        <div className="chips">
          {limit < 3 && <span className="banchip">{LIMIT_NAMES[limit]} in the TCG</span>}
          {!((c.ot & 0x2) && !(c.ot & 0x100)) && <span className="banchip">Not in the TCG</span>}
        </div>
        {c.atk !== null && <div className="st"><div><span>ATK</span>{c.atk}</div>{c.def !== null && <div><span>DEF</span>{c.def}</div>}</div>}
        <p>{c.text}</p>
        {inDeck && !isCover && <button className="sbtn cover" onClick={() => onCover(code)}>Use as the deck's cover</button>}
      </div>
    </div>
  );
}

type Filter = 'all' | 'monster' | 'spell' | 'trap' | 'extra';
const FILTERS: [Filter, string][] = [['all', 'All'], ['monster', 'Monsters'], ['spell', 'Spells'], ['trap', 'Traps'], ['extra', 'Extra Deck']];
const passes = (c: CardInfo, f: Filter) => f === 'all' || (f === 'extra' ? isExtraCard(c) : kindOf(c) === f && !(f === 'monster' && isExtraCard(c)));

function Search({ banlist, deck, copiesOf, onAdd, onDragStart }: {
  banlist: Banlist | null; deck: SavedDeck; copiesOf: (code: number) => number; onAdd: (code: number, side?: boolean) => void;
  onDragStart: (e: React.DragEvent, d: { code: number }) => void;
}) {
  const [q, setQ] = useState(''), [filter, setFilter] = useState<Filter>('all');
  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (needle.length < 2) return [];
    // exact name, then names starting with it, then a word starting with it, then anywhere; shorter names first
    const found: [number, CardInfo][] = [];
    for (const c of allCards()) {
      if (c.frame === 'token' || (c.alias && Math.abs(c.alias - c.code) < 20) || !passes(c, filter)) continue;   // no tokens or alternate artworks
      const name = c.name.toLowerCase();
      const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(` ${needle}`) ? 2 : name.includes(needle) ? 3 : -1;
      if (rank >= 0) found.push([rank, c]);
    }
    found.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name));
    return found.slice(0, 80).map(([, c]) => c);
  }, [needle, filter]);
  return (
    <div className="pane">
      <input className="sinput" placeholder="Search any card…" spellCheck={false} value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <div className="fchips">{FILTERS.map(([k, label]) => <button key={k} className={`fchip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>)}</div>
      <div className="rhint">Click to add · right-click to add to Side · or drag into a deck</div>
      <div className="results">
        {needle.length < 2 ? <div className="empty-note">Type at least 2 letters to search every card.</div>
          : !results.length ? <div className="empty-note">No cards match "{q.trim()}".</div>
          : results.map(c => {
            const have = copiesOf(c.code);
            return (
              <div key={c.code} className="rc" data-code={c.code} draggable onDragStart={e => onDragStart(e, { code: c.code })}
                onClick={() => onAdd(c.code)} onContextMenu={e => { e.preventDefault(); onAdd(c.code, true); }}>
                <span className="ph">{c.name}</span>
                <img src={smallImage(c.code)} alt="" loading="lazy" decoding="async" onError={e => imageFallback(e, c.code)} />
                <LimitBadge limit={limitOf(c.code, banlist, deck.format)} />
                {have > 0 && <span className="have">×{have}</span>}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const choose = (n: number, k: number) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
/** The chance at least one of `copies` is in an opening hand of `hand` cards. */
const openOdds = (deckSize: number, copies: number, hand = 5) => 1 - choose(deckSize - copies, hand) / choose(deckSize, hand);

function Stats({ main }: { main: number[] }) {
  const n = main.length;
  if (!n) return <div className="pane"><div className="empty-note">Add cards to your Main Deck to see stats.</div></div>;
  const k = (t: Kind) => main.filter(c => { const i = card(c); return i && kindOf(i) === t; }).length;
  const counts = new Map<number, number>();
  for (const c of main) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || (card(a[0])?.name ?? '').localeCompare(card(b[0])?.name ?? '')).slice(0, 8);
  const pct = (x: number) => (x / n) * 100;
  return (
    <div className="pane stats-pane">
      <div className="stat-block"><h4>Main Deck · {n} cards</h4>
        <div className="bar3"><i style={{ width: `${pct(k('monster'))}%`, background: '#c8873a' }} /><i style={{ width: `${pct(k('spell'))}%`, background: '#1d9e74' }} /><i style={{ width: `${pct(k('trap'))}%`, background: '#b0306b' }} /></div>
        <div className="legend"><span style={{ ['--c' as string]: '#c8873a' }}>Monsters <b>{k('monster')}</b></span><span style={{ ['--c' as string]: '#1d9e74' }}>Spells <b>{k('spell')}</b></span><span style={{ ['--c' as string]: '#b0306b' }}>Traps <b>{k('trap')}</b></span></div>
      </div>
      <div className="stat-block"><h4>Chance to open with it · 5-card hand</h4>
        <div className="odds">
          {top.map(([code, copies]) => {
            const p = openOdds(n, copies);
            return (
              <div key={code} className="odd" data-code={code}>
                <img src={smallImage(code)} alt="" onError={e => imageFallback(e, code)} />
                <div>{card(code)?.name ?? `#${code}`} <span className="x">×{copies}</span><div className="track"><i style={{ width: `${p * 100}%` }} /></div></div>
                <b>{(p * 100).toFixed(1)}%</b>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TestHand({ main, onClose }: { main: number[]; onClose: () => void }) {
  const deal = () => {
    const pile = [...main];
    for (let i = pile.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pile[i], pile[j]] = [pile[j], pile[i]]; }
    return { hand: pile.slice(0, 5), pile: pile.slice(5) };
  };
  const [state, setState] = useState(deal);
  const draw = () => setState(s => (s.pile.length && s.hand.length < 10 ? { hand: [...s.hand, s.pile[0]], pile: s.pile.slice(1) } : s));
  return (
    <div className="overlay on" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="panel modal">
        <div className="eyebrow">Test hand · going first</div><h3>Your opening hand</h3>
        <div className="thand">{state.hand.map((code, i) => (
          <div key={`${i}-${code}`} className="dc pop" style={{ animationDelay: `${Math.min(i, 4) * 60}ms` }}><img src={smallImage(code)} alt={card(code)?.name ?? ''} onError={e => imageFallback(e, code)} /></div>
        ))}</div>
        <div className="line"><button className="bigbtn sm" onClick={() => setState(deal())}>New hand</button><button className="bigbtn ghost sm" disabled={!state.pile.length || state.hand.length >= 10} onClick={draw}>Draw 1</button><button className="bigbtn ghost sm" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
