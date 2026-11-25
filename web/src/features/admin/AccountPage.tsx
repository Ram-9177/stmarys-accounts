import type { ReactNode } from 'react';
import { useColleges } from '@/api/hooks';
import { useSession } from '@/auth/AuthProvider';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ChangePasswordForm } from '@/pages/ChangePasswordPage';
import { PERMISSION_GROUPS, ROLE_LABEL, roleOf } from './permissions';

export function AccountPage() {
  const { user, uos } = useSession();
  const colleges = useColleges();
  const name = (code: string) => colleges.data?.find((c) => c.code === code)?.name ?? code.toUpperCase();
  const perms = new Set(user.permissions);

  return (
    <>
      <PageHeader title="My Account" subtitle="Your profile, access and password." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card title="Profile">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Username">
                {user.displayName}
                {user.displayName !== user.username && <span className="ml-1 font-mono text-xs text-sand-600">({user.username})</span>}
              </Item>
              <Item label="Full name">{user.fullName || '—'}</Item>
              <Item label="Email">{user.email || <span className="text-sand-400">Not set — ask an administrator to add it for Microsoft sign-in</span>}</Item>
              <Item label="Role">
                <Badge tone={user.isSuperAdmin ? 'maroon' : 'gold'}>{user.isSuperAdmin ? 'Main administrator' : ROLE_LABEL[roleOf(user)]}</Badge>
              </Item>
              <Item label="Home college">{name(user.college)}</Item>
              <Item label="College access">
                {user.isSuperAdmin ? 'All colleges' : user.collegeAccess.map(name).join(', ')}
              </Item>
            </dl>
          </Card>
          <Card title="What you can do">
            <div className="grid gap-4 sm:grid-cols-2">
              {PERMISSION_GROUPS.map((g) => {
                const mine = g.perms.filter((p) => perms.has(p.key));
                return (
                  <div key={g.title}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-maroon-700">{g.title}</p>
                    {mine.length ? (
                      <ul className="space-y-0.5 text-sm">
                        {mine.map((p) => (
                          <li key={p.key}>✓ {p.label}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-sand-400">None</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
        {uos ? (
          <Card title="Sign-in">
            <p className="text-sm text-sand-600">
              You signed in through UOS ({uos.campusName || uos.campusCode}). Your password and sign-in are managed in UOS.
            </p>
            <a href={uos.shellUrl} className="mt-3 inline-block text-sm font-medium text-maroon-700 hover:underline">
              Open UOS →
            </a>
          </Card>
        ) : (
          <Card title="Change password">
            <ChangePasswordForm />
          </Card>
        )}
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-sand-600">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
