// Talking to the server's account API. Same-origin only; the login cookie is HttpOnly, so scripts never see it.
import type { Me } from '@arena/shared';

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

/** POST JSON to <base>/api/<path>; throws ApiError with the server's message on failure. */
export async function api<T = { ok: true; me?: Me | null }>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new ApiError("Can't reach the server. Check your connection.", 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong.', res.status);
  return data as T;
}

/** Who's logged in. `accounts` is false on a server without a database (accounts switched off). */
export async function fetchMe(): Promise<{ accounts: boolean; me: Me | null }> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/me`, { credentials: 'same-origin' });
  if (res.status === 404) return { accounts: false, me: null };
  // the server (or its database) is struggling: that says nothing about whether you're logged in
  if (!res.ok) throw new ApiError("Can't reach the server right now.", res.status);
  return { accounts: true, me: (await res.json()).me ?? null };
}
