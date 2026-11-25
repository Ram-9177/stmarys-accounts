import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Spinner } from '@/components/ui';
import { RENEW_CHANNEL } from '@/uos/UosSessionWatch';

/**
 * Landing page of a renewal opened in a new tab (see UosSessionWatch): the
 * handoff has stored the new pass, so tell the other tab and close this one.
 */
export function RenewedPage() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(RENEW_CHANNEL);
      bc.postMessage({ type: 'renewed' });
      bc.close();
    }
    const t = window.setTimeout(() => window.close(), 600);
    return () => window.clearTimeout(t);
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-maroon-700">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-sand-50 px-4">
      <div className="max-w-sm rounded-xl border border-sand-200 bg-white p-6 text-center shadow-card">
        <p className="text-base font-semibold text-ink">Session renewed</p>
        <p className="mt-1 text-sm text-sand-600">You can close this tab and carry on in Accounts. Your unsaved work is still in the other tab.</p>
      </div>
    </div>
  );
}
