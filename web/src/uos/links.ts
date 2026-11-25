/** Links back to the UOS shell (uos-auth-ui). */

interface ShellInfo {
  shellUrl: string;
  moduleId: string;
}

/** The current page as a path for returnTo (the shell accepts paths only). */
export function currentPath(loc: Pick<Location, 'pathname' | 'search'> = window.location): string {
  const path = `${loc.pathname}${loc.search}`;
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

/**
 * The shell's silent re-entry: it refreshes the UOS session, asks the auth
 * server for a new module pass and sends the browser back to returnTo with it.
 */
export function reselectUrl(shell: ShellInfo, campusId: string, returnTo: string): string {
  const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  const q = new URLSearchParams({ moduleId: shell.moduleId, campusId, returnTo: safe });
  return `${shell.shellUrl}/reselect?${q.toString()}`;
}

const CAMPUS_KEY = 'smv_uos_campus';

/** The campus Accounts was last opened for, to re-enter without a trip through the launcher. */
export function rememberCampus(campusId: string) {
  try {
    localStorage.setItem(CAMPUS_KEY, campusId);
  } catch {
    /* storage unavailable */
  }
}

export function rememberedCampus(): string {
  try {
    return localStorage.getItem(CAMPUS_KEY) ?? '';
  } catch {
    return '';
  }
}

const TRIED_KEY = 'smv_uos_reentry_at';

/** Guards against redirect loops: automatic re-entry at most once a minute per tab. */
export function mayAutoReenter(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(TRIED_KEY) ?? 0);
    if (now - last < 60_000) return false;
    sessionStorage.setItem(TRIED_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
