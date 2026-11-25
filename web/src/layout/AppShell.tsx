import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useColleges } from '@/api/hooks';
import type { College } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { LinkExcelPill } from '@/features/reports';
import { collegeLogo } from '@/lib/colleges';
import { UosSessionWatch } from '@/uos/UosSessionWatch';
import { NAV } from './nav';

/**
 * The module frame, laid out like the other UOS modules: a light header with
 * the UOS launcher, the module name and the college being worked on, a
 * sidebar of the module's pages, and the page itself.
 */
export function AppShell() {
  const { user, college, can, uos } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const colleges = useColleges();
  const current = colleges.data?.find((c) => c.code === college);

  return (
    <div className="min-h-dvh bg-sand-50">
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-sand-200 bg-white px-3 sm:px-4">
        <button
          type="button"
          className="rounded-lg p-2 text-sand-600 hover:bg-sand-100 lg:hidden"
          aria-label="Open menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="menu" />
        </button>
        {uos && (
          <>
            <a
              href={uos.shellUrl}
              className="rounded-lg p-2 text-sand-600 hover:bg-sand-100 hover:text-ink"
              title="UOS launcher"
              aria-label="UOS launcher"
            >
              <Icon name="apps" />
            </a>
            <span className="hidden h-6 w-px bg-sand-200 sm:block" aria-hidden />
          </>
        )}
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-sand-50">
          <img src={collegeLogo(current ?? college)} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-sand-200" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-ink">Accounts</span>
            <span className="block truncate text-xs text-sand-600">{current?.name ?? "St. Mary's Institutions"}</span>
          </span>
        </Link>
        <div className="flex-1" />
        <div className="hidden items-center gap-2 md:flex">
          <CollegeSwitcher colleges={colleges.data} />
          {can('link_excel') && <LinkExcelPill />}
        </div>
        <UserMenu />
      </header>

      {uos && <UosSessionWatch />}

      <div className="flex">
        <nav
          className={cx(
            'no-print fixed inset-y-14 left-0 z-20 flex w-64 flex-col overflow-y-auto border-r border-sand-200 bg-white px-3 py-4 transition-transform lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:translate-x-0',
            menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
          )}
          onClick={() => setMenuOpen(false)}
        >
          <div className="mb-3 md:hidden" onClick={(e) => e.stopPropagation()}>
            <CollegeSwitcher colleges={colleges.data} full />
          </div>
          <div className="flex-1">
            {NAV.map((group) => {
              const items = group.items.filter((i) => i.visible(user, can));
              if (!items.length) return null;
              return (
                <div key={group.title} className="mb-5">
                  <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-sand-400">{group.title}</p>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end
                      className={({ isActive }) =>
                        cx(
                          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                          isActive ? 'bg-maroon-50 font-medium text-maroon-700' : 'text-sand-800 hover:bg-sand-100',
                        )
                      }
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </div>
          {uos && (
            <div className="mt-2 rounded-lg border border-sand-200 bg-sand-50 px-3 py-2.5 text-xs text-sand-600">
              <p className="font-medium text-sand-800">UOS · {uos.campusName || uos.campusCode || 'Campus'}</p>
              <p className="mt-0.5">Opened from the UOS launcher.</p>
            </div>
          )}
        </nav>
        {menuOpen && <div className="fixed inset-0 top-14 z-10 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />}
        <main key={location.pathname + college} className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Colleges this user can switch to. In UOS, colleges on another campus re-open Accounts for that campus. */
function CollegeSwitcher({ colleges, full }: { colleges?: College[]; full?: boolean }) {
  const { college, setCollege, switchableColleges, uos } = useSession();
  const byCode = new Map((colleges ?? []).filter((c) => c.status !== 'inactive').map((c) => [c.code, c]));
  const here = switchableColleges.filter((c) => byCode.has(c) && (!uos || uos.colleges.includes(c)));
  const elsewhere = uos ? switchableColleges.filter((c) => byCode.has(c) && !uos.colleges.includes(c)) : [];
  if (here.length + elsewhere.length < 2) return null;
  const label = (c: string) => byCode.get(c)?.name ?? c;
  return (
    <select
      aria-label="Switch college"
      value={college}
      onChange={(e) => setCollege(e.target.value)}
      className={cx(
        'h-8 rounded-lg border border-sand-200 bg-white pl-2.5 pr-7 text-xs font-medium text-sand-800 shadow-sm hover:bg-sand-50 focus:border-maroon-500 focus:outline-none',
        full ? 'w-full' : 'max-w-64',
      )}
    >
      {elsewhere.length ? (
        <>
          <optgroup label={uos?.campusName || uos?.campusCode || 'This campus'}>
            {here.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other campuses (opens through UOS)">
            {elsewhere.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </optgroup>
        </>
      ) : (
        here.map((c) => (
          <option key={c} value={c}>
            {label(c)}
          </option>
        ))
      )}
    </select>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

function UserMenu() {
  const { user, logout, uos } = useSession();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-sand-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-maroon-700 text-xs font-semibold text-white">{initials(name)}</span>
        <span className="hidden max-w-40 truncate text-sm font-medium text-ink sm:block">{name}</span>
        <Icon name="chevronDown" className="hidden size-4 text-sand-400 sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-sand-200 bg-white py-1 shadow-lg">
          <div className="border-b border-sand-100 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-xs text-sand-600">{user.email || user.displayName}</p>
            {uos && <p className="mt-1 text-xs text-sand-400">Signed in through UOS · {uos.campusName || uos.campusCode}</p>}
          </div>
          <Link role="menuitem" to="/account" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-sand-800 hover:bg-sand-50">
            <Icon name="account" className="size-4" /> My account
          </Link>
          {uos && (
            <a role="menuitem" href={uos.shellUrl} className="flex items-center gap-2.5 px-3 py-2 text-sm text-sand-800 hover:bg-sand-50">
              <Icon name="apps" className="size-4" /> Back to UOS
            </a>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-sand-800 hover:bg-sand-50"
          >
            <Icon name="logout" className="size-4" /> {uos ? 'Sign out of Accounts' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
