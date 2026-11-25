/**
 * The UOS shell opens a module by redirecting to it with a module pass in the
 * URL (the handoff). These are the names it may use, in the query string or
 * the fragment. Pin the real one in docs/UOS_INTEGRATION.md once confirmed
 * against uos-auth-ui.
 */
export const HANDOFF_PARAMS = ['pass', 'token', 'access_token', 'module_pass', 'module_token', 'modulePass', 'moduleToken', 'uos_pass'];

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/**
 * Takes the module pass out of the address bar (so it never stays in history,
 * bookmarks or Referer headers) and returns it. Only JWT-shaped values count.
 */
export function takeHandoffPass(win: Pick<Window, 'location' | 'history'> = window): string | null {
  const url = new URL(win.location.href);
  let pass: string | null = null;
  const take = (params: URLSearchParams) => {
    for (const k of HANDOFF_PARAMS) {
      const v = params.get(k);
      if (v && JWT_SHAPE.test(v)) {
        pass ??= v;
        params.delete(k);
      }
    }
  };
  take(url.searchParams);
  const fragment = url.hash.replace(/^#/, '');
  if (fragment.includes('=')) {
    const params = new URLSearchParams(fragment);
    take(params);
    const rest = params.toString();
    url.hash = rest ? `#${rest}` : '';
  }
  if (!pass) return null;
  win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash);
  return pass;
}
