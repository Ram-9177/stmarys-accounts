import { forbidden, HttpError } from './errors.js';
import { clean, csvList, normalizeCollegeCode } from './text.js';

export const PERMISSIONS = [
  'view_dashboard',
  'view_analytics',
  'create_voucher',
  'view_own_vouchers',
  'view_all_vouchers',
  'edit_voucher',
  'delete_voucher',
  'print_voucher',
  'export_excel',
  'cash_book',
  'link_excel',
  'printer_setup',
  'account_heads',
  'view_vendor_ledger',
  'manage_vendors',
  'manage_advances',
  'approve_advances',
  'create_users',
  'reset_passwords',
  'block_users',
  'create_admin',
  'manage_permissions',
  'manage_colleges',
  'change_admin_key',
  'view_audit',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const DEFAULT_ADMIN_PERMS =
  'view_dashboard,view_analytics,create_voucher,view_own_vouchers,view_all_vouchers,edit_voucher,print_voucher,export_excel,cash_book,link_excel,printer_setup,account_heads,view_vendor_ledger,manage_vendors,manage_advances,create_users,reset_passwords,block_users';
const DEFAULT_USER_PERMS = 'create_voucher,view_own_vouchers,print_voucher,view_vendor_ledger,manage_advances';
/** Defaults applied when an admin creates a user without choosing permissions (legacy createUser). */
export const NEW_ADMIN_PERMS =
  'view_dashboard,view_analytics,create_voucher,view_own_vouchers,view_all_vouchers,edit_voucher,print_voucher,export_excel,cash_book,link_excel,printer_setup,account_heads,manage_advances,create_users,reset_passwords,block_users';
export const NEW_USER_PERMS = 'create_voucher,view_own_vouchers,print_voucher';

/** Main administrators: one per campus plus 'baji'. They hold every permission and every college. */
export const SUPER_ADMINS = ['admin', 'admin_stmw', 'admin_smhyd', 'baji'] as const;
export const RESERVED_USERNAMES = ['admin', 'admin1', 'admin_stmw', 'admin_smhyd', 'baji', 'superadmin'];
export const ALL_COLLEGES_MARK = '*';

/** Super-admin account that 'superadmin' logs in as, per campus. */
export function campusSuperAdmin(college: string): string {
  if (college === 'smwec') return 'admin_stmw';
  if (college === 'smhyd') return 'admin_smhyd';
  return 'admin';
}

export interface PermUser {
  username: string;
  role: 'admin' | 'user' | string;
  custom_role?: string | null;
  college?: string | null;
  college_access?: string[] | null;
  permissions?: string[] | null;
  /**
   * Set for UOS sessions: the colleges of the campus the module pass was issued for.
   * Nobody, main administrators included, can open another college's books with it.
   */
  session_colleges?: string[];
}

export function isSuperAdmin(user: PermUser | string | null | undefined): boolean {
  const name = String(typeof user === 'string' ? user : (user?.username ?? '')).toLowerCase();
  return (SUPER_ADMINS as readonly string[]).includes(name);
}

/** Display label used across the UI (legacy naming: main admins show as 'admin1'). */
export function displayUsername(name: string): string {
  const u = String(name || '').toLowerCase();
  if (u === 'admin' || u === 'admin_stmw' || u === 'admin_smhyd') return 'admin1';
  if (u === 'user2') return 'admin2';
  if (u === 'user3') return 'admin3';
  return u;
}

/** Maps legacy login aliases back to stored usernames. */
export function actualUsername(name: string): string {
  const u = clean(name, 250).toLowerCase();
  if (u === 'admin' || u === 'admin1') return 'admin';
  if (u === 'admin2') return 'user2';
  if (u === 'admin3') return 'user3';
  return u;
}

export function parsePerms(user: PermUser): string[] {
  if (isSuperAdmin(user)) return ['*'];
  const stored = (user.permissions ?? []).filter(Boolean);
  if (stored.length) return stored;
  return csvList(user.role === 'admin' ? DEFAULT_ADMIN_PERMS : DEFAULT_USER_PERMS);
}

export function parseCollegeAccess(user: PermUser): string[] {
  if (isSuperAdmin(user)) return [ALL_COLLEGES_MARK];
  const stored = (user.college_access ?? []).map(normalizeCollegeCode).filter(Boolean);
  if (stored.length) return stored;
  return [normalizeCollegeCode(user.college || 'smgg')];
}

export function hasPerm(user: PermUser, perm: Permission): boolean {
  if (isSuperAdmin(user)) return true;
  const perms = parsePerms(user);
  return perms.includes('*') || perms.includes(perm);
}

export function need(user: PermUser, perm: Permission): void {
  if (!hasPerm(user, perm)) throw forbidden(`Access denied. Missing ${perm} permission.`);
}

export function needAny(user: PermUser, perms: Permission[]): void {
  if (!perms.some((p) => hasPerm(user, p))) throw forbidden('Access denied. Missing permissions.');
}

/** Admin-level voucher visibility: super admin, role admin or the 'head' custom role. */
export function isVoucherAdmin(user: PermUser): boolean {
  return isSuperAdmin(user) || user.role === 'admin' || user.custom_role === 'head';
}

/**
 * Who sees every voucher in a college. Everyone else sees their own vouchers plus on-account ones.
 * (v1 also let view_vendor_ledger holders see everything; the vendor ledger now reads
 * vendor-linked payments from /api/vendors/payments instead.)
 */
export function canViewAllVouchers(user: PermUser): boolean {
  return isVoucherAdmin(user) || hasPerm(user, 'view_all_vouchers');
}

export function canViewVendors(user: PermUser): boolean {
  return isVoucherAdmin(user) || hasPerm(user, 'view_vendor_ledger') || hasPerm(user, 'manage_vendors');
}

export const USER_ADMIN_PERMS: Permission[] = [
  'create_users',
  'create_admin',
  'manage_permissions',
  'reset_passwords',
  'block_users',
  'manage_colleges',
  'change_admin_key',
  'view_audit',
];

/** Returns the college the user may act on, or throws 403. */
export function allowedCollege(user: PermUser, requested?: unknown): string {
  const req = normalizeCollegeCode(requested || user.college || 'smgg');
  if (user.session_colleges && !user.session_colleges.includes(req)) {
    throw forbidden('Access denied. This college is not part of the campus you opened Accounts for.');
  }
  if (isSuperAdmin(user)) return req;
  const allowed = parseCollegeAccess(user);
  if (!allowed.includes(ALL_COLLEGES_MARK) && !allowed.includes(req)) {
    throw forbidden('Access denied. College is outside your access.');
  }
  return req;
}

/** Admins always see all vouchers; regular users only their own (plus on-account). */
export function voucherScopedPermissions(role: string, value: string[] | string): string[] {
  let permissions = csvList(value);
  if (role === 'admin') {
    if (!permissions.includes('view_all_vouchers')) permissions.push('view_all_vouchers');
  } else {
    permissions = permissions.filter((p) => p !== 'view_all_vouchers');
    if (!permissions.includes('view_own_vouchers')) permissions.push('view_own_vouchers');
  }
  return Array.from(new Set(permissions));
}

export function normalizeCollegeAccess(college: string, value: unknown): string[] {
  return Array.from(new Set([normalizeCollegeCode(college || 'smgg'), ...csvList(value).map(normalizeCollegeCode)]));
}

/** A non-super admin may only grant colleges, roles and permissions they hold themselves. */
export function assertAssignableAccess(
  actor: PermUser,
  role: string,
  college: string,
  collegeAccess: string[],
  permissions: string[],
  customRole: string,
): void {
  if (isSuperAdmin(actor)) return;
  const actorPerms = parsePerms(actor);
  const actorColleges = parseCollegeAccess(actor);
  const requested = Array.from(new Set([college, ...collegeAccess].filter(Boolean)));
  if (!actorColleges.includes(ALL_COLLEGES_MARK)) {
    for (const c of requested) {
      if (!actorColleges.includes(c)) throw forbidden('Access denied. Cannot assign college outside your access.');
    }
  }
  if (role === 'admin' && !actorPerms.includes('create_admin')) {
    throw forbidden('Access denied. Missing create_admin permission.');
  }
  if (customRole === 'head' && actor.custom_role !== 'head') {
    throw forbidden('Access denied. Only a main administrator or Head can assign the Head role.');
  }
  for (const p of permissions) {
    if (p === 'view_own_vouchers' || p === 'view_all_vouchers') continue;
    if (!actorPerms.includes(p)) throw forbidden(`Access denied. Cannot assign permission: ${p}`);
  }
}

export function canManageTarget(actor: PermUser, target: PermUser | null | undefined): boolean {
  if (isSuperAdmin(actor)) return true;
  if (!target || isSuperAdmin(target)) return false;
  if (target.custom_role === 'head' && actor.custom_role !== 'head') return false;
  const actorColleges = parseCollegeAccess(actor);
  const targetCollege = normalizeCollegeCode(target.college || 'smgg');
  return actorColleges.includes(ALL_COLLEGES_MARK) || actorColleges.includes(targetCollege);
}

/** A non-super admin must never take over an account holding permissions or roles they lack. */
export function assertNotMorePrivileged(actor: PermUser, target: PermUser): void {
  if (isSuperAdmin(actor)) return;
  if (isSuperAdmin(target)) {
    throw forbidden('Access denied. Main administrators can only be managed by a main administrator.');
  }
  if (target.role === 'admin' && !hasPerm(actor, 'create_admin')) {
    throw forbidden('Access denied. Missing create_admin permission to manage admins.');
  }
  const actorPerms = parsePerms(actor);
  const extra = parsePerms(target).filter(
    (p) => p !== 'view_own_vouchers' && p !== 'view_all_vouchers' && !actorPerms.includes(p),
  );
  if (extra.length) throw forbidden(`Access denied. Target user has permissions you do not have: ${extra.join(', ')}`);
}

export function assertManageTarget(actor: PermUser, target: PermUser | null | undefined): asserts target is PermUser {
  if (!target) throw new HttpError(404, 'User not found');
  if (target.custom_role === 'head' && !isSuperAdmin(actor) && actor.custom_role !== 'head') {
    throw forbidden('Access denied. Only a main administrator or Head can manage a Head user.');
  }
  if (!canManageTarget(actor, target)) throw forbidden('Access denied. User is outside your college access.');
  assertNotMorePrivileged(actor, target);
}

export function assertResetTarget(actor: PermUser, target: PermUser | null | undefined): asserts target is PermUser {
  if (!target) throw new HttpError(404, 'User not found');
  if (isSuperAdmin(actor)) return;
  if (target.custom_role === 'head' && actor.custom_role !== 'head') {
    throw forbidden('Access denied. Only a main administrator or Head can manage a Head user.');
  }
  const actorColleges = parseCollegeAccess(actor);
  const targetCollege = normalizeCollegeCode(target.college || 'smgg');
  if (!actorColleges.includes(ALL_COLLEGES_MARK) && !actorColleges.includes(targetCollege)) {
    throw forbidden('Access denied. User is outside your college access.');
  }
  if (isSuperAdmin(target)) {
    if (!hasPerm(actor, 'change_admin_key')) throw forbidden('Access denied. Missing change_admin_key permission.');
    return;
  }
  assertNotMorePrivileged(actor, target);
}
