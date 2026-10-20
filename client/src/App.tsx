// The site's pages and who may see them. Signed-out pages send logged-in visitors Home; everything else needs a
// login (and a username). A server without a database has no accounts, so it only shows the duel lab.
import { useEffect, type ComponentType } from 'react';
import { navigate, rememberPath, usePath } from './lib/router.tsx';
import { useSession } from './lib/session.tsx';
import { Eye, Stage } from './lib/ui.tsx';
import { DeckEditor } from './pages/DeckEditor.tsx';
import { DeckList } from './pages/Decks.tsx';
import { DuelPage } from './pages/Duel.tsx';
import { DuelLab } from './pages/DuelLab.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { Home } from './pages/Home.tsx';
import { Settings } from './pages/Settings.tsx';
import { AcceptTerms, ChooseName, Forgot, LogIn, Privacy, SignUp, Terms, Welcome } from './pages/Welcome.tsx';

const PUBLIC: Record<string, ComponentType> = { '/privacy': Privacy, '/terms': Terms };
const SIGNED_OUT: Record<string, ComponentType> = { '/': Welcome, '/signup': SignUp, '/login': LogIn, '/forgot': Forgot };
const SIGNED_IN: Record<string, ComponentType> = {
  '/home': Home,
  '/settings': Settings,
  '/duel': DuelPage,
  '/lab': DuelLab,
  '/decks': DeckList,
  '/profile': ProfilePage,
};

export function App() {
  const { me, loading, trouble, accounts } = useSession();
  const path = usePath();
  if (loading) return <Stage fluid>{trouble && <div className="connecting"><Eye /><p>Can't reach Millennium Arena right now. Trying again…</p></div>}</Stage>;
  if (!accounts) return <DuelLab />;

  const named = !!me?.username;
  const Public = PUBLIC[path], SignedOut = SIGNED_OUT[path], SignedIn = SIGNED_IN[path];
  if (Public) return <Public />;
  if (SignedOut) return me ? <Redirect to={named ? '/home' : '/choose-name'} /> : <SignedOut />;
  if (!me) {
    const needsLogin = SignedIn || path === '/choose-name' || path.startsWith('/decks/') || path.startsWith('/join/') || path.startsWith('/u/');
    if (needsLogin && path !== '/choose-name') rememberPath(path);   // come back here after logging in
    return <Redirect to={needsLogin ? '/login' : '/'} />;
  }
  if (path === '/choose-name') return named ? <Redirect to="/home" /> : <ChooseName />;
  if (!named) return <Redirect to="/choose-name" />;
  // everyone agrees to the current Terms (and confirms they're 13 or older) once, before anything else
  if (!me.terms) return <AcceptTerms />;
  const player = /^\/u\/([A-Za-z0-9_]{1,20})$/.exec(path)?.[1];
  if (player) return <ProfilePage key={player} name={player} />;
  const joinCode = /^\/join\/([A-Za-z0-9]{6})$/.exec(path)?.[1];
  if (joinCode) return <DuelPage key={joinCode} joinCode={joinCode} />;
  const deckId = /^\/decks\/([\w-]{1,40})$/.exec(path)?.[1];
  if (deckId) return <DeckEditor key={deckId} id={deckId} />;
  return SignedIn ? <SignedIn key={path} /> : <Redirect to="/home" />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
