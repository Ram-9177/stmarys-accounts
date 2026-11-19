import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, post, setSessionLostHandler } from '@/api/client';
import type { CollegeCode, CurrentUser, Permission } from '@/api/types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  user: CurrentUser | null;
  /** College whose books are currently open. */
  college: CollegeCode;
  setCollege: (c: CollegeCode) => void;
  login: (username: string, password: string, college: CollegeCode) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  setUser: (u: CurrentUser) => void;
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

function pickCollege(user: CurrentUser, wanted: CollegeCode): CollegeCode {
  if (wanted && (user.isSuperAdmin || user.collegeAccess.includes(wanted))) return wanted;
  return user.college;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<CurrentUser | null>(null);
  const [college, setCollegeState] = useState<CollegeCode>(readStoredCollege);

  const setCollege = useCallback((c: CollegeCode) => {
    setCollegeState(c);
    try {
      localStorage.setItem(COLLEGE_KEY, c);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setUser = useCallback(
    (u: CurrentUser) => {
      setUserState(u);
      setStatus('authenticated');
      setCollege(pickCollege(u, readStoredCollege()));
    },
    [setCollege],
  );

  const signOutLocally = useCallback(() => {
    setUserState(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setSessionLostHandler(signOutLocally);
    get<{ user: CurrentUser }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
        setStatus('anonymous');
      });
    return () => setSessionLostHandler(null);
  }, [setUser, signOutLocally]);

  const login = useCallback(
    async (username: string, password: string, c: CollegeCode) => {
      const r = await post<{ user: CurrentUser }>('/api/auth/login', { username, password, college: c });
      setCollege(pickCollege(r.user, c));
      setUserState(r.user);
      setStatus('authenticated');
      return r.user;
    },
    [setCollege],
  );

  const logout = useCallback(async () => {
    try {
      await post('/api/auth/logout');
    } finally {
      signOutLocally();
    }
  }, [signOutLocally]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? []);
    const can = (p: Permission) => !!user && (user.isSuperAdmin || perms.has(p));
    return {
      status,
      user,
      college: user ? pickCollege(user, college) : college,
      setCollege,
      login,
      logout,
      setUser,
      can,
      canAny: (...ps: Permission[]) => ps.some(can),
    };
  }, [status, user, college, setCollege, login, logout, setUser]);

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
