/**
 * Pure permission helpers for the admin screens. They mirror the server rules in
 * server/src/lib/permissions.ts (assertAssignableAccess / canManageTarget /
 * assertNotMorePrivileged) so the UI only OFFERS what the actor may grant.
 * The server remains the authority and re-checks everything.
 */
import type { CollegeCode, CurrentUser, ManagedUser, Permission } from '@/api/types';

export type RoleChoice = 'user' | 'admin' | 'head';

export interface PermissionGroup {
  title: string;
  perms: { key: Permission; label: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Overview',
    perms: [
      { key: 'view_dashboard', label: 'View Dashboard' },
      { key: 'view_analytics', label: 'View Analytics' },
    ],
  },
  {
    title: 'Vouchers',
    perms: [
      { key: 'create_voucher', label: 'Create Voucher' },
      { key: 'view_own_vouchers', label: 'View Own Vouchers' },
      { key: 'view_all_vouchers', label: 'View All Vouchers' },
      { key: 'edit_voucher', label: 'Edit Voucher' },
      { key: 'delete_voucher', label: 'Delete Voucher' },
      { key: 'print_voucher', label: 'Print Voucher' },
      { key: 'account_heads', label: 'Account Heads & Blocks' },
    ],
  },
  {
    title: 'Reports & Devices',
    perms: [
      { key: 'export_excel', label: 'Export Excel' },
      { key: 'cash_book', label: 'Cash Book' },
      { key: 'link_excel', label: 'Link Excel' },
      { key: 'printer_setup', label: 'Printer Setup' },
    ],
  },
  {
    title: 'Vendors',
    perms: [
      { key: 'view_vendor_ledger', label: 'View Vendor Ledger' },
      { key: 'manage_vendors', label: 'Manage Vendors & Agreements' },
    ],
  },
  {
    title: 'Administration',
    perms: [
      { key: 'create_users', label: 'Create Users' },
      { key: 'create_admin', label: 'Create Admin' },
      { key: 'manage_permissions', label: 'Manage Permissions' },
      { key: 'reset_passwords', label: 'Reset Passwords' },
      { key: 'block_users', label: 'Block / Delete Users' },
      { key: 'manage_colleges', label: 'Manage Colleges' },
      { key: 'change_admin_key', label: 'Change Admin Key' },
      { key: 'view_audit', label: 'View Audit Log' },
    ],
  },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.key));

const LABELS = new Map(PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => [p.key, p.label] as const)));
export const permissionLabel = (p: string) => LABELS.get(p as Permission) ?? p;

/** Legacy presets (admin1-users.js USER_DEFAULTS / ADMIN_DEFAULTS; Head = everything). */
export const USER_PRESET: Permission[] = ['create_voucher', 'view_own_vouchers', 'print_voucher', 'view_vendor_ledger'];
export const ADMIN_PRESET: Permission[] = [
  'view_dashboard',
  'view_analytics',
  'create_voucher',
  'view_own_vouchers',
  'view_all_vouchers',
  'edit_voucher',
  'print_voucher',
  'export_excel',
  'cash_book',
  'link_excel',
  'printer_setup',
  'account_heads',
  'view_vendor_ledger',
  'manage_vendors',
  'create_users',
  'reset_passwords',
  'block_users',
];

/** View-scope permissions are set by role on the server and never count as escalation. */
const SCOPE_PERMS: Permission[] = ['view_own_vouchers', 'view_all_vouchers'];

export type Actor = Pick<CurrentUser, 'username' | 'role' | 'baseRole' | 'isSuperAdmin' | 'collegeAccess' | 'permissions'>;
export type Target = Pick<ManagedUser, 'username' | 'role' | 'baseRole' | 'isSuperAdmin' | 'college' | 'permissions'>;

const isHead = (u: { role: string }) => u.role === 'head';
const has = (a: Actor, p: Permission) => a.isSuperAdmin || a.permissions.includes(p);

/** Permissions the actor may tick for someone else. */
export function assignablePermissions(actor: Actor): Set<Permission> {
  if (actor.isSuperAdmin) return new Set(ALL_PERMISSIONS);
  return new Set(ALL_PERMISSIONS.filter((p) => SCOPE_PERMS.includes(p) || actor.permissions.includes(p)));
}

