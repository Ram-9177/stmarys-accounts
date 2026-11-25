import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { isSafeReturnTo, takeHandoff } from './handoff';
import { currentPath, mayAutoReenter, rememberCampus, rememberedCampus, reselectUrl } from './links';
import { hasUnsavedWork, onUnsavedChange, setUnsaved } from './unsaved';

const PASS = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';

function at(url: string) {
  window.history.replaceState(null, '', url);
}

describe('handoff', () => {
  afterEach(() => at('/'));

  it('reads the exact address the shell opens: /sso-callback#token=…&returnTo=…', () => {
    at(`/sso-callback#token=${PASS}&returnTo=${encodeURIComponent('/vouchers?college=smgg')}`);
    expect(takeHandoff()).toEqual({ pass: PASS, returnTo: '/vouchers?college=smgg' });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/sso-callback');
  });

  it('works without returnTo, and from the query string too', () => {
    at(`/sso-callback#token=${PASS}`);
    expect(takeHandoff()).toEqual({ pass: PASS, returnTo: null });
    at(`/dashboard?college=smgg&token=${PASS}`);
    expect(takeHandoff()).toEqual({ pass: PASS, returnTo: null });
    expect(window.location.pathname + window.location.search).toBe('/dashboard?college=smgg');
  });

  it('drops a returnTo that is not a path inside Accounts', () => {
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil', '%2F%2Fevil.example', 'javascript:alert(1)']) {
      at(`/sso-callback#token=${PASS}&returnTo=${encodeURIComponent(bad)}`);
      expect(takeHandoff()?.returnTo, bad).toBeNull();
      expect(window.location.hash).toBe('');
    }
  });

  it('ignores values that are not JWT-shaped and leaves the URL alone', () => {
    at('/cash-book?token=abc');
    expect(takeHandoff()).toBeNull();
    expect(window.location.search).toBe('?token=abc');
  });

  it('applies the shell rule for returnTo', () => {
    expect(isSafeReturnTo('/advances/12')).toBe(true);
    expect(isSafeReturnTo('/a%0Ab')).toBe(false);
    expect(isSafeReturnTo('')).toBe(false);
  });
});

describe('shell links', () => {
  it('builds the shell reselect URL with a path-only returnTo', () => {
    const url = new URL(reselectUrl({ shellUrl: 'https://stage.example/auth', moduleId: 'accounts' }, 'c1', '/vouchers?college=smgg'));
    expect(url.origin + url.pathname).toBe('https://stage.example/auth/reselect');
    expect(Object.fromEntries(url.searchParams)).toEqual({ moduleId: 'accounts', campusId: 'c1', returnTo: '/vouchers?college=smgg' });
    expect(new URL(reselectUrl({ shellUrl: 'https://u', moduleId: 'm' }, 'c', '//evil.example')).searchParams.get('returnTo')).toBe('/');
  });

  it('describes the current page as a path', () => {
    expect(currentPath({ pathname: '/exports', search: '?college=smwec' })).toBe('/exports?college=smwec');
    expect(currentPath({ pathname: '//evil', search: '' })).toBe('/');
  });

  it('remembers the campus and re-enters automatically at most once a minute', () => {
    rememberCampus('campus-ap');
    expect(rememberedCampus()).toBe('campus-ap');
    sessionStorage.clear();
    expect(mayAutoReenter(1_000_000)).toBe(true);
    expect(mayAutoReenter(1_030_000)).toBe(false);
    expect(mayAutoReenter(1_061_000)).toBe(true);
  });
});

describe('unsaved work', () => {
  it('tracks forms with unsaved changes and open dialogs', () => {
    const changes = vi.fn();
    const off = onUnsavedChange(changes);
    expect(hasUnsavedWork()).toBe(false);
    setUnsaved('voucher-form', true);
    expect(hasUnsavedWork()).toBe(true);
    setUnsaved('voucher-form', true); // no change, no event
    setUnsaved('voucher-form', false);
    expect(hasUnsavedWork()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    off();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    expect(hasUnsavedWork()).toBe(true);
    dialog.remove();
  });
});

describe('opening Accounts from UOS', () => {
  const uosSession = {
    moduleId: 'accounts',
    shellUrl: 'https://uos.test',
    logoutUrl: 'https://uos.test/',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    orgId: 'org-1',
    campusId: 'campus-ap',
    campusCode: 'AP',
    campusName: 'AP campus',
    colleges: ['smgg', 'smwec'],
    otherColleges: [{ code: 'smhyd', campusId: 'campus-hyd' }],
  };
  const user = {
    username: 'clerk',
    displayName: 'clerk',
    fullName: 'Clerk One',
    email: 'clerk@smru.in',
    role: 'user',
    baseRole: 'user',
    isSuperAdmin: false,
    status: 'active',
    college: 'smgg',
    collegeAccess: ['smgg', 'smwec'],
    permissions: ['create_voucher'],
    mustChangePassword: false,
  };
  let calls: { url: string; body?: unknown }[] = [];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.startsWith('/api/uos/config')) return json({ enabled: true, moduleId: 'accounts', shellUrl: 'https://uos.test', legacyLogin: true, campuses: [] });
        if (url.startsWith('/api/uos/handoff')) return json({ user, uos: uosSession });
        return json({ error: 'Login required' }, 401);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    at('/');
  });

  function Probe() {
    const a = useAuth();
    return (
      <div>
        <p>status:{a.status}</p>
        <p>user:{a.user?.username ?? '-'}</p>
        <p>campus:{a.uos?.campusId ?? '-'}</p>
        <p>college:{a.college}</p>
        <p>switch:{a.switchableColleges.join(',')}</p>
        <p>returnTo:{a.handoffReturnTo ?? '-'}</p>
      </div>
    );
  }

  it('posts the pass from the shell address once, strips it, and limits the session to the campus', async () => {
    at(`/sso-callback#token=${PASS}&returnTo=%2Fvouchers`);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('status:authenticated')).toBeInTheDocument());
    expect(screen.getByText('user:clerk')).toBeInTheDocument();
    expect(screen.getByText('campus:campus-ap')).toBeInTheDocument();
    expect(screen.getByText('switch:smgg,smwec,smhyd')).toBeInTheDocument();
    expect(screen.getByText('returnTo:/vouchers')).toBeInTheDocument();
    const handoffs = calls.filter((c) => c.url === '/api/uos/handoff');
    expect(handoffs).toEqual([{ url: '/api/uos/handoff', body: { pass: PASS } }]);
    expect(calls.some((c) => c.url.startsWith('/api/auth/me'))).toBe(false);
    expect(window.location.hash).toBe('');
    expect(rememberedCampus()).toBe('campus-ap');
  });
});
