// A private room (from design/duel.html): the code to share, the two duelists, the rules, spectators and watch
// requests, then the coin toss, side decking between games (best of 3) and the match result. The duel itself is
// the duel screen; this shows whenever there isn't a game on.
import { useEffect, useState, type ReactNode } from 'react';
import type { ClientMessage, RoomPlayer, RoomRules, RoomView } from '@arena/shared';
import { ZONE_MAX, type SavedDeck } from '@arena/shared/decks';
import { card, imageFallback, smallImage } from '../lib/cards.ts';
import { isExtraCard } from '../lib/decks.ts';
import { Eye, EyeSvg } from '../lib/ui.tsx';
import { Page } from './common.tsx';
import { DeckPicker } from './DeckPicker.tsx';

export function ruleChips(r: RoomRules, password: boolean): string[] {
  return [r.bo === 3 ? 'Best of 3' : 'Best of 1', r.timer ? `${r.timer}s turns` : 'No turn timer', r.banlist === 'none' ? 'No banlist' : `${r.banlist} banlist`,
    `${r.lp.toLocaleString('en-GB')} LP`, r.spectators === 'ask' ? 'Spectators: ask' : 'No spectators', r.check ? 'Deck check on' : 'Deck check off',
    ...(password ? ['Password protected'] : [])];
}
export const RuleChips = ({ rules, password }: { rules: RoomRules; password: boolean }) =>
  <div className="chips">{ruleChips(rules, password).map(c => <span key={c} className={`rchip ${c === 'Password protected' ? 'lock' : ''}`}>{c}</span>)}</div>;

type Send = (msg: ClientMessage) => void;