/** Roles the actor may give. */
export function assignableRoles(actor: Actor): RoleChoice[] {
  const roles: RoleChoice[] = ['user'];
  if (has(actor, 'create_admin')) roles.push('admin');
  if (actor.isSuperAdmin || isHead(actor)) roles.push('head');
  return roles;
}

/** Colleges the actor may assign (as home college or extra access). */
export function assignableColleges(actor: Actor, all: CollegeCode[]): CollegeCode[] {
  if (actor.isSuperAdmin || actor.collegeAccess.includes('*')) return all;
  return all.filter((c) => actor.collegeAccess.includes(c));
}

/** Server applies the same normalisation (voucherScopedPermissions). */
export function scopePermissions(role: RoleChoice, perms: Permission[]): Permission[] {
  const base = role === 'user' ? 'user' : 'admin';
  let out: Permission[] = perms.filter((p) => p !== 'view_all_vouchers' && p !== 'view_own_vouchers');
  out = base === 'admin' ? [...out, 'view_own_vouchers', 'view_all_vouchers'] : [...out, 'view_own_vouchers'];
  return ALL_PERMISSIONS.filter((p) => out.includes(p));
}

/** Preset for a role, limited to what the actor may grant. */
export function presetFor(role: RoleChoice, actor: Actor): Permission[] {
  const allowed = assignablePermissions(actor);
  const base = role === 'head' ? ALL_PERMISSIONS : role === 'admin' ? ADMIN_PRESET : USER_PRESET;
  return scopePermissions(role, base.filter((p) => allowed.has(p)));
}

/** Why the actor cannot manage this user, or null if they can (mirrors canManageTarget + assertNotMorePrivileged). */
export function manageBlockReason(actor: Actor, target: Target & { college: CollegeCode }): string | null {
  if (actor.isSuperAdmin) return null;
  if (target.isSuperAdmin) return 'Main administrators can only be managed by a main administrator.';
  if (isHead(target) && !isHead(actor)) return 'Only a main administrator or Head can manage a Head user.';
  if (!actor.collegeAccess.includes('*') && !actor.collegeAccess.includes(target.college)) return 'User is outside your college access.';
  if (target.baseRole === 'admin' && !has(actor, 'create_admin')) return 'You need Create Admin to manage admins.';
  const extra = target.permissions.filter((p) => !SCOPE_PERMS.includes(p) && !actor.permissions.includes(p));
  if (extra.length) return `User has permissions you do not have: ${extra.map(permissionLabel).join(', ')}`;
  return null;
}

/** Whether the actor may reset this user's password (mirrors assertResetTarget + route gate). */
export function canResetPassword(actor: Actor, target: Target & { college: CollegeCode }): boolean {
  if (target.isSuperAdmin) return has(actor, 'change_admin_key');
  if (!has(actor, 'reset_passwords')) return false;
  return manageBlockReason(actor, target) === null;
}

/** Validation for the create/edit form, same rules as the server. */
export function validateUsername(u: string): string | null {
  const v = u.trim().toLowerCase();
  if (!v) return 'Username is required';
  if (!/^[a-z0-9._@-]{1,64}$/.test(v)) return 'Use 1-64 letters, numbers or . _ - @';
  if (['admin', 'admin1', 'admin_stmw', 'admin_smhyd', 'baji', 'superadmin'].includes(v)) return 'This username is reserved';
  return null;
}

export function validatePassword(p: string): string | null {
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (p.length > 72) return 'Password is too long (maximum 72 characters)';
  if (/^stmarys@1234$/i.test(p)) return 'This default password is not allowed';
  return null;
}

/** Strong temporary password without look-alike characters (0/O, 1/l/I). */
export function generateTempPassword(length = 12, rand: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '#$%&*+-=?@';
  const all = lower + upper + digits + symbols;
  const r = rand(length);
  const chars = Array.from(r, (n, i) => {
    const set = i === 0 ? upper : i === 1 ? lower : i === 2 ? digits : i === 3 ? symbols : all;
    return set[n % set.length];
  });
  // Shuffle so the required classes are not always first.
  const s = rand(length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = s[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function roleOf(u: { role: string }): RoleChoice {
  return u.role === 'head' ? 'head' : u.role === 'admin' ? 'admin' : 'user';
}

export const ROLE_LABEL: Record<RoleChoice, string> = { user: 'User', admin: 'Admin', head: 'Head' };
