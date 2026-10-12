// Home: four tiles (Duel, Decks, Profile, Settings). Settings is only reachable from here, never mid-duel.
import { useState } from 'react';
import { cropImage } from '../lib/cards.ts';
import { navigate } from '../lib/router.tsx';
import { useSession } from '../lib/session.tsx';
import { Eye, EyeSvg, THEMES } from '../lib/ui.tsx';
import { Icon, Page } from './common.tsx';

export const DEFAULT_ARTWORK = 89631139;   // Blue-Eyes White Dragon
/** The Decks tile shows card backs until this many duels, then your most-played cards. */
const FAVOURITES_AFTER = 10;

export function Home() {
  const { me } = useSession();
  const [fanOpen, setFanOpen] = useState(false);
  if (!me?.username) return null;
  const art = me.settings.artwork ?? DEFAULT_ARTWORK;
  const theme = THEMES.find(t => t.k === (me.settings.theme ?? 'c'))?.name ?? 'Arena';
  const duels = 0;   // match history arrives with the Profile page
  const left = FAVOURITES_AFTER - duels;
  const go = <div className="go"><Icon name="arrow" className="" /></div>;
  const fan = (i: number) => fanOpen
    ? `translate(${(i - 1) * 70}px, ${Math.abs(i - 1) * 10 - 8}px) rotate(${(i - 1) * 14}deg)`
    : `translate(${(i - 1) * 46}px, ${Math.abs(i - 1) * 8}px) rotate(${(i - 1) * 10}deg)`;

  return (
    <Page foot className="home">
      <div className="tiles">
        <div className="panel tile duel" onClick={() => navigate('/duel')}>
          <div className="art" style={{ backgroundImage: `url(${cropImage(art)})` }} /><div className="tint" /><div className="shade" />
          <Eye className="eye emb" />
          <div className="txt">
            <div className="eyebrow">Play</div>
            <h2>Duel</h2>
            <p>Duel the bot on the real rules engine. Private duels with a friend, by code, are next.</p>
            <div className="modes">
              <span className="mode live"><i />Solo vs bot</span>
              <span className="mode"><i />Private <small>Soon</small></span>
              <span className="mode"><i />Ranked <small>Soon</small></span>
              <span className="mode"><i />Unranked <small>Soon</small></span>
            </div>
          </div>
          {go}
        </div>

        <div className="panel tile sm" onClick={() => navigate('/decks')} onMouseEnter={() => setFanOpen(true)} onMouseLeave={() => setFanOpen(false)}>
          <div className="txt">
            <div className="eyebrow">Build</div>
            <h2>Decks</h2>
            <p>Your decks, shared with DeckForge.</p>
            <p className="fanhint">Your most-played cards show here after {left} more {left === 1 ? 'duel' : 'duels'}</p>
          </div>
          <div className="fan">{[0, 1, 2].map(i => <div key={i} className="card back" style={{ transform: fan(i) }}><EyeSvg /></div>)}</div>
          {go}
        </div>

        <div className="panel tile sm" onClick={() => navigate('/profile')}>
          <div className="txt">
            <div className="eyebrow">You</div>
            <h2>Profile</h2>
            <div className="stats">
              <div><b>Unranked</b><span>Rank</span></div>
              <div><b>0 – 0</b><span>Wins – Losses</span></div>
              <div><b>–</b><span>Win rate</span></div>
            </div>
          </div>
          <div className="big-av">{me.username[0].toUpperCase()}</div>
          {go}
        </div>

        <div className="panel tile sm" onClick={() => navigate('/settings')}>
          <div className="txt">
            <div className="eyebrow">Options</div>
            <h2>Settings</h2>
            <p>Theme: {theme} · Account · Gameplay · Audio</p>
          </div>
          <div className="big-gear"><svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg></div>
          {go}
        </div>
      </div>
    </Page>
  );
}

/** Pages that arrive in later steps. */
export function Soon({ title, text }: { title: string; text: string }) {
  return (
    <Page back="/home" className="center">
      <div className="panel auth soon">
        <div className="eyebrow">Coming next</div>
        <h2>{title}</h2>
        <p className="sub">{text}</p>
        <button className="bigbtn" onClick={() => navigate('/home')}>Back to Home</button>
      </div>
    </Page>
  );
}
