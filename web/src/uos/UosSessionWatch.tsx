import { useCallback, useEffect, useRef, useState } from 'react';
import { setUosReauthHandler } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { currentPath, mayAutoReenter, reselectUrl } from './links';
import { hasUnsavedWork, onUnsavedChange } from './unsaved';

/** Renew this long before the module pass expires. */
const RENEW_BEFORE_MS = 90_000;
export const RENEW_CHANNEL = 'smv-uos';
export const RENEWED_PATH = '/uos/renewed';

type Phase = 'ok' | 'ending' | 'ended';

/**
 * Keeps a UOS session going. A module pass lasts about 15 minutes and UOS
 * renews it through the shell's /reselect, which reloads the page. So:
 *  - shortly before expiry, if nothing is being edited, re-enter quietly;
 *  - if a form has unsaved changes, wait and show a banner instead. "Renew"
 *    opens the shell in a new tab; once that tab is back, this tab carries on
 *    (the pass is a cookie shared by both) with the form untouched.
 */
export function UosSessionWatch() {
  const { uos, refreshSession } = useAuth();
  const [phase, setPhase] = useState<Phase>('ok');
  const phaseRef = useRef<Phase>('ok');
  phaseRef.current = phase;

  const renewHere = useCallback(() => {
    if (!uos) return;
    window.location.assign(reselectUrl(uos, uos.campusId, currentPath()));
  }, [uos]);

  /** Automatic renewals: at most once a minute, so a misbehaving shell cannot cause a redirect loop. */
  const autoRenew = useCallback(() => {
    if (mayAutoReenter()) renewHere();
    else setPhase('ended');
  }, [renewHere]);

  const renewInNewTab = useCallback(() => {
    if (!uos) return;
    window.open(reselectUrl(uos, uos.campusId, RENEWED_PATH), '_blank');
  }, [uos]);

  // Before the pass expires.
  useEffect(() => {
    if (!uos) return;
    setPhase('ok');
    const due = Date.parse(uos.expiresAt) - Date.now() - RENEW_BEFORE_MS;
    const t = window.setTimeout(() => (hasUnsavedWork() ? setPhase('ending') : autoRenew()), Math.max(0, due));
    return () => window.clearTimeout(t);
  }, [uos, autoRenew]);

  // The API refused the pass (expired, signed out of UOS...).
  useEffect(() => {
    setUosReauthHandler(() => (hasUnsavedWork() ? setPhase('ended') : autoRenew()));
    return () => setUosReauthHandler(null);
  }, [autoRenew]);

  // The form was saved while a renewal was waiting: renew now.
  useEffect(
    () =>
      onUnsavedChange(() => {
        if (phaseRef.current !== 'ok' && !hasUnsavedWork()) autoRenew();
      }),
    [autoRenew],
  );

  // Renewed in another tab: pick up the new pass.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(RENEW_CHANNEL);
    bc.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'renewed') refreshSession().then(() => setPhase('ok'), () => undefined);
    };
    return () => bc.close();
  }, [refreshSession]);

  if (!uos || phase === 'ok') return null;
  return (
    <div role="status" className="no-print border-b border-warning/20 bg-warning-tint px-4 py-2.5 text-sm text-warning">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <Icon name="clock" className="text-warning" />
        <p className="min-w-0 flex-1">
          {phase === 'ending'
            ? 'Your UOS session ends in about a minute. Save your work, or renew now to keep going.'
            : 'Your UOS session has ended. Your unsaved work is still here: renew the session, then save.'}
        </p>
        <Button size="sm" variant="secondary" onClick={renewInNewTab} icon={<Icon name="external" className="size-4" />}>
          Renew session
        </Button>
      </div>
    </div>
  );
}
