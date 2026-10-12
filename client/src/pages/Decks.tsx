// The Decks page: your decks (the same ones DeckForge shows), the "Dueling with" deck, and importing a .ydk.
// Public decks are a "coming soon" tab. Opening a deck goes to the editor (DeckEditor.tsx).
import { useEffect, useRef, useState } from 'react';
import { deckProblems, FORMAT_NAMES, parseYdk, ZONES, type Banlist, type DeckLists, type SavedDeck } from '@arena/shared/decks';
import { api, ApiError } from '../lib/api.ts';
import { card, cropImage, imageFallback, loadCards, smallImage } from '../lib/cards.ts';
import { isExtraCard, kindOf, loadBanlist, ruleCard } from '../lib/decks.ts';
import { navigate } from '../lib/router.tsx';
import { ago, Icon, Page, useToast } from './common.tsx';

export const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');
export type DeckData = { decks: SavedDeck[]; active: string | null };

/** The card on a deck's tile: its chosen cover, else its first monster, else its first card. */
export const coverOf = (d: DeckLists & { cover: number | null }) =>
  d.cover ?? d.main.find(c => { const i = card(c); return i && kindOf(i) === 'monster'; }) ?? d.main[0] ?? d.extra[0] ?? null;

/** Card data and the banlist, which every deck view needs before it can say what's legal. */
export function useDeckRules() {
  const [rules, setRules] = useState<{ banlist: Banlist | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { Promise.all([loadCards(), loadBanlist()]).then(([, banlist]) => setRules({ banlist })).catch(() => setFailed(true)); }, []);
  return { rules, failed };
}

/** The editor opens a deck made a moment ago with its name selected, ready to type over. */
export let justCreated: string | null = null;
export const clearJustCreated = () => { justCreated = null; };

export function DeckList() {
  const [data, setData] = useState<DeckData | null>(null);
  const [error, setError] = useState('');
  const { rules, failed } = useDeckRules();
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  useEffect(() => { api<DeckData>('decks/list').then(setData).catch(e => setError(message(e))); }, []);

  const create = async (body: Partial<SavedDeck> = {}) => {
    try {
      const { deck } = await api<{ deck: SavedDeck }>('decks/create', { name: 'Untitled deck', ...body });
      justCreated = body.name ? null : deck.id;
      navigate(`/decks/${deck.id}`);
    } catch (e) { showToast(message(e)); }
  };
  const act = async (e: React.MouseEvent, what: 'active' | 'duplicate' | 'delete', d: SavedDeck) => {
    e.stopPropagation();
    if (!data) return;
    try {
      if (what === 'active') {
        await api('decks/active', { id: d.id });
        setData({ ...data, active: d.id });
        showToast(`You'll duel with ${d.name}`);
      } else if (what === 'duplicate') {
        const { deck } = await api<{ deck: SavedDeck }>('decks/duplicate', { id: d.id });
        const at = data.decks.indexOf(d) + 1;
        setData({ ...data, decks: [...data.decks.slice(0, at), deck, ...data.decks.slice(at)] });
      } else {
        await api('decks/delete', { id: d.id });
        setData({ decks: data.decks.filter(x => x !== d), active: data.active === d.id ? null : data.active });
        setDeleting(null);
        showToast('Deck deleted');
      }
    } catch (x) { showToast(message(x)); }
  };

  const ready = data && rules;
  return (
    <Page back="/home" className="decks" over={<>
      {importing && <ImportWindow title="Import a .ydk as a new deck" button="Import"
        onImport={async lists => { await create({ ...lists, name: lists.name ?? 'Imported deck' }); }} onClose={() => setImporting(false)} />}
      {toast}
    </>}>
      <div className="dhead">
        <div className="head"><div className="eyebrow">Build</div><h1>Decks</h1></div>
        <div className="dbar">
          <div className="seg">
            <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My decks{data && <span className="n">{data.decks.length}</span>}</button>
            <button className={tab === 'public' ? 'on' : ''} onClick={() => setTab('public')}>Public decks<small>Soon</small></button>
          </div>
          <button className="bigbtn ghost sm" disabled={!ready} onClick={() => setImporting(true)}>Import .ydk</button>
          <button className="bigbtn sm" disabled={!data} onClick={() => create()}>New deck</button>
        </div>
      </div>

      {tab === 'public' ? (
        <div className="panel pubsoon">
          <div className="ico"><Icon name="globe" /></div>
          <h2>Public decks are coming soon</h2>
          <p>Share any of your decks publicly, browse what everyone else is playing, and copy a deck into your own list in one click.</p>
          <ul><li>Browse by archetype</li><li>Copy to my decks</li><li>See who made it</li></ul>
        </div>
      ) : error || failed ? <div className="loading bad">{error || "Couldn't load the card data. Refresh to try again."}</div>
        : !ready ? <div className="loading">Loading your decks…</div> : (
        <div className="dgrid">
          {data.decks.map(d => {
            const problems = deckProblems(d, ruleCard, rules.banlist), legal = !problems.length, cover = coverOf(d);
            return (
              <div key={d.id} className="panel dtile" onClick={() => navigate(`/decks/${d.id}`)}>
                <div className="cov">
                  {cover && <div className="art" style={{ backgroundImage: `url(${cropImage(cover)})` }} />}<div className="tint" /><div className="shade" />
                  {data.active === d.id && <span className="duelwith">Dueling with</span>}
                  <div className="acts">
                    <button className={data.active === d.id ? 'on' : ''} title="Duel with this deck" onClick={e => act(e, 'active', d)}><Icon name="star" /></button>
                    <button title="Duplicate" onClick={e => act(e, 'duplicate', d)}><Icon name="copy" /></button>
                    <button title="Delete" onClick={e => { e.stopPropagation(); setDeleting(d.id); }}><Icon name="trash" /></button>
                  </div>
                </div>
                <div className="bd">
                  <h3>{d.name}</h3>
                  <div className="meta"><span className={`legal ${legal ? 'ok' : 'bad'}`}>{legal ? 'Legal' : 'Not legal'}</span>{d.main.length} main · {d.extra.length} extra · {d.side.length} side</div>
                  <div className="meta clip">{legal ? FORMAT_NAMES[d.format] : problems[0].text} · edited {ago(d.updatedAt)}</div>
                  <div className="strip">{[...new Set(d.main)].slice(0, 7).map(c => <img key={c} src={smallImage(c)} alt="" loading="lazy" onError={e => imageFallback(e, c)} />)}</div>
                </div>
                {deleting === d.id && (
                  <div className="del" onClick={e => e.stopPropagation()}>
                    <p>Delete <b>{d.name}</b>?<br />It's deleted on DeckForge too, and can't be undone.</p>
                    <div className="line"><button className="sbtn danger" onClick={e => act(e, 'delete', d)}>Delete</button><button className="sbtn" onClick={() => setDeleting(null)}>Cancel</button></div>
                  </div>
                )}
              </div>
            );
          })}
          <div className="panel dtile new" onClick={() => create()}>
            <div className="ico"><Icon name="plus" /></div>
            <h3>New deck</h3>
            <p>Start from scratch, or import a .ydk from another sim.</p>
          </div>
        </div>
      )}
    </Page>
  );
}