export function RoomScreen({ room, decks, deckId, blocker, send, toast, showToast }: {
  room: RoomView; decks: SavedDeck[]; deckId: string | null; blocker: (d: SavedDeck) => string | null; send: Send; toast: ReactNode; showToast: (m: string) => void;
}) {
  const [host, guest] = room.players;
  const you = room.you, duelist = you === 'host' || you === 'guest';
  const me = duelist ? (you === 'host' ? host : guest) : null, them = duelist ? (you === 'host' ? guest : host) : null;
  const leave = () => send({ type: 'room.leave' });
  const copy = (text: string, done: string) => { navigator.clipboard?.writeText(text).then(() => showToast(done), () => showToast(text)); };
  const link = `${location.origin}${import.meta.env.BASE_URL}join/${room.code}`;

  const overlay = room.phase === 'toss' || room.phase === 'choose' ? <ChooseWindow room={room} send={send} />
    : room.phase === 'siding' ? (duelist && room.siding && !room.siding.done ? <SideWindow key={room.game} room={room} send={send} /> : <Waiting room={room} send={send} title={`Side decking before game ${room.game + 1}`} text={duelist ? `Waiting for ${them?.name} to finish side decking…` : 'The duelists are side decking.'} />)
    : room.phase === 'over' ? <OverWindow room={room} send={send} />
    : room.phase === 'dueling' ? <Waiting room={room} send={send} title="Starting the duel…" text="" />
    : null;

  return (
    <Page className="duelpage" over={<>{overlay}{toast}</>}>
      <div className="dhead">
        <div className="head">
          <button className="crumb" onClick={leave}>← {you === 'host' ? 'Close room' : you === 'asking' ? 'Cancel' : 'Leave room'}</button>
          <h1>{you === 'host' ? 'Your room' : `${host.name}'s room`}</h1>
        </div>
      </div>
      <div className="dgrid2">
        <div className="panel room">
          <div className="codebox">
            <div className="eyebrow">Room code</div>
            <div className="bigcode">{room.code}</div>
            {duelist && <div className="line"><button className="sbtn" onClick={() => copy(room.code, 'Room code copied')}>Copy code</button><button className="sbtn" onClick={() => copy(link, 'Invite link copied')}>Copy invite link</button></div>}
          </div>
          <div className="players">
            <PlayerCard p={host} game={room.game} />
            <div className="vs"><Eye /><b>VS</b></div>
            <PlayerCard p={guest} game={room.game} />
          </div>
          <RuleChips rules={room.rules} password={room.password} />
        </div>

        <div className="col-stack">
          <div className="panel spect">
            <div className="top-row"><div className="eyebrow">Spectators</div><div className="wcount"><Eye />{room.spectators.length} watching</div></div>
            {room.rules.spectators === 'off' ? <p className="d">Spectators are off for this room.</p>
              : duelist ? <>
                <p className="d">Watch requests appear here. Everyone playing has to accept. Spectators only see public cards, never your hand.</p>
                {room.requests.map(r => (
                  <div key={r.id} className="req">
                    <div className="av">{r.name[0]?.toUpperCase()}</div>
                    <div className="w"><b>{r.name}</b> wants to watch<br /><span>{r.accepted ? `You said yes. Waiting for ${them?.name ?? 'your opponent'}…` : 'Everyone playing needs to accept.'}</span></div>
                    {!r.accepted && <><button className="sbtn p" onClick={() => send({ type: 'room.request', id: r.id, accept: true })}>Accept</button><button className="sbtn" onClick={() => send({ type: 'room.request', id: r.id, accept: false })}>Decline</button></>}
                  </div>
                ))}
                {room.spectators.map(s => (
                  <div key={s.id} className="req"><div className="av">{s.name[0]?.toUpperCase()}</div><div className="w"><b>{s.name}</b> is watching</div><button className="sbtn" onClick={() => send({ type: 'room.kick', id: s.id })}>Remove</button></div>
                ))}
              </> : <>
                <p className="d">{you === 'asking' ? `You asked to watch. Waiting for ${[host.name, guest?.name].filter(Boolean).join(' and ')} to say yes…` : 'You can watch every game here. You only see public cards.'}</p>
                {room.spectators.map(s => <div key={s.id} className="req"><div className="av">{s.name[0]?.toUpperCase()}</div><div className="w"><b>{s.name}</b></div></div>)}
              </>}
          </div>

          <div className="panel actions">
            {duelist && room.phase === 'lobby' && <>
              <div className="eyebrow">Your deck</div>
              <DeckPicker decks={decks} value={deckId} blocker={blocker} onChange={id => send({ type: 'room.deck', deck: id })} />
            </>}
            {you === 'host' && room.phase === 'lobby' && <>
              <div className="msg">{!guest ? 'Waiting for a friend to join. Send them the code.' : guest.ready ? 'Both of you are ready.' : `Waiting for ${guest.name} to be ready.`}</div>
              <button className="bigbtn" disabled={!guest?.ready} onClick={() => send({ type: 'room.start' })}>Start duel</button>
            </>}
            {you === 'guest' && room.phase === 'lobby' && me && <>
              <div className="msg">{me.ready ? `Waiting for ${host.name} to start the duel…` : "Press Ready when you're set. The host starts the duel."}</div>
              <button className="bigbtn" disabled={!me.hasDeck} onClick={() => send({ type: 'room.ready', ready: !me.ready })}>{me.ready ? 'Not ready' : 'Ready'}</button>
            </>}
            {!duelist && <div className="msg">{you === 'asking' ? 'You can cancel any time.' : 'The duel shows here when a game starts.'}</div>}
            <button className="bigbtn ghost" onClick={leave}>{you === 'host' ? 'Close room' : you === 'asking' ? 'Cancel' : 'Leave room'}</button>
          </div>
        </div>
      </div>
    </Page>
  );
}

function PlayerCard({ p, game }: { p: RoomPlayer | null; game: number }) {
  if (!p) return (
    <div className="pcard empty"><div className="av ghost">?</div><div className="nm">Waiting for a friend</div><div className="dots"><i /><i /><i /></div><div className="rk">Send them the room code above</div></div>
  );
  return (
    <div className="pcard">
      <div className="av">{p.name[0]?.toUpperCase()}</div>
      <div className="nm">{p.name}{p.you && <span className="youtag">You</span>}</div>
      <div className="rk">{p.role === 'host' ? 'Host · ' : ''}Unranked{game > 0 ? ` · ${p.wins} ${p.wins === 1 ? 'win' : 'wins'}` : ''}</div>
      <div className="dk">{p.deck ? <>{p.deck.cover ? <img src={smallImage(p.deck.cover)} alt="" onError={e => imageFallback(e, p.deck!.cover!)} /> : null}{p.deck.name}</> : p.hasDeck ? 'Deck chosen' : 'Choosing a deck…'}</div>
      {!p.connected ? <span className="pill wait">Reconnecting…</span>
        : p.role === 'host' ? <span className="pill ready">Host</span>
        : <span className={`pill ${p.ready ? 'ready' : 'wait'}`}>{p.ready ? 'Ready' : p.you ? 'Not ready' : 'Getting ready'}</span>}
    </div>
  );
}

