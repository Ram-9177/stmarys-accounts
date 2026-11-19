import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, forbidden, HttpError } from '../lib/errors.js';
import { assertPassword, fakeVerify, hashPassword, verifyPassword } from '../lib/passwords.js';
import { actualUsername, campusSuperAdmin } from '../lib/permissions.js';
import { clearHits, rateLimit, readHits, recordHit } from '../lib/rateLimit.js';
import { redis } from '../lib/redis.js';
import { clean, norm, normalizeCollegeCode } from '../lib/text.js';
import {
  clearAuthCookies,
  consumeRefreshToken,
  REFRESH_COOKIE,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  startSession,
} from '../lib/tokens.js';
import { findUser, publicUser, type UserRow } from '../lib/users.js';
import { clientIp, requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { microsoftSso } from '../lib/sso.js';

export const authRouter = Router();

const LOGIN_WINDOW = 15 * 60;
const MAIN_ADMIN_ALIASES = ['admin', 'admin1', 'admin_stmw', 'admin_smhyd'];

authRouter.get(
  '/options',
  ah(async (_req, res) => {
    const row = await db('users').count<{ c: string }[]>({ c: '*' }).first();
    res.json({ needsBootstrap: Number(row?.c ?? 0) === 0, ssoEnabled: config.ssoEnabled });
  }),
);

const LoginBody = z.object({
  username: z.string().max(250),
  password: z.string().max(256),
  college: z.string().max(20).optional().default('smgg'),
});

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const body = LoginBody.parse(req.body);
    const ip = clientIp(req);
    const requested = norm(body.username);
    const college = normalizeCollegeCode(body.college) || 'smgg';
    const ipKey = `login-ip:${ip}`;
    const userKey = `login-user:${requested}`;
    const [ipHits, userHits] = await Promise.all([readHits(ipKey), readHits(userKey)]);
    // A whole campus may share one public IP, so the per-IP limit is generous.
    if (ipHits >= 200 || userHits >= 10) {
      throw new HttpError(429, 'Too many failed login attempts. Please wait 15 minutes and try again.');
    }

    // Main administrators sign in as "superadmin" + the campus they picked;
    // their real usernames are not accepted directly.
    let user: UserRow | undefined;
    if (!MAIN_ADMIN_ALIASES.includes(requested)) {
      const candidates =
        requested === 'superadmin' ? [campusSuperAdmin(college)] : Array.from(new Set([actualUsername(requested), requested]));
      for (const c of candidates) {
        user = await findUser(c);
        if (user) break;
      }
    }

    const ok = user ? await verifyPassword(body.password, user) : await fakeVerify(body.password);
    if (!user || !ok) {
      await Promise.all([recordHit(ipKey, LOGIN_WINDOW), recordHit(userKey, LOGIN_WINDOW)]);
      await audit(requested || 'unknown', 'login_failed', 'user', requested, 'Invalid credentials', ip);
      throw new HttpError(401, 'Invalid username or password');
    }
    if (user.status !== 'active') throw forbidden('User is blocked. Contact admin1.');
    if (userHits > 0) await clearHits(userKey);

    const patch: Partial<UserRow> = { last_login: new Date() };
    if (user.password_algo !== 'bcrypt') {
      // Upgrade legacy Cloudflare hashes (PBKDF2 / SHA-256) to bcrypt on successful login.
      Object.assign(patch, await hashPassword(body.password));
    }
    await db('users').where({ username: user.username }).update(patch);
    await startSession(res, user.username, user.token_version);
    await audit(user.username, 'login', 'user', user.username, 'Login successful', ip);
    res.json({ user: await publicUser({ ...user, ...patch } as UserRow) });
  }),
);

