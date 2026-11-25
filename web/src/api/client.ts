/** Error carrying the API's user-facing message and HTTP status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The parsed error body, e.g. { error, reauth: 'uos' }. */
    public data?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];

let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;
let onUosReauth: (() => void) | null = null;

/** Called once when the session cannot be refreshed (the auth provider sends the user to sign in). */
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}

/** Called when the API says the UOS module pass ended: re-enter through the UOS shell. */
export function setUosReauthHandler(fn: (() => void) | null) {
  onUosReauth = fn;
}

/** For a session that came from UOS, any lost session means re-entering through UOS. */
export function triggerUosReauth() {
  onUosReauth?.();
}

async function refreshSession(): Promise<boolean> {
  // De-duplicate: many queries may hit 401 at the same moment the access token expires.
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

const NO_REFRESH = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/bootstrap'];

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Json;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const doFetch = () =>
    fetch(url.pathname + url.search, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json', ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

  let res = await doFetch();
  if (res.status === 401 && !NO_REFRESH.includes(url.pathname)) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { reauth?: string } | null;
    if (body?.reauth === 'uos') {
      // UOS sessions have no refresh token: a new pass comes from the shell.
      if (!url.pathname.startsWith('/api/uos/')) onUosReauth?.();
    } else {
      if (await refreshSession()) {
        res = await doFetch();
      }
      if (res.status === 401) onSessionLost?.();
    }
  }
  if (res.status === 304) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const get = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T>(path: string, body?: Json) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body: Json) => api<T>(path, { method: 'PUT', body });
export const patch = <T>(path: string, body: Json) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, { method: 'DELETE', query });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
