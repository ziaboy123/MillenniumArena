// Reporting a player, from the duel chat or their profile. A person reads every report; one from the chat comes with
// the room's last 20 messages (the server adds them, see server/src/safety.ts).
import { useState } from 'react';
import { api } from './api.ts';

export function ReportDialog({ names, context, onClose }: { names: string[]; context: 'chat' | 'profile'; onClose: () => void }) {
  const [who, setWho] = useState(names[0] ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [sent, setSent] = useState(false);
  const send = async () => {
    setBusy(true); setErr('');
    try { await api('report', { username: who, context, reason }); setSent(true); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="overlay on report" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <div className="panel modal" role="dialog" aria-label="Report a player">
        <div className="eyebrow">Report a player</div>
        {sent ? <>
          <h3>Report sent</h3>
          <p className="mnote">Thank you. A person will look at it. {context === 'chat' ? "In the meantime you can mute the chat (the speaker button)." : ''}</p>
          <div className="line"><button className="bigbtn" autoFocus onClick={onClose}>Close</button></div>
        </> : <>
          <h3>{names.length > 1 ? 'Who are you reporting?' : `Report ${who}?`}</h3>
          {names.length > 1 && (
            <select className="sinput" value={who} onChange={e => setWho(e.target.value)} aria-label="Player">
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <textarea className="sinput" maxLength={500} placeholder="What happened? (optional)" value={reason} onChange={e => setReason(e.target.value)} aria-label="What happened" autoFocus />
          <p className="mnote">{context === 'chat' ? "The last 20 messages in this room's chat are sent with your report. " : ''}
            A person reads every report. Breaking the Terms can get an account suspended. If anyone is in danger right now, call the police (999 in the UK).</p>
          <div className="msg bad">{err}</div>
          <div className="line">
            <button className="bigbtn danger" disabled={busy || !who} onClick={send}>{busy ? 'Sending…' : 'Send report'}</button>
            <button className="bigbtn ghost" onClick={onClose}>Cancel</button>
          </div>
        </>}
      </div>
    </div>
  );
}
