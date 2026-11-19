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
  status: 'active' | 'blocked';
  college: string;
  college_access: string[];
  permissions: string[] | null;
  full_name: string;
  must_change_password: boolean;
  token_version: number;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
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
    collegeAccess: main ? await allCollegeCodes() : parseCollegeAccess(u),
    permissions: main ? [...PERMISSIONS] : voucherScopedPermissions(u.role, parsePerms(u)),
    mustChangePassword: u.must_change_password,
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
    lastLogin: u.last_login,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}
