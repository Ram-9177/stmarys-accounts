import { useMemo, useState, type FormEvent } from 'react';
import { errorMessage } from '@/api/client';
import { useCreateUser, useUpdateUser } from '@/api/hooks';
import type { College, ManagedUser, Permission } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { PasswordInput } from './PasswordInput';
import {
  assignableColleges,
  assignablePermissions,
  assignableRoles,
  PERMISSION_GROUPS,
  presetFor,
  ROLE_LABEL,
  roleOf,
  scopePermissions,
  validatePassword,
  validateUsername,
  type RoleChoice,
} from './permissions';

interface Props {
  open: boolean;
  onClose: () => void;
  colleges: College[];
  /** Edit this user; omit to create a new one. */
  user?: ManagedUser;
}

export function UserFormModal(props: Props) {
  // Remount per open/user so state resets cleanly.
  if (!props.open) return null;
  return <UserForm key={props.user?.username ?? 'new'} {...props} />;
}

function UserForm({ open, onClose, colleges, user }: Props) {
  const { user: actor, college: currentCollege } = useSession();
  const toast = useToast();
  const create = useCreateUser();
  const update = useUpdateUser();
  const editing = !!user;
  const mainAdmin = !!user?.isSuperAdmin;

  const roles = assignableRoles(actor);
  const allowedPerms = assignablePermissions(actor);
  const collegeCodes = assignableColleges(
    actor,
    colleges.map((c) => c.code),
  );
  const startRole: RoleChoice = user ? roleOf(user) : 'user';
  const startCollege = user?.college ?? (collegeCodes.includes(currentCollege) ? currentCollege : collegeCodes[0] ?? 'smgg');

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<RoleChoice>(startRole);
  const [college, setCollege] = useState(startCollege);
  const [access, setAccess] = useState<string[]>(user?.collegeAccess.filter((c) => c !== '*') ?? [startCollege]);
  const [perms, setPerms] = useState<Permission[]>(user ? user.permissions : presetFor('user', actor));
  const [error, setError] = useState('');

  const effective = useMemo(() => scopePermissions(role, perms), [role, perms]);
  const busy = create.isPending || update.isPending;

  function togglePerm(p: Permission, on: boolean) {
    setPerms((cur) => (on ? [...cur, p] : cur.filter((x) => x !== p)));
  }
  function toggleAccess(c: string, on: boolean) {
    setAccess((cur) => (on ? Array.from(new Set([...cur, c])) : cur.filter((x) => x !== c)));
  }
  function changeRole(r: RoleChoice) {
    setRole(r);
    if (!editing) setPerms(presetFor(r, actor));
  }
  function changeCollege(c: string) {
    setCollege(c);
    setAccess((cur) => Array.from(new Set([c, ...cur])));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const em = email.trim().toLowerCase();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setError('Invalid email address');
    if (!editing) {
      const uErr = validateUsername(username) ?? validatePassword(password);
      if (uErr) return setError(uErr);
    }
    // Never send a permission the actor cannot grant (the server would reject it anyway).
    const sendPerms = effective.filter((p) => allowedPerms.has(p) || p === 'view_own_vouchers' || p === 'view_all_vouchers');
    const body = {
      role,
      fullName: fullName.trim(),
      email: em,
      college,
      collegeAccess: Array.from(new Set([college, ...access])),
      permissions: sendPerms,
    };
    try {
      if (editing) {
        await update.mutateAsync({ username: user!.username, ...body });
        toast(`Saved ${user!.displayName}`);
      } else {
        await create.mutateAsync({ username: username.trim().toLowerCase(), password, ...body });
        toast(`User ${username.trim().toLowerCase()} created. They must change the password at first sign-in.`);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    }
  }

  const title = editing ? `Edit ${user!.displayName}` : 'Create Admin / User';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={busy}>
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username" required={!editing} hint={editing ? undefined : 'Letters, numbers or . _ - @'}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={editing} autoComplete="off" />
          </Field>
          {!editing && (
            <Field label="Initial password" required hint="The user must change it at first sign-in.">
              <PasswordInput value={password} onChange={setPassword} />
            </Field>
          )}
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email" hint="Used for Microsoft sign-in and account notifications.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        </div>

        {mainAdmin ? (
          <p className="rounded-lg bg-sand-50 p-3 text-sm text-sand-600">
            Main administrators always have every permission and every college. Only the name and email can be changed.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role">
                <Select value={role} onChange={(e) => changeRole(e.target.value as RoleChoice)}>
                  {Array.from(new Set([...roles, startRole])).map((r) => (
                    <option key={r} value={r} disabled={!roles.includes(r)}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Home college">
                <Select value={college} onChange={(e) => changeCollege(e.target.value)}>
                  {colleges
                    .filter((c) => collegeCodes.includes(c.code) || c.code === college)
                    .map((c) => (
                      <option key={c.code} value={c.code} disabled={!collegeCodes.includes(c.code)}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>

            <Field label="College access" hint="The home college is always included.">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {colleges.map((c) => (
                  <Checkbox
                    key={c.code}
                    label={c.name}
                    checked={c.code === college || access.includes(c.code)}
                    disabled={c.code === college || !collegeCodes.includes(c.code)}
                    onChange={(e) => toggleAccess(c.code, e.target.checked)}
                  />
                ))}
              </div>
            </Field>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-sand-600">Permissions</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPerms(presetFor('user', actor))}>
                    Regular user preset
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPerms(presetFor('admin', actor))}>
                    Admin preset
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {PERMISSION_GROUPS.map((g) => (
                  <fieldset key={g.title} className="rounded-lg border border-sand-100 p-3">
                    <legend className="px-1 text-xs font-semibold text-maroon-700">{g.title}</legend>
                    <div className="flex flex-col gap-1.5">
                      {g.perms.map((p) => {
                        const scope = p.key === 'view_own_vouchers' || p.key === 'view_all_vouchers';
                        return (
                          <Checkbox
                            key={p.key}
                            label={
                              <span className={allowedPerms.has(p.key) ? '' : 'text-sand-400'}>
                                {p.label}
                                {scope && <span className="text-xs text-sand-400"> (set by role)</span>}
                              </span>
                            }
                            checked={effective.includes(p.key)}
                            disabled={scope || !allowedPerms.has(p.key)}
                            onChange={(e) => togglePerm(p.key, e.target.checked)}
                          />
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
              {!actor.isSuperAdmin && <p className="mt-2 text-xs text-sand-600">You can only grant permissions you hold yourself.</p>}
            </div>
          </>
        )}
        <ErrorBox>{error}</ErrorBox>
      </form>
    </Modal>
  );
}
