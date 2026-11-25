import { db } from '../db/knex.js';
import {
  displayUsername,
  isSuperAdmin,
  parseCollegeAccess,
  parsePerms,
  PERMISSIONS,
  voucherScopedPermissions,
} from './permissions.js';
import { normalizeCollegeCode } from './text.js';

export interface UserRow {
  username: string;
  email: string | null;
  password_hash: string;
  password_algo: string;
  password_salt: string | null;
  role: 'admin' | 'user';
  custom_role: string | null;
  /** 'pending': created when the person first opened Accounts from UOS; waiting for an admin to approve. */
  status: 'active' | 'blocked' | 'pending';
  college: string;
  college_access: string[];
  permissions: string[] | null;
  full_name: string;
  must_change_password: boolean;
  token_version: number;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
  /** The person's id on the UOS auth server, once they have opened Accounts from UOS. */
  uos_user_id?: string | null;
  uos_org_id?: string | null;
  uos_linked_at?: Date | null;
  /** UOS sessions only (not a column): the colleges of the campus the module pass is for. */
  session_colleges?: string[];
}

export async function findUser(username: string): Promise<UserRow | undefined> {
  return db<UserRow>('users').where({ username }).first();
}

export async function allCollegeCodes(): Promise<string[]> {
  const rows = await db('colleges').select('code').orderBy('code');
  return rows.map((r) => r.code as string);
}

/** Shape returned to the browser for the signed-in user. */
export async function publicUser(u: UserRow) {
  const main = isSuperAdmin(u);
  const fullName = u.username === 'baji' ? u.full_name || 'Baji' : main ? 'Main Administrator' : u.full_name || '';
  return {
    username: u.username,
    displayName: displayUsername(u.username),
    fullName,
    email: u.email ?? '',
    role: u.custom_role || u.role,
    baseRole: u.role,
    isSuperAdmin: main,
    status: u.status,
    college: normalizeCollegeCode(u.college),
    collegeAccess: u.session_colleges ?? (main ? await allCollegeCodes() : parseCollegeAccess(u)),
    permissions: main ? [...PERMISSIONS] : voucherScopedPermissions(u.role, parsePerms(u)),
    mustChangePassword: u.session_colleges ? false : u.must_change_password,
    uosLinked: Boolean(u.uos_user_id),
  };
}
export type PublicUser = Awaited<ReturnType<typeof publicUser>>;

/** Row shape for the user-management list (no password data). */
export function userListRow(u: UserRow) {
  return {
    username: u.username,
    displayName: displayUsername(u.username),
    fullName: u.full_name,
    email: u.email ?? '',
    role: u.custom_role || u.role,
    baseRole: u.role,
    isSuperAdmin: isSuperAdmin(u),
    status: u.status,
    college: normalizeCollegeCode(u.college),
    collegeAccess: parseCollegeAccess(u),
    permissions: voucherScopedPermissions(u.role, parsePerms(u)),
    mustChangePassword: u.must_change_password,
    uosLinked: Boolean(u.uos_user_id),
    lastLogin: u.last_login,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}
