import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { forbidden, HttpError } from '../lib/errors.js';
import { hashPassword } from '../lib/passwords.js';
import { isSuperAdmin, parseCollegeAccess, RESERVED_USERNAMES, voucherScopedPermissions } from '../lib/permissions.js';
import { clean, normalizeCollegeCode } from '../lib/text.js';
import type { UserRow } from '../lib/users.js';
import { type CampusRule, findCampus } from './campusMap.js';
import type { UosClaims } from './pass.js';

/** A signed-in UOS session: who, which campus, and the colleges it may open. */
export interface UosContext {
  claims: UosClaims;
  campus: CampusRule;
  /** Colleges of the pass's campus that this user may open. */
  colleges: string[];
  /** The Accounts user, scoped to `colleges` (session_colleges set). */
  user: UserRow;
  /** The user's own college access outside this session (['*'] for main administrators). */
  localAccess: string[];
}

export function campusFor(claims: UosClaims): CampusRule {
  if (config.uos.orgId && claims.orgId && claims.orgId !== config.uos.orgId) {
    throw forbidden('This Accounts site serves a different university.');
  }
  const campus = findCampus(config.uos.campuses, claims.campusId, claims.campusCode);
  if (!campus) {
    const label = claims.campusName || claims.campusCode || claims.campusId;
    throw forbidden(`Accounts is not set up for the campus "${label}" yet. Ask the UOS team to add it.`);
  }
  return campus;
}

/** The campus's colleges this user may open (all of them for main administrators). */
export function sessionColleges(user: UserRow, campus: CampusRule): string[] {
  const local = parseCollegeAccess(user);
  return local.includes('*') ? [...campus.colleges] : campus.colleges.filter((c) => local.includes(c));
}

/** The user as permission checks should see them in this session: limited to the session's colleges. */
export function scopeUser(user: UserRow, colleges: string[]): UserRow {
  const home = normalizeCollegeCode(user.college);
  return {
    ...user,
    college: colleges.includes(home) ? home : colleges[0],
    college_access: isSuperAdmin(user) ? user.college_access : colleges,
    session_colleges: colleges,
  };
}

function assertUsable(user: UserRow, campus: CampusRule): string[] {
  if (user.status === 'pending') {
    throw new HttpError(403, 'Your Accounts access is waiting for approval. An Accounts administrator needs to approve you in Users & Permissions.', {
      pending: true,
    });
  }
  if (user.status !== 'active') throw forbidden('User is blocked. Contact admin1.');
  const colleges = sessionColleges(user, campus);
  if (!colleges.length) {
    throw forbidden(`Your Accounts user has no access to the colleges of ${campus.name || campus.code || 'this campus'}. Ask admin1.`);
  }
  return colleges;
}

/** Every request in a UOS session: the person must already be linked (that happens at handoff). */
export async function resolveForRequest(claims: UosClaims): Promise<UosContext> {
  const campus = campusFor(claims);
  const user = await db<UserRow>('users').where({ uos_user_id: claims.userId }).first();
  if (!user) throw new HttpError(401, 'Open Accounts from UOS again.', { reauth: 'uos' });
  const colleges = assertUsable(user, campus);
  return { claims, campus, colleges, user: scopeUser(user, colleges), localAccess: parseCollegeAccess(user) };
}

/** A free username for a new user, based on their email (or name). */
async function freeUsername(trx: Knex.Transaction, claims: UosClaims): Promise<string> {
  const source = claims.email.split('@')[0] || claims.name || 'uos.user';
  let base = source.toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/^[._-]+|[._-]+$/g, '').slice(0, 40) || 'uos.user';
  if (RESERVED_USERNAMES.includes(base) || isSuperAdmin(base) || /^(admin|user)\d*$/.test(base)) base = `uos.${base}`;
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    if (!(await trx('users').where({ username: candidate }).first())) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

async function createUser(trx: Knex.Transaction, claims: UosClaims, campus: CampusRule): Promise<UserRow> {
  const username = await freeUsername(trx, claims);
  // No usable password: this user signs in through UOS (an admin can still set one).
  const hp = await hashPassword(randomBytes(32).toString('base64url'));
  const row = {
    username,
    ...hp,
    email: claims.email || null,
    role: 'user',
    custom_role: null,
    status: config.uos.newUsers === 'active' ? 'active' : 'pending',
    college: campus.colleges[0],
    college_access: campus.colleges,
    permissions: voucherScopedPermissions('user', config.uos.defaultPermissions),
    full_name: clean(claims.name, 200),
    must_change_password: false,
    uos_user_id: claims.userId,
    uos_org_id: claims.orgId || null,
    uos_linked_at: new Date(),
  };
  const [created] = await trx<UserRow>('users').insert(row as Partial<UserRow>).returning('*');
  return created;
}

