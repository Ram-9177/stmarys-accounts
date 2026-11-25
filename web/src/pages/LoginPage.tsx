import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { errorMessage, get, post } from '@/api/client';
import { usePublicColleges } from '@/api/hooks';
import type { College } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Button, ErrorBox, Field, Input, Spinner } from '@/components/ui';
import { collegeLogo } from '@/lib/colleges';
import { mayAutoReenter, rememberedCampus } from '@/uos/links';

interface AuthOptions {
  needsBootstrap: boolean;
  ssoEnabled: boolean;
  legacyLogin?: boolean;
  uosEnabled?: boolean;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">{children}</div>
      <p className="pb-6 text-center text-xs text-ink-40">St. Mary&apos;s Group of Institutions · Accounts · UOS</p>
    </div>
  );
}

function Brand({ title, subtitle, logo }: { title: ReactNode; subtitle?: ReactNode; logo?: string }) {
  return (
    <div className="flex items-center gap-3">
      <img src={logo ?? '/assets/logo_smgg.png'} alt="" className="size-11 rounded-full object-cover ring-1 ring-sand-200" />
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-sand-600">{subtitle}</p>}
      </div>
    </div>
  );
}

/** The shell's .auth-card. */
const cardClass = 'w-full max-w-[420px] rounded-2xl bg-surface-1 p-7 shadow-elev-2';

export function LoginPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const colleges = usePublicColleges();
  const options = useQuery({ queryKey: ['auth-options'], queryFn: () => get<AuthOptions>('/api/auth/options') });
  const [picked, setPicked] = useState<College | null>(null);
  const [withPassword, setWithPassword] = useState(false);
  const uosOn = !!auth.uosConfig?.enabled;
  const legacy = options.data?.legacyLogin ?? true;
  const [reentering, setReentering] = useState(false);

  // Someone whose UOS session ended (or on a UOS-only site) goes straight back through UOS.
  const { status, entryError, enterFromUos, uosSessionEnded } = auth;
  useEffect(() => {
    if (status !== 'anonymous' || !uosOn || entryError || !options.data) return;
    if (legacy && !uosSessionEnded) return;
    if (rememberedCampus() && mayAutoReenter()) {
      setReentering(true);
      enterFromUos(from);
    }
  }, [status, entryError, enterFromUos, uosSessionEnded, uosOn, legacy, from, options.data]);

  if (auth.status === 'authenticated') return <Navigate to={from} replace />;
  if (auth.status === 'loading' || auth.uosConfig === null || options.isLoading || reentering) {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-3 text-sand-600">
          <Spinner className="size-7 text-maroon-700" />
          {reentering && <p className="text-sm">Opening Accounts through UOS…</p>}
        </div>
      </Screen>
    );
  }

  if (options.data?.needsBootstrap) {
    return (
      <Screen>
        <BootstrapCard />
      </Screen>
    );
  }

  const passwordFlow = !picked ? (
    <CollegePicker colleges={colleges.data} loading={colleges.isLoading} onPick={setPicked} onBack={uosOn ? () => setWithPassword(false) : undefined} />
  ) : (
    <LoginCard college={picked} ssoEnabled={!!options.data?.ssoEnabled} initialError={params.get('error') ?? ''} onBack={() => setPicked(null)} />
  );

  if (!uosOn || withPassword) return <Screen>{passwordFlow}</Screen>;

  return (
    <Screen>
      <UosEntryCard from={from} legacy={legacy} onUsePassword={() => setWithPassword(true)} />
    </Screen>
  );
}

/** The way in when Accounts is a UOS module. */
function UosEntryCard({ from, legacy, onUsePassword }: { from: string; legacy: boolean; onUsePassword: () => void }) {
  const { entryError, enterFromUos, uosConfig } = useAuth();
  return (
    <div className={cardClass}>
      <Brand title="St. Mary's Accounts" subtitle="Vouchers, cash book and vendor ledger · a UOS module" />
      {entryError?.pending ? (
        <div role="status" className="mt-6 rounded-xl bg-warning-tint p-4 text-sm text-warning ring-1 ring-inset ring-current/15">
          <p className="flex items-center gap-2 font-medium">
            <Icon name="clock" className="text-warning" /> Waiting for approval
          </p>
          <p className="mt-1">{entryError.message}</p>
        </div>
      ) : (
        <>
          <p className="mt-6 text-sm text-sand-600">Open Accounts from the UOS launcher with your university sign-in.</p>
          {entryError && (
            <div className="mt-4">
              <ErrorBox>{entryError.message}</ErrorBox>
            </div>
          )}
        </>
      )}
      <div className="mt-6 flex flex-col gap-2.5">
        {entryError?.pending ? (
          <a
            href={uosConfig?.shellUrl}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface-1 text-[14.5px] font-semibold text-fg shadow-card hover:bg-surface-2"
          >
            <Icon name="apps" className="size-4" /> Back to UOS
          </a>
        ) : (
          <Button className="w-full" icon={<Icon name="apps" className="size-4" />} onClick={() => enterFromUos(from)}>
            {entryError ? 'Try again through UOS' : 'Continue with UOS'}
          </Button>
        )}
        {legacy && (
          <button type="button" onClick={onUsePassword} className="h-11 rounded-lg text-sm font-semibold text-accent hover:bg-surface-2">
            Sign in with an Accounts password instead
          </button>
        )}
      </div>
    </div>
  );
}

function CollegePicker({
  colleges,
  loading,
  onPick,
  onBack,
}: {
  colleges?: College[];
  loading: boolean;
  onPick: (c: College) => void;
  onBack?: () => void;
}) {
  return (
    <div className="w-full max-w-4xl">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-ink">Select your college</h1>
        <p className="mt-1 text-sm text-sand-600">Choose the institution whose books you want to open</p>
        {onBack && (
          <button type="button" onClick={onBack} className="mt-2 text-xs font-medium text-maroon-700 hover:underline">
            ← Back to UOS sign-in
          </button>
        )}
      </div>
      {loading ? (
        <Spinner className="mx-auto mt-10 size-7 text-maroon-700" />
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {colleges?.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => onPick(c)}
              className="group flex flex-col items-center rounded-2xl border border-sand-200 bg-surface-1 p-6 text-center shadow-card transition hover:border-maroon-500/40 hover:shadow-md"
            >
              <img src={collegeLogo(c)} alt="" className="size-16 rounded-full object-cover ring-1 ring-sand-200" />
              <h2 className="mt-4 text-base font-semibold text-ink">{c.name}</h2>
              <p className="mt-0.5 text-sm text-sand-600">{c.location}</p>
              <span className="mt-4 text-sm font-medium text-maroon-700 group-hover:underline">Continue →</span>
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
    <div className={cardClass}>
      <Brand title={college.name} subtitle="Accounts · sign in" logo={collegeLogo(college)} />
      <button type="button" onClick={onBack} className="mt-3 text-xs font-medium text-maroon-700 hover:underline">
        ← Switch college
      </button>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
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
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line bg-surface-1 text-[14.5px] font-semibold text-fg shadow-card hover:bg-surface-2"
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
    <div className={cardClass}>
      <Brand title="First-time setup" subtitle="St. Mary's Accounts" />
      <p className="mt-4 text-sm text-sand-600">
        Choose the main administrator password. It is used to sign in as <b>superadmin</b> on every campus.
      </p>
      {done ? (
        <p className="mt-6 rounded-lg bg-success-tint p-3 text-sm text-success">Administrator created. Loading sign-in…</p>
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
