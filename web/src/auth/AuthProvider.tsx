import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, errorMessage, get, post, setSessionLostHandler, triggerUosReauth } from '@/api/client';
import type { CollegeCode, CurrentUser, Permission, UosConfig, UosSession } from '@/api/types';
import { takeHandoffPass } from '@/uos/handoff';
import { currentPath, rememberCampus, rememberedCampus, reselectUrl } from '@/uos/links';

type Status = 'loading' | 'anonymous' | 'authenticated';

/** Why opening Accounts from UOS did not work (shown on the sign-in page). */
export interface EntryError {
  message: string;
  /** The person's Accounts user exists but waits for an admin's approval. */
  pending: boolean;
}

interface AuthState {
  status: Status;
  user: CurrentUser | null;
  /** Set when signed in through UOS: the campus and expiry of the module pass. */
  uos: UosSession | null;
  /** Public UOS settings (null while loading). */
  uosConfig: UosConfig | null;
  entryError: EntryError | null;
  /** The last session came from UOS and has ended: re-enter through UOS. */
  uosSessionEnded: boolean;
  /** College whose books are currently open. */
  college: CollegeCode;
  /** Colleges the user can switch to (in a UOS session: the pass's campus, plus other campuses via UOS). */
  switchableColleges: CollegeCode[];
  setCollege: (c: CollegeCode) => void;
  login: (username: string, password: string, college: CollegeCode) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  setUser: (u: CurrentUser) => void;
  /** Re-reads the session (after the pass was renewed in another tab). */
  refreshSession: () => Promise<void>;
  /** Sends the browser to the UOS shell to (re-)open Accounts. */
  enterFromUos: (returnTo?: string, campusId?: string) => void;
  can: (p: Permission) => boolean;
  canAny: (...p: Permission[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);
const COLLEGE_KEY = 'smv_college';

function readStoredCollege(): CollegeCode {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('college');
    return fromUrl || localStorage.getItem(COLLEGE_KEY) || '';
  } catch {
    return '';
  }
}

function pickCollege(user: CurrentUser, wanted: CollegeCode, scoped: boolean): CollegeCode {
  const allowed = scoped ? user.collegeAccess.includes(wanted) : user.isSuperAdmin || user.collegeAccess.includes(wanted);
  if (wanted && allowed) return wanted;
  return scoped && !user.collegeAccess.includes(user.college) ? (user.collegeAccess[0] ?? user.college) : user.college;
}

interface SessionReply {
  user: CurrentUser;
  uos?: UosSession | null;
}

/**
 * One start-up request per page load, shared by React StrictMode's double effect:
 * the UOS handoff when the URL carries a module pass, otherwise "who am I".
 */
let startup: { promise: Promise<SessionReply>; handoff: boolean } | null = null;
function startSession() {
  if (!startup) {
    const pass = takeHandoffPass();
    const promise = pass ? post<SessionReply>('/api/uos/handoff', { pass }) : get<SessionReply>('/api/auth/me');
    const entry = { promise, handoff: !!pass };
    startup = entry;
    promise
      .finally(() =>
        setTimeout(() => {
          if (startup === entry) startup = null;
        }, 0),
      )
      .catch(() => undefined);
  }
  return startup;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<CurrentUser | null>(null);
  const [uos, setUos] = useState<UosSession | null>(null);
  const [uosConfig, setUosConfig] = useState<UosConfig | null>(null);
  const [entryError, setEntryError] = useState<EntryError | null>(null);
  const [uosSessionEnded, setUosSessionEnded] = useState(false);
  const [college, setCollegeState] = useState<CollegeCode>(readStoredCollege);

  const storeCollege = useCallback((c: CollegeCode) => {
    setCollegeState(c);
    try {
      localStorage.setItem(COLLEGE_KEY, c);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const applySession = useCallback(
    (r: SessionReply) => {
      const session = r.uos ?? null;
      setUos(session);
      setUserState(r.user);
      setStatus('authenticated');
      setEntryError(null);
      if (session) rememberCampus(session.campusId);
      storeCollege(pickCollege(r.user, readStoredCollege(), !!session));
    },
    [storeCollege],
  );

  const setUser = useCallback(
    (u: CurrentUser) => {
      setUserState(u);
      setStatus('authenticated');
      storeCollege(pickCollege(u, readStoredCollege(), false));
    },
    [storeCollege],
  );

  const signOutLocally = useCallback(() => {
    setUserState(null);
    setUos(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  // In a UOS session, never drop to the sign-in page (and lose a half-filled form):
  // re-enter through UOS instead (see UosSessionWatch).
  const uosRef = useRef<UosSession | null>(null);
  uosRef.current = uos;

  useEffect(() => {
    setSessionLostHandler(() => (uosRef.current ? triggerUosReauth() : signOutLocally()));
    get<UosConfig>('/api/uos/config')
      .then(setUosConfig)
      .catch(() => setUosConfig({ enabled: false }));
    const { promise, handoff } = startSession();
    promise.then(applySession).catch((e) => {
      if (handoff) {
        const pending = e instanceof ApiError && e.status === 403 && /waiting for approval/i.test(e.message);
        setEntryError({ message: errorMessage(e), pending });
      } else if (e instanceof ApiError && e.status === 401) {
        setUosSessionEnded((e.data as { reauth?: string } | undefined)?.reauth === 'uos');
      } else {
        console.error(e);
      }
      setStatus('anonymous');
    });
    return () => setSessionLostHandler(null);
  }, [applySession, signOutLocally]);

  const enterFromUos = useCallback(
    (returnTo = '/', campusId?: string) => {
      const cfg = uos ?? uosConfig;
      if (!cfg?.shellUrl || !cfg.moduleId) return;
      const campus = campusId || uos?.campusId || rememberedCampus();
      // Without a known campus, the launcher is the way in.
      window.location.assign(campus ? reselectUrl({ shellUrl: cfg.shellUrl, moduleId: cfg.moduleId }, campus, returnTo) : cfg.shellUrl);
    },
    [uos, uosConfig],
  );

  const setCollege = useCallback(
    (c: CollegeCode) => {
      const other = uos?.otherColleges.find((o) => o.code === c);
      if (uos && !uos.colleges.includes(c) && other) {
        // Another campus: UOS issues passes per campus, so re-enter for that one.
        const path = new URL(currentPath(), window.location.origin);
        path.searchParams.set('college', c);
        storeCollege(c);
        enterFromUos(path.pathname + path.search, other.campusId);
        return;
      }
      storeCollege(c);
    },
    [uos, storeCollege, enterFromUos],
  );

  const login = useCallback(
    async (username: string, password: string, c: CollegeCode) => {
      const r = await post<{ user: CurrentUser }>('/api/auth/login', { username, password, college: c });
      storeCollege(pickCollege(r.user, c, false));
      setUserState(r.user);
      setUos(null);
      setStatus('authenticated');
      return r.user;
    },
    [storeCollege],
  );

  const logout = useCallback(async () => {
    if (uos) {
      const next = uos.logoutUrl || uos.shellUrl;
      try {
        await post('/api/uos/logout');
      } finally {
        signOutLocally();
        window.location.assign(next);
      }
      return;
    }
    try {
      await post('/api/auth/logout');
    } finally {
      signOutLocally();
    }
  }, [uos, signOutLocally]);

  const refreshSession = useCallback(async () => {
    const r = await get<SessionReply>('/api/auth/me');
    applySession(r);
    await qc.invalidateQueries();
  }, [applySession, qc]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? []);
    const can = (p: Permission) => !!user && (user.isSuperAdmin || perms.has(p));
    const scoped = !!uos;
    const switchableColleges = user
      ? scoped
        ? [...user.collegeAccess, ...uos.otherColleges.map((o) => o.code).filter((c) => !user.collegeAccess.includes(c))]
        : user.collegeAccess
      : [];
    return {
      status,
      user,
      uos,
      uosConfig,
      entryError,
      uosSessionEnded,
      college: user ? pickCollege(user, college, scoped) : college,
      switchableColleges,
      setCollege,
      login,
      logout,
      setUser,
      refreshSession,
      enterFromUos,
      can,
      canAny: (...ps: Permission[]) => ps.some(can),
    };
  }, [status, user, uos, uosConfig, entryError, uosSessionEnded, college, setCollege, login, logout, setUser, refreshSession, enterFromUos]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For pages that only render once signed in. */
export function useSession() {
  const a = useAuth();
  if (!a.user) throw new Error('useSession used without a signed-in user');
  return { ...a, user: a.user };
}

/** Admin-level voucher visibility (mirrors server isVoucherAdmin / canViewAllVouchers). */
export function isVoucherAdmin(u: CurrentUser | null): boolean {
  return !!u && (u.isSuperAdmin || u.baseRole === 'admin' || u.role === 'head');
}
