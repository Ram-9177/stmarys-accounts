import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { errorMessage, get, post } from '@/api/client';
import { usePublicColleges } from '@/api/hooks';
import type { College } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { collegeLogo } from '@/lib/colleges';

interface AuthOptions {
  needsBootstrap: boolean;
  ssoEnabled: boolean;
}

export function LoginPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const colleges = usePublicColleges();
  const options = useQuery({ queryKey: ['auth-options'], queryFn: () => get<AuthOptions>('/api/auth/options') });
  const [picked, setPicked] = useState<College | null>(null);

  if (auth.status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh bg-gradient-to-br from-maroon-800 via-maroon-700 to-maroon-500 px-4 py-10">
      {options.data?.needsBootstrap ? (
        <BootstrapCard />
      ) : !picked ? (
        <CollegePicker colleges={colleges.data} loading={colleges.isLoading} onPick={setPicked} />
      ) : (
        <LoginCard
          college={picked}
          ssoEnabled={!!options.data?.ssoEnabled}
          initialError={params.get('error') ?? ''}
          onBack={() => setPicked(null)}
        />
      )}
    </div>
  );
}

function CollegePicker({ colleges, loading, onPick }: { colleges?: College[]; loading: boolean; onPick: (c: College) => void }) {
  return (
    <div className="mx-auto max-w-5xl text-center">
      <h1 className="text-4xl font-semibold text-white">Select your College</h1>
      <p className="mt-2 text-maroon-100">Choose the institution to sign in to its voucher system</p>
      {loading ? (
        <Spinner className="mx-auto mt-10 size-8 text-white" />
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {colleges?.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => onPick(c)}
              className="group flex flex-col items-center rounded-2xl bg-white p-6 text-center shadow-xl transition hover:-translate-y-1"
            >
              <img src={collegeLogo(c)} alt="" className="size-20 rounded-full border-4 border-gold-500 object-cover" />
              <h2 className="mt-4 text-xl font-semibold text-maroon-800">{c.name}</h2>
              <p className="mt-1 text-sm text-sand-600">{c.location}</p>
              <span className="mt-4 rounded-lg bg-maroon-700 px-4 py-2 text-sm font-medium text-white group-hover:bg-maroon-800">
                Continue →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginCard({ college, ssoEnabled, initialError, onBack }: { college: College; ssoEnabled: boolean; initialError: string; onBack: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password, college.code);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-2xl">
      <div className="text-center">
        <img src={collegeLogo(college)} alt="" className="mx-auto size-20 rounded-full border-[3px] border-gold-500 object-cover" />
        <h1 className="mt-3 text-2xl font-semibold text-maroon-800">{college.name}</h1>
        <p className="text-sm text-sand-600">Voucher Entry System · Secured Admin Portal</p>
        <button type="button" onClick={onBack} className="mt-2 text-xs text-maroon-600 underline">
          ← Switch College
        </button>
      </div>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label="Username" htmlFor="login-user" hint="Main administrators sign in as “superadmin”.">
          <Input id="login-user" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="login-pass">
          <Input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" loading={busy} className="w-full">
          Sign In
        </Button>
        {ssoEnabled && (
          <a
            href={`/api/auth/sso/microsoft?college=${encodeURIComponent(college.code)}`}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sand-200 text-sm font-medium hover:bg-sand-50"
          >
            <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
              <rect width="10" height="10" fill="#f25022" />
              <rect x="11" width="10" height="10" fill="#7fba00" />
              <rect y="11" width="10" height="10" fill="#00a4ef" />
              <rect x="11" y="11" width="10" height="10" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </a>
        )}
      </form>
    </div>
  );
}

/** First run on an empty database: create the three campus main administrators. */
function BootstrapCard() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/bootstrap', { password });
      setDone(true);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-2xl">
      <h1 className="text-2xl font-semibold text-maroon-800">First-time setup</h1>
      <p className="mt-1 text-sm text-sand-600">
        Choose the main administrator password. It is used to sign in as <b>superadmin</b> on every campus.
      </p>
      {done ? (
        <p className="mt-6 rounded-lg bg-green-50 p-3 text-sm text-credit">Administrator created. Loading sign-in…</p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <Field label="Password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </Field>
          <Field label="Confirm password">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorBox>{error}</ErrorBox>
          <Button type="submit" loading={busy}>
            Create administrator
          </Button>
        </form>
      )}
    </div>
  );
}