/** A window over the room between games. Leaving stays possible from every one of them. */
function Window({ children, wide, room, send }: { children: ReactNode; wide?: boolean; room: RoomView; send: Send }) {
  const label = room.you === 'host' ? 'Close room' : room.you === 'asking' ? 'Cancel' : 'Leave room';
  return (
    <div className="overlay on"><div className={`panel modal toss ${wide ? 'wide' : ''}`}>
      {children}
      {room.phase !== 'over' && <button className="leavelink" onClick={() => send({ type: 'room.leave' })}>{label}</button>}
    </div></div>
  );
}
const nameOf = (room: RoomView, role: 'host' | 'guest' | null) => (role === 'host' ? room.players[0].name : role === 'guest' ? room.players[1]?.name ?? 'Your opponent' : '');
const score = (room: RoomView) => `${room.players[0].wins}-${room.players[1]?.wins ?? 0}`;

/** The coin toss (game 1), or the loser of the last game picking: who goes first. */
function ChooseWindow({ room, send }: { room: RoomView; send: Send }) {
  const [flipping, setFlipping] = useState(room.phase === 'toss');
  useEffect(() => { if (room.phase !== 'toss') return; setFlipping(true); const t = setTimeout(() => setFlipping(false), 1500); return () => clearTimeout(t); }, [room.phase]);
  const mine = room.chooser === room.you, chooser = nameOf(room, room.chooser);
  const toss = room.phase === 'toss';
  return (
    <Window room={room} send={send}>
      {toss && <div className={`coin ${flipping ? 'flip' : ''}`}><EyeSvg /></div>}
      <div className="eyebrow">{toss ? 'Coin toss' : `Game ${room.game + 1}${room.rules.bo === 3 ? ' of 3' : ''} · ${score(room)}`}</div>
      {toss && flipping ? <h3>Tossing…</h3> : <>
        <h3>{toss ? (mine ? 'You won the toss' : `${chooser} won the toss`) : mine ? 'You choose' : `${chooser} chooses`}</h3>
        <p className="d">{mine ? (toss ? 'Choose whether to go first or second.' : `You lost game ${room.game}, so you decide who goes first.`) : `Waiting for ${chooser} to choose who goes first…`}</p>
        {mine && <div className="line"><button className="bigbtn" onClick={() => send({ type: 'room.choose', first: true })}>Go first</button><button className="bigbtn ghost" onClick={() => send({ type: 'room.choose', first: false })}>Go second</button></div>}
      </>}
    </Window>
  );
}

function Waiting({ room, title, text, send }: { room: RoomView; title: string; text: string; send: Send }) {
  return (
    <Window room={room} send={send}>
      <div className="eyebrow">{room.rules.bo === 3 ? `Best of 3 · ${score(room)}` : 'Private duel'}</div>
      <h3>{title}</h3>
      {room.last && <p className="d">{room.last.winner ? `${nameOf(room, room.last.winner)} won game ${room.game}` : `Game ${room.game} was a draw`}: {room.last.reason}.</p>}
      {text && <p className="d">{text}</p>}
      <div className="dots"><i /><i /><i /></div>
    </Window>
  );
}

