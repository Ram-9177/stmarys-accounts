import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useColleges } from '@/api/hooks';
import { useSession } from '@/auth/AuthProvider';
import { cx, Select } from '@/components/ui';
import { LinkExcelPill } from '@/features/reports';
import { collegeLogo } from '@/lib/colleges';
import { NAV } from './nav';

export function AppShell() {
  const { user, college, setCollege, logout, can } = useSession();
  const colleges = useColleges();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const current = colleges.data?.find((c) => c.code === college);
  const switchable = (colleges.data ?? []).filter(
    (c) => c.status !== 'inactive' && (user.isSuperAdmin || user.collegeAccess.includes(c.code)),
  );

  return (
    <div className="min-h-dvh">
      <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 bg-maroon-700 px-4 text-white shadow">
        <button
          type="button"
          className="rounded p-1.5 hover:bg-white/10 lg:hidden"
          aria-label="Open menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <img src={collegeLogo(current ?? college)} alt="" className="size-9 rounded-full border-2 border-gold-500 object-cover" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-serif text-lg leading-tight">{current?.name ?? "St. Mary's Institutions"}</h2>
          <p className="text-xs text-maroon-100">Voucher Entry System</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {switchable.length > 1 && (
            <Select
              aria-label="Switch college"
              value={college}
              onChange={(e) => setCollege(e.target.value)}
              className="h-8 w-auto border-white/30 bg-white/10 text-xs text-white [&>option]:text-ink"
            >
              {switchable.map((c) => (
                <option key={c.code} value={c.code}>
                  🔁 {c.name}
                </option>
              ))}
            </Select>
          )}
          {can('link_excel') && <LinkExcelPill />}
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white">
            {user.fullName || user.displayName}
          </span>
        </div>
        <button type="button" onClick={logout} className="rounded-lg border border-white/30 px-3 py-1.5 text-xs hover:bg-white/10">
          Sign Out
        </button>
      </header>

      <div className="flex">
        <nav
          className={cx(
            'no-print fixed inset-y-16 left-0 z-20 w-64 overflow-y-auto border-r border-sand-100 bg-white px-3 py-4 transition-transform lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:translate-x-0',
            menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
          )}
          onClick={() => setMenuOpen(false)}
        >
          {switchable.length > 1 && (
            <Select aria-label="Switch college" value={college} onChange={(e) => setCollege(e.target.value)} className="mb-3 md:hidden">
              {switchable.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {NAV.map((group) => {
            const items = group.items.filter((i) => i.visible(user, can));
            if (!items.length) return null;
            return (
              <div key={group.title} className="mb-4">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sand-400">{group.title}</p>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                        isActive ? 'bg-maroon-50 font-semibold text-maroon-700' : 'text-sand-800 hover:bg-sand-50',
                      )
                    }
                  >
                    <span className="w-5 text-center" aria-hidden>
                      {item.icon}
                    </span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        {menuOpen && <div className="fixed inset-0 top-16 z-10 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />}
        <main key={location.pathname + college} className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
