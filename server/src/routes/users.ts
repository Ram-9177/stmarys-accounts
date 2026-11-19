import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, badRequest, forbidden, HttpError } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { assertPassword, hashPassword } from '../lib/passwords.js';
import {
  assertAssignableAccess,
  assertManageTarget,
  assertResetTarget,
  canManageTarget,
  hasPerm,
  isSuperAdmin,
  NEW_ADMIN_PERMS,
  NEW_USER_PERMS,
  needAny,
  normalizeCollegeAccess,
  PERMISSIONS,
  RESERVED_USERNAMES,
  USER_ADMIN_PERMS,
  voucherScopedPermissions,
} from '../lib/permissions.js';
import { rateLimit } from '../lib/rateLimit.js';
import { clean, normalizeCollegeCode } from '../lib/text.js';
import { revokeAllRefreshTokens } from '../lib/tokens.js';
import { findUser, userListRow, type UserRow } from '../lib/users.js';
import { clientIp, type AuthedRequest } from '../middleware/auth.js';

export const usersRouter = Router();
const USERNAME_RE = /^[a-z0-9._@-]{1,64}$/;

usersRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    needAny(req.user, USER_ADMIN_PERMS);
    const rows = await db<UserRow>('users').orderBy('username');
    res.json({ users: rows.filter((u) => canManageTarget(req.user, u)).map(userListRow), permissions: PERMISSIONS });
  }),
);

const roleSchema = z.enum(['admin', 'user', 'head']).optional().default('user');
const listSchema = z.union([z.array(z.string()), z.string()]).optional().default([]);
const emailSchema = z
  .string()
  .optional()
  .transform((v) => clean(v, 320).toLowerCase())
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email address');

const CreateBody = z.object({
  username: z.string(),
  password: z.string(),
  role: roleSchema,
  fullName: z.string().optional().default(''),
  email: emailSchema,
  college: z.string().optional(),
  collegeAccess: listSchema,
  permissions: listSchema,
});

async function assertEmailFree(email: string, exceptUsername?: string) {
  if (!email) return;
  const q = db('users').whereRaw('lower(email) = ?', [email]);
  if (exceptUsername) q.whereNot({ username: exceptUsername });
  if (await q.first()) throw new HttpError(409, 'That email is already linked to another user');
}

function splitRole(role: 'admin' | 'user' | 'head') {
  return { role: role === 'user' ? 'user' : 'admin', customRole: role === 'head' ? 'head' : '' } as const;
}

usersRouter.post(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    const actor = req.user;
    const body = CreateBody.parse(req.body);
    const { role, customRole } = splitRole(body.role);
    if (!isSuperAdmin(actor)) {
      if (role === 'admin' && !hasPerm(actor, 'create_admin')) throw forbidden('Access denied. Missing create_admin permission.');
      if (role === 'user' && !hasPerm(actor, 'create_users')) throw forbidden('Access denied. Missing create_users permission.');
    }
    await rateLimit(`createuser:${actor.username}`, 60, 3600);
    const username = clean(body.username, 64).toLowerCase();
    if (!USERNAME_RE.test(username)) throw badRequest('Username must be 1-64 letters/numbers or . _ - @');
    if (isSuperAdmin(username) || RESERVED_USERNAMES.includes(username)) throw badRequest('This username is reserved.');
    const password = assertPassword(body.password);
    if (await findUser(username)) throw new HttpError(409, 'Username already exists');
    await assertEmailFree(body.email);

    const college = normalizeCollegeCode(body.college || actor.college || 'smgg');
    const collegeAccess = normalizeCollegeAccess(college, body.collegeAccess);
    const requested = Array.isArray(body.permissions) ? body.permissions : body.permissions.split(',');
    const permissions = voucherScopedPermissions(
      role,
      requested.filter(Boolean).length ? requested : role === 'admin' ? NEW_ADMIN_PERMS : NEW_USER_PERMS,
    );
    assertAssignableAccess(actor, role, college, collegeAccess, permissions, customRole);

    await db('users').insert({
      username,
      email: body.email || null,
      ...(await hashPassword(password)),
      role,
      custom_role: customRole || null,
      status: 'active',
      college,
      college_access: collegeAccess,
      permissions,
      full_name: clean(body.fullName, 200),
      must_change_password: true,
    });
    await audit(actor.username, 'create_user', 'user', username, { role: body.role, college }, clientIp(req));
    await sendMail(
      body.email,
      "Your St. Mary's voucher system account",
      `Hello ${clean(body.fullName, 200) || username},\n\nAn account "${username}" was created for you by ${actor.username}.` +
        `\nYour administrator will share your first password separately; you must change it after signing in.\n`,
    );
    res.status(201).json({ ok: true });
  }),
);

const UpdateBody = z.object({
  role: roleSchema,
  fullName: z.string().optional().default(''),
  email: emailSchema,
  college: z.string().optional(),
  collegeAccess: listSchema,
  permissions: listSchema,
});

