// The Profile page (from design/profile.html): who you are, your record (win rate, streaks, last 10), the decks
// you've played, the cards you use most, and your match history. /u/<name> shows someone else's record only.
import { useEffect, useMemo, useState } from 'react';
import type { HistoryRow, MatchKind, MatchResult, Profile } from '@arena/shared';
import { api, ApiError } from '../lib/api.ts';
import { card, cropImage, imageFallback, loadCards, smallImage } from '../lib/cards.ts';
import { navigate } from '../lib/router.tsx';
import { Eye } from '../lib/ui.tsx';
import { Page, useToast } from './common.tsx';
import { DEFAULT_ARTWORK } from './Home.tsx';

type Kind = 'all' | MatchKind;
const KINDS: [Kind, string][] = [['all', 'All duels'], ['private', 'Private'], ['unranked', 'Unranked'], ['bot', 'Solo vs bot']];
const LETTER: Record<MatchResult, string> = { win: 'W', loss: 'L', draw: 'D' };

function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
}
const length = (r: HistoryRow) => { const m = Math.max(1, Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

export function ProfilePage({ name }: { name?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [filter, setFilter] = useState<'all' | 'win' | 'loss'>('all');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [more, setMore] = useState(false);
  const [, setCardsReady] = useState(false);
  const [toast, showToast] = useToast();
  useEffect(() => {
    setProfile(null); setError('');
    (name ? api<{ profile: Profile }>('profile/user', { name }) : api<{ profile: Profile }>('profile/me'))
      .then(r => { setProfile(r.profile); setHistory(r.profile.history ?? []); setMore((r.profile.history?.length ?? 0) >= 100); })
      .catch(e => setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
    loadCards().then(() => setCardsReady(true)).catch(() => {});
  }, [name]);
  const loadMore = async () => {
    const r = await api<{ history: HistoryRow[] }>('profile/history', { before: history[history.length - 1]?.id });
    setHistory(h => [...h, ...r.history]); setMore(r.history.length >= 100);
  };
  const rows = useMemo(() => history.filter(r => (kind === 'all' || r.kind === kind) && (filter === 'all' || r.result === filter)), [history, kind, filter]);

  if (error) return <Page back="/home" className="center"><div className="panel auth"><h2>{name ? 'Player not found' : "Can't load your profile"}</h2><p className="sub">{error}</p><button className="bigbtn" onClick={() => navigate('/home')}>Back to Home</button></div></Page>;
  if (!profile) return <Page back="/home" className="pf"><div className="loading">Loading the profile…</div></Page>;

  const s = profile.stats[kind], art = profile.artwork ?? DEFAULT_ARTWORK;
  const rate = s.duels ? s.wins / s.duels : 0, C = 2 * Math.PI * 80;
  const link = `${location.origin}${import.meta.env.BASE_URL}u/${profile.name}`;
  const since = new Date(profile.memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const decks = profile.decks?.[kind] ?? [];
  const ratio = s.losses ? (s.wins / s.losses).toFixed(2) : s.wins ? '∞' : '–';

  return (
    <Page back="/home" className="pf" over={toast}>
      <div className="dhead">
        <div className="head"><div className="eyebrow">{profile.you ? 'You' : 'Player'}</div><h1>Profile</h1></div>
        <div className="dbar"><div className="seg">{KINDS.map(([k, label]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{label}<span className="n">{profile.stats[k].duels}</span></button>)}</div></div>
      </div>
      <div className="pgrid">
        <div className="pcol">
          <div className="panel ident">
            <div className="banner" style={{ backgroundImage: `url(${cropImage(art)})` }}><div className="tint" /><div className="shade" /></div>
            <div className="idbody">
              <div className="av">{profile.name[0]?.toUpperCase()}</div>
              <h1>{profile.name}</h1>
              <div className="idline"><span className="rankpill"><Eye />Unranked</span><span>Member since {since}</span></div>
              <p className="note">Ranked duels are coming soon. {profile.you ? 'Your' : 'Their'} rank will show here once they open.</p>
              {profile.you && <div className="line">
                <button className="sbtn" onClick={() => navigator.clipboard?.writeText(link).then(() => showToast('Profile link copied'), () => showToast(link))}>Copy profile link</button>
                <button className="sbtn" onClick={() => navigate('/settings')}>Edit in Settings</button>
              </div>}
            </div>
          </div>
          {profile.you && <div className="panel dplayed">
            <div className="eyebrow">Decks played</div>
            {!decks.length ? <p className="empty">The decks you duel with show here.</p> : decks.map(d => (
              <div key={d.name} className="pdrow">
                {d.cover ? <img src={smallImage(d.cover)} alt="" onError={e => imageFallback(e, d.cover!)} /> : <div className="noimg" />}
                <div><b>{d.name}</b><span>{d.duels} {d.duels === 1 ? 'duel' : 'duels'} · {d.wins}–{d.losses}</span><div className="track"><i style={{ width: `${(d.wins / d.duels) * 100}%` }} /></div></div>
                <div className="pct">{Math.round((d.wins / d.duels) * 100)}%</div>
              </div>
            ))}
          </div>}
          {profile.you && !!profile.mostPlayed?.length && <div className="panel mostplayed">
            <div className="eyebrow">Most played cards</div>
            <div className="mp">{profile.mostPlayed.map(code => <img key={code} src={smallImage(code)} alt={card(code)?.name ?? ''} title={card(code)?.name} onError={e => imageFallback(e, code)} />)}</div>
          </div>}
        </div>

        <div className="pcol">
          <div className="panel pstats">
            <div className="donut">
              <svg viewBox="0 0 190 190">
                <circle cx="95" cy="95" r="80" fill="none" stroke={s.duels ? 'rgba(255,110,90,.35)' : 'rgba(255,255,255,.08)'} strokeWidth="16" />
                {s.wins > 0 && <circle cx="95" cy="95" r="80" fill="none" stroke="var(--accent)" strokeWidth="16" strokeLinecap="round" strokeDasharray={`${Math.max(C * rate - 6, 1)} ${C}`} className="arc" />}
              </svg>
              <div className="mid"><b>{s.duels ? `${Math.round(rate * 100)}%` : '–'}</b><span>Win rate</span></div>
            </div>
            <div>
              <div className="stgrid">
                {([['', s.duels, 'Duels played'], ['win', s.wins, 'Wins'], ['loss', s.losses, 'Losses'], ['', ratio, 'Win / loss ratio'],
                  ['', s.streak ? `${s.streak.length}${LETTER[s.streak.result]}` : '–', 'Current streak'], ['', s.bestWinStreak ? `${s.bestWinStreak}W` : '–', 'Best win streak']] as const)
                  .map(([cls, v, label]) => <div key={label} className={`st ${cls}`}><b>{v}</b><span>{label}</span></div>)}
              </div>
              <div className="form"><span className="lbl">Last 10</span>{s.form.length ? s.form.map((r, i) => <i key={i} className={LETTER[r]}>{LETTER[r]}</i>) : <span className="none">No duels yet</span>}</div>
            </div>
          </div>

          {profile.you ? (
            <div className="panel hist">
              <div className="hhead">
                <h2>Match history</h2>
                <div className="seg">{([['all', 'All'], ['win', 'Wins'], ['loss', 'Losses']] as const).map(([k, label]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>)}</div>
              </div>
              {!history.length ? (
                <div className="empty"><p>No duels yet. Duel a friend or the bot and they show up here.</p><button className="bigbtn sm" onClick={() => navigate('/duel')}>Duel</button></div>
              ) : <>
                <div className="trow thead"><span>Result</span><span>Opponent</span><span className="c-format">Format</span><span>Score</span><span>Your deck</span><span>When</span><span className="c-len">Length</span></div>
                <div className="rows">
                  {rows.map(r => (
                    <div key={r.id} className="trow" title={r.reason}>
                      <span className={`res ${LETTER[r.result]}`}>{r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : 'Draw'}</span>
                      <span className="popp"><span className="av">{r.kind === 'bot' ? '⚙' : r.opponent[0]?.toUpperCase()}</span>{r.opponent}</span>
                      <span className="muted c-format">{r.kind === 'bot' ? 'Solo vs bot' : `${r.kind === 'unranked' ? 'Unranked' : 'Private'} · Bo${r.bo}`}</span>
                      <span className="score">{r.scoreFor}–{r.scoreAgainst}</span>
                      <span className="dk">{r.cover ? <img src={smallImage(r.cover)} alt="" onError={e => imageFallback(e, r.cover!)} /> : null}<span>{r.deck}</span></span>
                      <span className="muted">{when(r.endedAt)}</span>
                      <span className="muted c-len">{length(r)}</span>
                    </div>
                  ))}
                  {!rows.length && <p className="empty">Nothing here with these filters.</p>}
                  {more && <button className="sbtn more" onClick={loadMore}>Show older duels</button>}
                </div>
              </>}
            </div>
          ) : (
            <div className="panel hist private-note"><p className="empty">{profile.name}'s match history and decks are private.</p></div>
          )}
        </div>
      </div>
    </Page>
  );
}