/** Tidies an imported deck: drops cards we don't know, puts Extra Deck monsters in the Extra Deck, max 3 copies per zone. */
export function cleanImport(lists: DeckLists) {
  const out: DeckLists = { main: [], extra: [], side: [] };
  let unknown = 0, extra = 0;
  for (const z of ZONES) for (const code of lists[z]) {
    const c = card(code);
    if (!c || c.frame === 'token') { unknown++; continue; }
    const zone = z === 'side' ? 'side' : isExtraCard(c) ? 'extra' : 'main';
    if (out[zone].filter(x => x === code).length >= 3) { extra++; continue; }
    out[zone].push(code);
  }
  return { lists: out, unknown, extra };
}

/** Paste a .ydk or choose the file. */
export function ImportWindow({ title, button, note, onImport, onClose }: {
  title: string; button: string; note?: string;
  /** `skipped`: cards left out (not in our card list, or more than 3 copies). */
  onImport: (deck: DeckLists & { name: string | null }, skipped: number) => Promise<void> | void; onClose: () => void;
}) {
  const [text, setText] = useState(''), [file, setFile] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', esc); return () => removeEventListener('keydown', esc); }, [onClose]);
  const run = async (source = text, fileName = file) => {
    const parsed = parseYdk(source);
    const { lists, unknown, extra } = cleanImport(parsed);
    if (!lists.main.length && !lists.extra.length && !lists.side.length) return setMsg(unknown ? "None of those cards are in Millennium Arena's card list." : 'No cards found. Paste the contents of a .ydk file.');
    setBusy(true);
    try {
      await onImport({ ...lists, name: parsed.name ?? (fileName.replace(/\.ydk$/i, '').trim().slice(0, 60) || null) }, unknown + extra);
      onClose();
    } catch (e) { setMsg(message(e)); setBusy(false); }
  };
  return (
    <div className="overlay on" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="panel modal import">
        <div className="eyebrow">Import</div>
        <h3>{title}</h3>
        <p className="mnote">The format EDOPro, Dueling Nexus and YGOPRODeck all export. Choose the file or paste what's in it.{note ? ` ${note}` : ''}</p>
        <div className="line"><button className="sbtn" onClick={() => input.current?.click()}>Choose .ydk file…</button><span className="fname">{file}</span>
          <input ref={input} type="file" accept=".ydk,text/plain" hidden onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            if (f.size > 100_000) return setMsg("That file is too big to be a .ydk deck.");
            const t = await f.text();
            setFile(f.name); setText(t); run(t, f.name);
          }} /></div>
        <textarea ref={area} className="sinput" spellCheck={false} value={text} onChange={e => { setText(e.target.value); setMsg(''); }}
          placeholder={'#main\n46986414\n46986414\n…\n#extra\n…\n!side\n…'} />
        <div className="msg bad">{msg}</div>
        <div className="line"><button className="bigbtn sm" disabled={busy || !text.trim()} onClick={() => run()}>{busy ? 'Importing…' : button}</button><button className="bigbtn ghost sm" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