authRouter.post(
  '/refresh',
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const data = token ? await consumeRefreshToken(token) : null;
    const user = data ? await findUser(data.username) : undefined;
    if (!data || !user || user.token_version !== data.tokenVersion || user.status !== 'active') {
      clearAuthCookies(res);
      throw new HttpError(401, 'Session expired. Login again.');
    }
    await startSession(res, user.username, user.token_version);
    res.json({ user: await publicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await revokeRefreshToken(token);
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth({ allowPasswordChange: true }),
  ah<AuthedRequest>(async (req, res) => {
    res.json({ user: await publicUser(req.user) });
  }),
);

const ChangePasswordBody = z.object({ password: z.string() });

authRouter.post(
  '/change-password',
  requireAuth({ allowPasswordChange: true }),
  ah<AuthedRequest>(async (req, res) => {
    const user = req.user;
    await rateLimit(`pwchange:${user.username}`, 10, 3600);
    const password = assertPassword(ChangePasswordBody.parse(req.body).password);
    if (await verifyPassword(password, user)) throw new HttpError(400, 'New password must be different from the current password.');
    const hp = await hashPassword(password);
    const tokenVersion = user.token_version + 1;
    await db('users')
      .where({ username: user.username })
      .update({ ...hp, must_change_password: false, token_version: tokenVersion, updated_at: new Date() });
    // Sign out every other device that was using the old password, then re-issue this session.
    await revokeAllRefreshTokens(user.username);
    await startSession(res, user.username, tokenVersion);
    await audit(user.username, 'change_own_password', 'user', user.username, 'Password changed by user', clientIp(req));
    const fresh = (await findUser(user.username))!;
    res.json({ ok: true, user: await publicUser(fresh) });
  }),
);

const BootstrapBody = z.object({ password: z.string(), college: z.string().optional() });

/** First run only: creates the three campus main administrators sharing one password. */
authRouter.post(
  '/bootstrap',
  ah(async (req, res) => {
    const ip = clientIp(req);
    await rateLimit(`bootstrap:${ip}`, 5, 3600);
    const body = BootstrapBody.parse(req.body);
    const password = assertPassword(body.password);
    await createMainAdmins(password, 'first-run', ip);
    res.json({ ok: true });
  }),
);

export async function createMainAdmins(password: string, actor: string, ip: string): Promise<void> {
  const hp = await hashPassword(password);
  await db.transaction(async (trx) => {
    const row = await trx('users').count<{ c: string }[]>({ c: '*' }).first();
    if (Number(row?.c ?? 0) > 0) throw forbidden('Public sign up is disabled. Only admin1 can create users.');
    const base = { ...hp, role: 'admin', status: 'active', permissions: ['*'], college_access: ['*'], must_change_password: false };
    await trx('users').insert([
      { ...base, username: 'admin', college: 'smgg', full_name: 'Main Administrator' },
      { ...base, username: 'admin_stmw', college: 'smwec', full_name: 'Main Administrator (STMW)' },
      { ...base, username: 'admin_smhyd', college: 'smhyd', full_name: 'Main Administrator (SMHYD)' },
    ]);
    await audit(actor, 'bootstrap_admin', 'user', 'admin', 'Initial main administrators created', ip, trx);
  });
}

// ---------------- Microsoft SSO (OpenID Connect) ----------------

const SSO_COOKIE = 'smv_sso';

authRouter.get(
  '/sso/microsoft',
  ah(async (req, res) => {
    if (!config.ssoEnabled) throw new HttpError(404, 'Microsoft sign-in is not configured.');
    const college = normalizeCollegeCode(req.query.college) || 'smgg';
    const { url, state } = await microsoftSso.start(college);
    const handle = randomBytes(24).toString('base64url');
    await redis.set(`sso:${handle}`, JSON.stringify(state), 'EX', 600);
    res.cookie(SSO_COOKIE, handle, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/api/auth/sso',
      maxAge: 600_000,
    });
    res.redirect(url);
  }),
);

authRouter.get(
  '/sso/microsoft/callback',
  ah(async (req, res) => {
    const fail = (msg: string) => res.redirect(`${config.APP_ORIGIN}/login?error=${encodeURIComponent(msg)}`);
    if (!config.ssoEnabled) return fail('Microsoft sign-in is not configured.');
    const handle = req.cookies?.[SSO_COOKIE] as string | undefined;
    res.clearCookie(SSO_COOKIE, { path: '/api/auth/sso' });
    const raw = handle ? await redis.getdel(`sso:${handle}`) : null;
    if (!raw) return fail('Sign-in expired. Please try again.');
    let email: string;
    let college: string;
    try {
      ({ email, college } = await microsoftSso.finish(new URL(req.originalUrl, config.APP_ORIGIN), JSON.parse(raw)));
    } catch (err) {
      console.error('SSO callback failed', err);
      return fail('Microsoft sign-in failed.');
    }
    const user = await db<UserRow>('users').whereRaw('lower(email) = ?', [clean(email, 320).toLowerCase()]).first();
    if (!user) {
      await audit(email, 'sso_login_failed', 'user', email, 'No user linked to this Microsoft account', clientIp(req));
      return fail('No voucher-system account is linked to this Microsoft account. Ask admin1 to add your email.');
    }
    if (user.status !== 'active') return fail('User is blocked. Contact admin1.');
    await db('users').where({ username: user.username }).update({ last_login: new Date() });
    await startSession(res, user.username, user.token_version);
    await audit(user.username, 'login', 'user', user.username, 'Microsoft SSO login', clientIp(req));
    res.redirect(`${config.APP_ORIGIN}/?college=${encodeURIComponent(college)}`);
  }),
);
