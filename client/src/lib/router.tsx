// A tiny router: real paths under the app's base (e.g. /millennium/login), with the browser's back and forward.
import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');   // "/millennium"
const listeners = new Set<() => void>();
const current = () => location.pathname.slice(BASE.length).replace(/\/+$/, '') || '/';

/** The current page path, e.g. "/", "/login", "/settings". */
export function usePath(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const update = () => setPath(current());
    listeners.add(update);
    addEventListener('popstate', update);
    return () => { listeners.delete(update); removeEventListener('popstate', update); };
  }, []);
  return path;
}

export function navigate(to: string, replace = false) {
  const url = BASE + (to === '/' ? '/' : to);
  if (url === location.pathname) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  scrollTo(0, 0);
  listeners.forEach(l => l());
}

/** A link that changes page without reloading. */
export function Link({ to, children, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={BASE + to} {...rest} onClick={e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault(); rest.onClick?.(e); navigate(to);
    }}>{children}</a>
  );
}
