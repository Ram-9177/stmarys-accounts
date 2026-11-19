import { useMemo, useState, type FormEvent } from 'react';
import { errorMessage } from '@/api/client';
import { useColleges, useDeleteUser, useResetPassword, useSetUserStatus, useUsers } from '@/api/hooks';
import type { ManagedUser } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dateTime } from '@/lib/format';
import { PasswordInput } from './PasswordInput';
import { canResetPassword, manageBlockReason, permissionLabel, ROLE_LABEL, roleOf, validatePassword } from './permissions';
import { UserFormModal } from './UserFormModal';

type Pending = { kind: 'delete' | 'block' | 'unblock'; user: ManagedUser } | null;

export function UsersPage() {
  const { user: actor, can, logout } = useSession();
  const toast = useToast();
  const users = useUsers();
  const colleges = useColleges();
  const setStatus = useSetUserStatus();
  const del = useDeleteUser();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'blocked'>('');
  const [collegeFilter, setCollegeFilter] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const collegeName = (code: string) => colleges.data?.find((c) => c.code === code)?.name ?? code.toUpperCase();
  const canCreate = can('create_users') || can('create_admin');
  const canEdit = can('manage_permissions');
  const canBlock = can('block_users');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (users.data?.users ?? []).filter((u) => {
      if (statusFilter && u.status !== statusFilter) return false;
      if (collegeFilter && u.college !== collegeFilter && !u.collegeAccess.includes(collegeFilter)) return false;
      if (!term) return true;
      return [u.username, u.displayName, u.fullName, u.email, u.role, u.college].some((v) => v?.toLowerCase().includes(term));
    });
  }, [users.data, q, statusFilter, collegeFilter]);

  async function confirmPending() {
    if (!pending) return;
    const { kind, user } = pending;
    try {
      if (kind === 'delete') {
        await del.mutateAsync({ username: user.username });
        toast(`Deleted ${user.displayName}`);
      } else {
        await setStatus.mutateAsync({ username: user.username, status: kind === 'block' ? 'blocked' : 'active' });
        toast(kind === 'block' ? `${user.displayName} blocked and signed out` : `${user.displayName} activated`);
      }
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Users & Permissions"
        subtitle="Create accounts, control what each person can do, and which colleges they can open."
        actions={canCreate && <Button onClick={() => setCreating(true)}>＋ Create user</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search username, name, email, role…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" aria-label="Search users" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-40" aria-label="Status filter">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
        </Select>
        <Select value={collegeFilter} onChange={(e) => setCollegeFilter(e.target.value)} className="w-64" aria-label="College filter">
          <option value="">All colleges</option>
          {colleges.data?.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {users.isLoading ? (
        <Spinner className="mx-auto my-10 size-8 text-maroon-700" />
      ) : users.error ? (
        <ErrorBox>
          {errorMessage(users.error)}{' '}
          <button type="button" className="underline" onClick={() => users.refetch()}>
            Retry
          </button>
        </ErrorBox>
      ) : !list.length ? (
        <EmptyState title="No users found" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>College</th>
              <th>Access</th>
              <th>Permissions</th>
              <th>Last login</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const block = manageBlockReason(actor, u);
              const self = u.username === actor.username;
              const manageable = block === null;
              const reset = canResetPassword(actor, u);
              return (
                <tr key={u.username}>
                  <td>
                    <div className="font-semibold">{u.displayName}</div>
                    <div className="text-xs text-sand-600">
                      {u.fullName || (u.isSuperAdmin ? 'Main Administrator' : '')}
                      {u.displayName !== u.username && <span className="ml-1 font-mono">({u.username})</span>}
                    </div>
                  </td>
                  <td className="text-xs">{u.email || <span className="text-sand-400">—</span>}</td>
                  <td>
                    <Badge tone={u.isSuperAdmin ? 'maroon' : roleOf(u) === 'user' ? 'neutral' : 'gold'}>
                      {u.isSuperAdmin ? 'Main admin' : ROLE_LABEL[roleOf(u)]}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
                    {u.mustChangePassword && (
                      <Badge tone="gold" className="ml-1">
                        must change pw
                      </Badge>
                    )}
                  </td>
                  <td className="text-xs">{collegeName(u.college)}</td>
                  <td className="text-xs">{u.isSuperAdmin || u.collegeAccess.includes('*') ? 'All' : u.collegeAccess.map((c) => c.toUpperCase()).join(', ')}</td>
                  <td className="max-w-xs whitespace-normal text-xs text-sand-600" title={u.permissions.map(permissionLabel).join(', ')}>
                    {u.isSuperAdmin ? 'All' : `${u.permissions.length} permissions`}
                  </td>
                  <td className="text-xs">{u.lastLogin ? dateTime(u.lastLogin) : '—'}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      {canEdit && (u.isSuperAdmin ? actor.isSuperAdmin : manageable) && (
                        <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>
                          {u.isSuperAdmin ? 'Edit name' : 'Edit'}
                        </Button>
                      )}
                      {reset && (
                        <Button size="sm" variant="secondary" onClick={() => setResetting(u)}>
                          {u.isSuperAdmin ? 'Admin key' : 'Reset pw'}
                        </Button>
                      )}
                      {canBlock && manageable && !u.isSuperAdmin && !self && (
                        <>
                          <Button size="sm" variant={u.status === 'active' ? 'danger' : 'primary'} onClick={() => setPending({ kind: u.status === 'active' ? 'block' : 'unblock', user: u })}>
                            {u.status === 'active' ? 'Block' : 'Activate'}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setPending({ kind: 'delete', user: u })}>
                            Delete
                          </Button>
                        </>
                      )}
                      {!manageable && !u.isSuperAdmin && (
                        <span className="cursor-help text-xs text-sand-400" title={block ?? ''}>
                          🔒
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <UserFormModal open={creating} onClose={() => setCreating(false)} colleges={colleges.data ?? []} />
      <UserFormModal open={!!editing} onClose={() => setEditing(null)} colleges={colleges.data ?? []} user={editing ?? undefined} />
      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSignedOut={() => {
            toast('Your own password changed - please sign in again.', 'info');
            void logout();
          }}
        />
      )}
      <ConfirmDialog
        open={!!pending}
        danger={pending?.kind !== 'unblock'}
        title={pending?.kind === 'delete' ? 'Delete user?' : pending?.kind === 'block' ? 'Block user?' : 'Activate user?'}
        confirmLabel={pending?.kind === 'delete' ? 'Delete' : pending?.kind === 'block' ? 'Block' : 'Activate'}
        loading={del.isPending || setStatus.isPending}
        message={
          pending?.kind === 'delete' ? (
            <>
              <b>{pending.user.displayName}</b> will be removed permanently. Their vouchers stay in the books.
            </>
          ) : pending?.kind === 'block' ? (
            <>
              <b>{pending?.user.displayName}</b> will be signed out on every device and cannot sign in until activated.
            </>
          ) : (
            <>
              <b>{pending?.user.displayName}</b> will be able to sign in again.
            </>
          )
        }
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function ResetPasswordModal({ user, onClose, onSignedOut }: { user: ManagedUser; onClose: () => void; onSignedOut: () => void }) {
  const reset = useResetPassword();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validatePassword(password);
    if (v) return setError(v);
    try {
      const r = (await reset.mutateAsync({ username: user.username, password })) as { signedOut?: boolean } | undefined;
      toast(
        user.isSuperAdmin
          ? 'Admin key changed. All sessions for that account were signed out.'
          : `Password reset for ${user.displayName}. They must change it at next sign-in.`,
      );
      onClose();
      if (r?.signedOut) onSignedOut();
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={user.isSuperAdmin ? `Change admin key — ${user.username}` : `Reset password — ${user.displayName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reset-form" loading={reset.isPending}>
            {user.isSuperAdmin ? 'Change admin key' : 'Reset password'}
          </Button>
        </>
      }
    >
      <form id="reset-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="New password" hint="Share it with the user privately. Copy it before saving.">
          <PasswordInput value={password} onChange={setPassword} />
        </Field>
        <p className="text-xs text-sand-600">The user is signed out on every device immediately.</p>
        <ErrorBox>{error}</ErrorBox>
      </form>
    </Modal>
  );
}
