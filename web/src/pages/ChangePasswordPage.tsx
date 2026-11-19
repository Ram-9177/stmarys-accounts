import { useState, type FormEvent } from 'react';
import { errorMessage, post } from '@/api/client';
import type { CurrentUser } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

/** Change your own password. Shown full-screen when an admin has set a temporary password. */
export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError('');
    try {
      const r = await post<{ user: CurrentUser }>('/api/auth/change-password', { password });
      setUser(r.user);
      setPassword('');
      setConfirm('');
      toast('Password changed. Other devices were signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {forced && (
        <p className="rounded-lg bg-yellow-50 p-3 text-sm text-sand-800">
          Your administrator set a temporary password. Choose a new one to continue.
        </p>
      )}
      <Field label="New password" hint="At least 8 characters.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" loading={busy}>
        Change password
      </Button>
    </form>
  );
}

export function ForcedPasswordChange() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-sand-50 px-4">
      <Card className="w-full max-w-md" title={`Welcome, ${user?.fullName || user?.displayName}`}>
        <ChangePasswordForm forced />
        <button type="button" onClick={logout} className="mt-4 text-xs text-sand-600 underline">
          Sign out
        </button>
      </Card>
    </div>
  );
}
