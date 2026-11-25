/**
 * The UOS shell opens a module by sending the browser to
 *
 *   <module base_url>/sso-callback#token=<module pass>&returnTo=<path>
 *
 * (uos-auth-ui: select-module, then window.location to that address; returnTo
 * is only there when the shell's /reselect re-opens the module). The pass is in
 * the fragment, so it never reaches a server log or a Referer header.
 */
export const HANDOFF_PATH = '/sso-callback';
const TOKEN = 'token';
const RETURN_TO = 'returnTo';

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** The shell's own rule for returnTo: a path inside the module (no scheme, no host, no tricks). */
export function isSafeReturnTo(value: string | null | undefined): value is string {
  if (!value) return false;
  let path: string;
  try {
    path = decodeURIComponent(value);
  } catch {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') && !/[\u0000-\u001F\u007F]/.test(path);
}

export interface Handoff {
  pass: string;
  /** Where to go after signing in; null means the home page. */
  returnTo: string | null;
}

/**
 * Takes the module pass (and returnTo) out of the address bar, so they never
 * stay in history or bookmarks, and returns them. The fragment is where the
 * shell puts them; the query string is accepted too.
 */
export function takeHandoff(win: Pick<Window, 'location' | 'history'> = window): Handoff | null {
  const url = new URL(win.location.href);
  let pass: string | null = null;
  let returnTo: string | null = null;
  const take = (params: URLSearchParams) => {
    const t = params.get(TOKEN);
    if (t && JWT_SHAPE.test(t)) {
      pass ??= t;
      params.delete(TOKEN);
      const r = params.get(RETURN_TO);
      if (r !== null) {
        if (isSafeReturnTo(r)) returnTo ??= r;
        params.delete(RETURN_TO);
      }
    }
  };
  const fragment = url.hash.replace(/^#/, '');
  if (fragment.includes('=')) {
    const params = new URLSearchParams(fragment);
    take(params);
    const rest = params.toString();
    url.hash = rest ? `#${rest}` : '';
  }
  take(url.searchParams);
  if (!pass) return null;
  win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
  return { pass, returnTo };
}
