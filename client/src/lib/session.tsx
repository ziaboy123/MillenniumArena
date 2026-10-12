// Who's logged in, shared by every page. Also applies the theme and background effects: the account's saved
// choices when logged in (they follow you between devices), otherwise this browser's.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@arena/shared';
import { fetchMe } from './api.ts';

interface Session {
  me: Me | null; loading: boolean;
  /** False on a server without a database: there are no accounts, only the duel lab. */
  accounts: boolean;
  setMe: (me: Me | null) => void; refresh: () => Promise<void>;
}
const Ctx = createContext<Session>({ me: null, loading: true, accounts: false, setMe: () => {}, refresh: async () => {} });

const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch {} };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [accounts, setAccounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { const r = await fetchMe(); setAccounts(r.accounts); setMe(r.me); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const theme = me?.settings.theme ?? stored('ma-theme') ?? 'c';
  const effects = me?.settings.effects ?? stored('ma-fx') !== 'off';
  useEffect(() => { document.body.dataset.dir = theme; store('ma-theme', theme); }, [theme]);
  useEffect(() => { document.body.classList.toggle('nofx', !effects); store('ma-fx', effects ? 'on' : 'off'); }, [effects]);

  return <Ctx.Provider value={{ me, loading, accounts, setMe, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