usersRouter.patch(
  '/:username',
  ah<AuthedRequest>(async (req, res) => {
    const actor = req.user;
    const username = clean(req.params.username, 64).toLowerCase();
    if (!isSuperAdmin(actor) && !hasPerm(actor, 'manage_permissions')) {
      throw forbidden('Access denied. Missing manage_permissions permission.');
    }
    const body = UpdateBody.parse(req.body);
    const target = await findUser(username);
    if (target && isSuperAdmin(target)) {
      // Main administrators keep every permission; only their name/email can change (by a main admin).
      if (!isSuperAdmin(actor)) throw forbidden('Main administrators can only be managed by a main administrator.');
      await assertEmailFree(body.email, username);
      await db('users')
        .where({ username })
        .update({ email: body.email || null, full_name: clean(body.fullName, 200) || target.full_name, updated_at: new Date() });
      res.json({ ok: true });
      return;
    }
    assertManageTarget(actor, target);
    const { role, customRole } = splitRole(body.role);
    if (role === 'admin' && target.role !== 'admin' && !isSuperAdmin(actor) && !hasPerm(actor, 'create_admin')) {
      throw forbidden('Access denied. Missing create_admin permission to promote to admin.');
    }
    const college = normalizeCollegeCode(body.college || 'smgg');
    const collegeAccess = normalizeCollegeAccess(college, body.collegeAccess);
    const permissions = voucherScopedPermissions(role, body.permissions);
    assertAssignableAccess(actor, role, college, collegeAccess, permissions, customRole);
    await assertEmailFree(body.email, username);
    await db('users').where({ username }).update({
      role,
      custom_role: customRole || null,
      full_name: clean(body.fullName, 200),
      email: body.email || null,
      college,
      college_access: collegeAccess,
      permissions,
      updated_at: new Date(),
    });
    await audit(actor.username, 'update_user_permissions', 'user', username, { role, college, permissions }, clientIp(req));
    res.json({ ok: true });
  }),
);

const StatusBody = z.object({ status: z.enum(['active', 'blocked']) });

usersRouter.patch(
  '/:username/status',
  ah<AuthedRequest>(async (req, res) => {
    const actor = req.user;
    if (!hasPerm(actor, 'block_users')) throw forbidden('Access denied. Missing block_users permission.');
    const username = clean(req.params.username, 64).toLowerCase();
    const { status } = StatusBody.parse(req.body);
    if (isSuperAdmin(username) && status === 'blocked') throw badRequest('Main admins cannot be blocked');
    if (username === actor.username && status === 'blocked') throw badRequest('You cannot block yourself');
    const target = await findUser(username);
    assertManageTarget(actor, target);
    await db('users')
      .where({ username })
      .update({
        status,
        updated_at: new Date(),
        ...(status === 'blocked' ? { token_version: target.token_version + 1 } : {}),
      });
    if (status === 'blocked') await revokeAllRefreshTokens(username);
    await audit(actor.username, 'set_user_status', 'user', username, status, clientIp(req));
    res.json({ ok: true });
  }),
);

const ResetBody = z.object({ password: z.string() });

usersRouter.post(
  '/:username/reset-password',
  ah<AuthedRequest>(async (req, res) => {
    const actor = req.user;
    const username = clean(req.params.username, 64).toLowerCase();
    if (isSuperAdmin(username)) {
      if (!hasPerm(actor, 'change_admin_key')) throw forbidden('Access denied. Missing change_admin_key permission.');
    } else if (!hasPerm(actor, 'reset_passwords')) {
      throw forbidden('Access denied. Missing reset_passwords permission.');
    }
    await rateLimit(`pwreset:${actor.username}`, 30, 3600);
    const password = assertPassword(ResetBody.parse(req.body).password);
    const target = await findUser(username);
    assertResetTarget(actor, target);
    const self = username === actor.username;
    await db('users')
      .where({ username })
      .update({
        ...(await hashPassword(password)),
        // Main admins and self-resets do not need a forced change.
        must_change_password: !(isSuperAdmin(username) || self),
        token_version: target.token_version + 1,
        updated_at: new Date(),
      });
    await revokeAllRefreshTokens(username);
    await audit(actor.username, 'reset_user_password', 'user', username, 'Password reset and sessions revoked', clientIp(req));
    const full = await findUser(username);
    await sendMail(
      full?.email,
      "Your St. Mary's voucher system password was reset",
      `Hello ${full?.full_name || username},\n\nYour password was reset by ${actor.username}. ` +
        `If you did not expect this, contact your administrator immediately.\n`,
    );
    res.json({ ok: true, signedOut: self });
  }),
);

usersRouter.delete(
  '/:username',
  ah<AuthedRequest>(async (req, res) => {
    const actor = req.user;
    if (!hasPerm(actor, 'block_users')) throw forbidden('Access denied. Missing block_users permission.');
    const username = clean(req.params.username, 64).toLowerCase();
    if (isSuperAdmin(username) || username === 'admin1') throw badRequest('Main admins cannot be deleted');
    if (username === actor.username) throw badRequest('You cannot delete yourself');
    const target = await findUser(username);
    assertManageTarget(actor, target);
    await db('users').where({ username }).delete();
    await revokeAllRefreshTokens(username);
    await audit(actor.username, 'delete_user', 'user', username, 'deleted', clientIp(req));
    res.json({ ok: true });
  }),
);