function OverWindow({ room, send }: { room: RoomView; send: Send }) {
  const won = room.winner && room.winner === room.you, lost = room.winner && (room.you === 'host' || room.you === 'guest') && room.winner !== room.you;
  const title = !room.winner ? 'The match is a draw' : won ? 'You win the match' : lost ? `${nameOf(room, room.winner)} wins the match` : `${nameOf(room, room.winner)} wins`;
  return (
    <Window room={room} send={send}>
      <div className={`eyebrow ${won ? 'good' : lost ? 'bad' : ''}`}>{room.rules.bo === 3 ? `Best of 3 · ${score(room)}` : 'Private duel'} · match over</div>
      <h3>{title}</h3>
      {room.last && <p className="d">{room.last.reason}.</p>}
      <div className="line">
        {room.you === 'host' && <button className="bigbtn" onClick={() => send({ type: 'room.again' })}>{room.players[1] ? 'Play again' : 'Back to the room'}</button>}
        {room.you === 'guest' && <p className="d">The host can start another match.</p>}
        <button className="bigbtn ghost" onClick={() => send({ type: 'room.leave' })}>{room.you === 'host' ? 'Close room' : 'Leave room'}</button>
      </div>
    </Window>
  );
}

/** Best of 3, between games: swap cards between your Main/Extra Deck and your Side Deck (the Side Deck keeps its size). */
function SideWindow({ room, send }: { room: RoomView; send: Send }) {
  const start = room.siding!;
  const [deck, setDeck] = useState({ main: [...start.main], extra: [...start.extra], side: [...start.side] });
  const need = start.side.length;
  const toSide = (z: 'main' | 'extra', i: number) => setDeck(d => ({ ...d, [z]: d[z].filter((_, k) => k !== i), side: [...d.side, d[z][i]] }));
  const fromSide = (i: number) => setDeck(d => {
    const code = d.side[i], c = card(code), z = c && isExtraCard(c) ? 'extra' : 'main';
    return { ...d, side: d.side.filter((_, k) => k !== i), [z]: [...d[z], code] };
  });
  const problem = deck.side.length !== need ? `Your Side Deck needs ${need} ${need === 1 ? 'card' : 'cards'} (it has ${deck.side.length}).`
    : deck.main.length < 40 || deck.main.length > ZONE_MAX.main ? `Your Main Deck needs 40 to 60 cards (it has ${deck.main.length}).`
    : deck.extra.length > ZONE_MAX.extra ? 'Your Extra Deck can have 15 cards at most.' : '';
  const grid = (z: 'main' | 'extra' | 'side') => (
    <div className={`zgrid ${z}`}>
      {deck[z].map((code, i) => (
        <div key={`${i}-${code}`} className="dc" title={card(code)?.name} onClick={() => (z === 'side' ? fromSide(i) : toSide(z, i))}>
          <span className="ph">{card(code)?.name ?? `#${code}`}</span><img src={smallImage(code)} alt="" loading="lazy" onError={e => imageFallback(e, code)} />
        </div>
      ))}
    </div>
  );
  return (
    <Window wide room={room} send={send}>
      <div className="eyebrow">Best of 3 · {score(room)} · before game {room.game + 1}</div>
      <h3>Side decking</h3>
      <p className="d">{room.last?.winner ? `${nameOf(room, room.last.winner)} won game ${room.game}.` : ''} Click a card to move it between your deck and your Side Deck. {need ? `Your Side Deck keeps ${need} ${need === 1 ? 'card' : 'cards'}.` : "You don't have a Side Deck, so there's nothing to swap."}</p>
      <div className="sidewin">
        <div className="zh"><b>Main Deck</b><span className="n">{deck.main.length}</span></div>{grid('main')}
        {(deck.extra.length > 0 || start.extra.length > 0) && <><div className="zh"><b>Extra Deck</b><span className="n">{deck.extra.length}</span></div>{grid('extra')}</>}
        <div className="zh"><b>Side Deck</b><span className={`n ${deck.side.length !== need ? 'bad' : ''}`}>{deck.side.length} / {need}</span></div>{grid('side')}
      </div>
      <div className="msg bad">{problem}</div>
      <div className="line">
        <button className="bigbtn" disabled={!!problem} onClick={() => send({ type: 'room.side', ...deck })}>Done</button>
        <button className="bigbtn ghost" onClick={() => setDeck({ main: [...start.main], extra: [...start.extra], side: [...start.side] })}>Reset</button>
      </div>
    </Window>
  );
}
