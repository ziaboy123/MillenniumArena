// The site's pages and who may see them. Signed-out pages send logged-in visitors Home; everything else needs a
// login (and a username). A server without a database has no accounts, so it only shows the duel lab.
import { useEffect, type ComponentType } from 'react';
import { navigate, usePath } from './lib/router.tsx';
import { useSession } from './lib/session.tsx';
import { Background, Stage } from './lib/ui.tsx';
import { DuelLab } from './pages/DuelLab.tsx';
import { Home, Soon } from './pages/Home.tsx';
import { Settings } from './pages/Settings.tsx';
import { ChooseName, Forgot, LogIn, Privacy, SignUp, Terms, Welcome } from './pages/Welcome.tsx';

const PUBLIC: Record<string, ComponentType> = { '/privacy': Privacy, '/terms': Terms };
const SIGNED_OUT: Record<string, ComponentType> = { '/': Welcome, '/signup': SignUp, '/login': LogIn, '/forgot': Forgot };
const SIGNED_IN: Record<string, ComponentType> = {
  '/home': Home,
  '/settings': Settings,
  '/duel': DuelLab,
  '/decks': () => <Soon title="Decks" text="Building and editing decks here (shared with DeckForge) is the next step. Until then, DeckForge has your decks." />,
  '/profile': () => <Soon title="Profile" text="Your record, match history and most-played cards arrive once duels are saved to your account." />,
};

export function App() {
  const { me, loading, accounts } = useSession();
  const path = usePath();
  if (loading) return <Stage><Background /></Stage>;
  if (!accounts) return <DuelLab />;

  const named = !!me?.username;
  const Public = PUBLIC[path], SignedOut = SIGNED_OUT[path], SignedIn = SIGNED_IN[path];
  if (Public) return <Public />;
  if (SignedOut) return me ? <Redirect to={named ? '/home' : '/choose-name'} /> : <SignedOut />;
  if (!me) return <Redirect to={SignedIn || path === '/choose-name' ? '/login' : '/'} />;
  if (path === '/choose-name') return named ? <Redirect to="/home" /> : <ChooseName />;
  if (!named) return <Redirect to="/choose-name" />;
  return SignedIn ? <SignedIn key={path} /> : <Redirect to="/home" />;
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