/**
 * Entry from the UOS shell: finds the Accounts user for this person, linking by
 * email the first time, or creating one (pending approval by default).
 */
export async function resolveForHandoff(claims: UosClaims, ip: string): Promise<UosContext & { how: 'linked' | 'matched' | 'created' }> {
  const campus = campusFor(claims);
  let result: { user: UserRow; how: 'linked' | 'matched' | 'created' };
  try {
    result = await linkOrCreate(claims, campus, ip);
  } catch (err) {
    // Two tabs entering at the same moment may race to create/link the same person: retry once.
    if ((err as { code?: string }).code !== '23505') throw err;
    result = await linkOrCreate(claims, campus, ip);
  }
  const colleges = assertUsable(result.user, campus);
  return {
    claims,
    campus,
    colleges,
    user: scopeUser(result.user, colleges),
    localAccess: parseCollegeAccess(result.user),
    how: result.how,
  };
}

function linkOrCreate(claims: UosClaims, campus: CampusRule, ip: string) {
  return db.transaction(async (trx) => {
    let how: 'linked' | 'matched' | 'created' = 'linked';
    let user = await trx<UserRow>('users').where({ uos_user_id: claims.userId }).forUpdate().first();
    if (!user && claims.email) {
      const byEmail = await trx<UserRow>('users').whereRaw('lower(email) = ?', [claims.email]).forUpdate().first();
      if (byEmail) {
        if (byEmail.uos_user_id && byEmail.uos_user_id !== claims.userId) {
          throw forbidden('Your email is already linked to a different UOS account. Ask your Accounts administrator.');
        }
        user = byEmail;
        how = 'matched';
      }
    }
    if (!user) {
      if (config.uos.newUsers === 'off') {
        throw forbidden(
          `No Accounts user is linked to ${claims.email || 'your UOS account'}. Ask your Accounts administrator to add your email in Users & Permissions.`,
        );
      }
      user = await createUser(trx, claims, campus);
      how = 'created';
      await audit(user.username, 'uos_user_created', 'user', user.username, { uosUserId: claims.userId, status: user.status }, ip, trx);
      return { user, how };
    }
    const patch: Partial<UserRow> = { uos_org_id: claims.orgId || null };
    if (how === 'matched') {
      patch.uos_user_id = claims.userId;
      patch.uos_linked_at = new Date();
    }
    if (!user.full_name && claims.name) patch.full_name = clean(claims.name, 200);
    if (!user.email && claims.email) {
      const taken = await trx('users').whereRaw('lower(email) = ?', [claims.email]).first();
      if (!taken) patch.email = claims.email;
    }
    if (user.status === 'active') patch.last_login = new Date();
    await trx('users').where({ username: user.username }).update(patch);
    if (how === 'matched') {
      await audit(user.username, 'uos_linked', 'user', user.username, { uosUserId: claims.userId, by: 'email' }, ip, trx);
    }
    return { user: { ...user, ...patch } as UserRow, how };
  });
}

/** What the web app needs to know about the UOS session (sent with the user). */
export function sessionInfo(ctx: UosContext) {
  const { claims, campus } = ctx;
  const access = ctx.localAccess;
  // Colleges in other campuses this user may open (switching re-enters through UOS for that campus).
  const otherColleges = config.uos.campuses
    .filter((c) => c.campusId !== campus.campusId)
    .flatMap((c) => c.colleges.map((code) => ({ code, campusId: c.campusId })))
    .filter((c) => access.includes('*') || access.includes(c.code));
  return {
    moduleId: config.uos.moduleId,
    shellUrl: config.uos.shellUrl,
    logoutUrl: config.uos.shellUrl + (config.uos.shellLogoutPath || '/'),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    orgId: claims.orgId,
    campusId: campus.campusId,
    campusCode: campus.code || claims.campusCode,
    campusName: campus.name || claims.campusName,
    colleges: ctx.colleges,
    otherColleges,
  };
}
export type UosSessionInfo = ReturnType<typeof sessionInfo>;
