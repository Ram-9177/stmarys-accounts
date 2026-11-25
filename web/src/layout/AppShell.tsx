import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useColleges } from '@/api/hooks';
import type { College } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { LinkExcelPill } from '@/features/reports';
import { collegeLogo } from '@/lib/colleges';
import { type ThemeChoice, useTheme } from '@/lib/theme';
import { UosSessionWatch } from '@/uos/UosSessionWatch';
import { NAV } from './nav';

/**
 * The module frame, laid out like the UOS shell (uos-auth-ui): on a desktop a
 * 244px nav on the left (--bg-2, brand at the top) and the accent "band" across
 * the top of the page; on a phone the band on top and the nav as a drawer.
 */
export function AppShell() {
  const { user, college, can, uos } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const colleges = useColleges();
  const current = colleges.data?.find((c) => c.code === college);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    // The shell's .screen-mobile grid: "nav header" "nav body" / 244px 1fr, the header row sized to its content.
    <div className="min-h-dvh lg:grid lg:grid-cols-[244px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:[grid-template-areas:'nav_header''nav_body']">
      {/* ---- nav ---- */}
      <nav
        aria-label="Accounts"
        className={cx(
          'no-print fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col gap-0.5 overflow-y-auto border-r border-hair bg-bg-2 px-3 py-5 transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-auto lg:translate-x-0 lg:[grid-area:nav]',
          menuOpen ? 'translate-x-0 shadow-elev-3' : '-translate-x-full',
        )}
      >
        <Link to="/" className="mb-3 flex items-center gap-2.5 px-3 py-1 text-[15px] font-bold tracking-[-0.01em] text-fg">
          <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-md bg-fg text-[13px] font-extrabold text-bg">A</span>
          <span className="min-w-0 truncate">
            Accounts <span className="font-medium text-ink-40">· {current?.code?.toUpperCase() ?? 'UOS'}</span>
          </span>
        </Link>
        {uos && (
          <a href={uos.shellUrl} className={navItem(false)}>
            <Icon name="apps" className="size-5 text-accent" />
            UOS launcher
          </a>
        )}
        <div className="mb-2 lg:hidden">
          <CollegeSwitcher colleges={colleges.data} full />
        </div>
        <div className="flex-1">
          {NAV.map((group) => {
            const items = group.items.filter((i) => i.visible(user, can));
            if (!items.length) return null;
            return (
              <div key={group.title}>
                <p className="px-3 pt-3.5 pb-1.5 text-[10.5px] font-bold tracking-[0.14em] text-ink-40 uppercase">{group.title}</p>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end className={({ isActive }) => navItem(isActive || inSection(item.to, location.pathname))}>
                    {({ isActive }) => (
                      <>
                        <Icon name={item.icon} className={cx('size-5', isActive || inSection(item.to, location.pathname) ? 'text-accent' : 'text-muted')} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </div>
        {uos && (
          <div className="mt-4 rounded-lg bg-surface-1 px-3 py-2.5 text-xs text-ink-50 shadow-card">
            <p className="font-semibold text-fg">UOS · {uos.campusName || uos.campusCode || 'Campus'}</p>
            <p className="mt-0.5">Opened from the UOS launcher.</p>
          </div>
        )}
      </nav>
      {menuOpen && <div className="no-print fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      {/* ---- band ---- */}
      <header className="no-print rounded-b-2xl bg-accent-block px-5 pt-5 pb-6 text-accent-block-fg lg:rounded-none lg:px-8 lg:py-[22px] lg:[grid-area:header]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="-ml-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10 lg:hidden"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <img src={collegeLogo(current ?? college)} alt="" className="hidden size-10 shrink-0 rounded-full bg-white object-cover ring-2 ring-white/25 sm:block" />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-xl leading-tight font-extrabold tracking-[-0.02em] lg:text-[22px]">
              {current?.name ?? "St. Mary's Institutions"}
            </h2>
            <p className="mt-0.5 text-xs opacity-80">
              Accounts{uos ? ` · ${uos.campusName || uos.campusCode || 'UOS'}` : ''}
            </p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <CollegeSwitcher colleges={colleges.data} onBand />
            {can('link_excel') && <LinkExcelPill />}
          </div>
          <UserMenu />
        </div>
      </header>

      {/* ---- body ---- */}
      <div className="min-w-0 lg:[grid-area:body]">
        {uos && <UosSessionWatch />}
        <main key={location.pathname + college} className="min-w-0 px-4 py-6 sm:px-5 lg:px-8 lg:pt-5 lg:pb-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** An advance's own page belongs to "Advances" in the nav. */
function inSection(to: string, path: string) {
  return to === '/advances' && /^\/advances\/\d+$/.test(path);
}

/** The shell's .nav-item: 44px rows, the current page on --surface-2 with a hairline and the icon in the accent. */
function navItem(active: boolean) {
  return cx(
    'flex h-11 items-center gap-[11px] rounded-md px-3 text-[13.5px] font-medium transition-colors',
    active ? 'bg-surface-2 text-fg ring-1 ring-inset ring-line' : 'text-ink-60 hover:bg-surface-2 hover:text-fg',
  );
}

/** Colleges this user can switch to. In UOS, colleges on another campus re-open Accounts for that campus. */
function CollegeSwitcher({ colleges, full, onBand }: { colleges?: College[]; full?: boolean; onBand?: boolean }) {
  const { college, setCollege, switchableColleges, uos } = useSession();
  const byCode = new Map((colleges ?? []).filter((c) => c.status !== 'inactive').map((c) => [c.code, c]));
  const here = switchableColleges.filter((c) => byCode.has(c) && (!uos || uos.colleges.includes(c)));
  const elsewhere = uos ? switchableColleges.filter((c) => byCode.has(c) && !uos.colleges.includes(c)) : [];
  if (here.length + elsewhere.length < 2) return null;
  const label = (c: string) => byCode.get(c)?.name ?? c;
  const option = (c: string) => (
    <option key={c} value={c} className="bg-surface-1 text-fg">
      {label(c)}
    </option>
  );
  return (
    <select
      aria-label="Switch college"
      value={college}
      onChange={(e) => setCollege(e.target.value)}
      className={cx(
        'h-10 cursor-pointer rounded-full pr-8 pl-4 text-[13px] font-semibold focus:outline-none',
        onBand
          ? 'max-w-64 border border-white/25 bg-white/10 text-accent-block-fg hover:bg-white/15'
          : 'w-full border border-line bg-surface-1 text-fg shadow-card',
        full && 'w-full',
      )}
    >
      {elsewhere.length ? (
        <>
          <optgroup label={uos?.campusName || uos?.campusCode || 'This campus'}>{here.map(option)}</optgroup>
          <optgroup label="Other campuses (opens through UOS)">{elsewhere.map(option)}</optgroup>
        </>
      ) : (
        here.map(option)
      )}
    </select>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

function UserMenu() {
  const { user, logout, uos } = useSession();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = user.fullName || user.displayName;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const item = 'flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm font-semibold text-fg hover:bg-surface-2';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {/* The shell's .avatar */}
        <span className="flex size-[34px] items-center justify-center rounded-full bg-accent-block-fg text-xs font-extrabold text-accent-block">{initials(name)}</span>
        <span className="hidden max-w-40 truncate text-sm font-semibold sm:block">{name}</span>
        <Icon name="chevronDown" className="hidden size-4 opacity-70 sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-50 flex w-72 flex-col gap-0.5 rounded-lg border border-hair bg-surface-1 p-1.5 text-fg shadow-elev-3">
          <div className="px-3 pt-2 pb-2.5">
            <p className="truncate text-sm font-bold">{name}</p>
            <p className="truncate text-xs text-ink-50">{user.email || user.displayName}</p>
            {uos && <p className="mt-1 text-xs text-ink-40">Signed in through UOS · {uos.campusName || uos.campusCode}</p>}
          </div>
          <div className="px-3 pb-2">
            <p className="pb-1.5 text-[10.5px] font-bold tracking-[0.14em] text-ink-40 uppercase">Theme</p>
            {/* The shell's .segmented */}
            <div role="group" aria-label="Theme" className="inline-flex gap-0.5 rounded-full bg-surface-2 p-[3px]">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={theme === t.value}
                  onClick={() => setTheme(t.value)}
                  className={cx(
                    'h-8 rounded-full px-3.5 text-[13px] font-semibold',
                    theme === t.value ? 'bg-fg text-bg' : 'text-muted hover:text-fg',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="my-1 border-t border-hair" />
          <Link role="menuitem" to="/account" onClick={() => setOpen(false)} className={item}>
            <Icon name="account" className="size-4 text-muted" /> My account
          </Link>
          {uos && (
            <a role="menuitem" href={uos.shellUrl} className={item}>
              <Icon name="apps" className="size-4 text-muted" /> Back to UOS
            </a>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className={cx(item, 'text-danger')}
          >
            <Icon name="logout" className="size-4" /> {uos ? 'Sign out of Accounts' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
