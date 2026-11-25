import { Navigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Spinner } from '@/components/ui';

/**
 * Where the UOS shell lands when it opens Accounts:
 * /sso-callback#token=<pass>&returnTo=<path>. AuthProvider has already taken the
 * pass out of the address bar and signed in with it; this page only waits for
 * that and then goes to returnTo (or the home page). If signing in failed, the
 * sign-in page shows why.
 */
export function SsoCallbackPage() {
  const { status, handoffReturnTo } = useAuth();
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-ink-50" role="status">
        <Spinner className="size-7 text-accent" />
        <p className="text-sm">Signing you in…</p>
      </div>
    );
  }
  if (status === 'authenticated') return <Navigate to={handoffReturnTo ?? '/'} replace />;
  return <Navigate to="/login" replace />;
}
