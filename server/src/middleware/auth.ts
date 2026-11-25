import type { NextFunction, Request, Response } from 'express';
import { config, legacyLoginEnabled } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/tokens.js';
import { findUser, type UserRow } from '../lib/users.js';
import type { UosContext } from '../uos/identity.js';
import { authenticateUosPass, readUosPass } from '../uos/session.js';

export interface AuthedRequest extends Request {
  user: UserRow;
  /** Set when the request is authenticated with a UOS module pass. */
  uos?: UosContext;
}

/**
 * Loads the signed-in user on every request so blocking, permission changes and
 * password resets take effect immediately (token_version mismatch => 401).
 *
 * With UOS enabled, a module pass (cookie set at handoff, or a Bearer header)
 * is checked first: signature, expiry, UOS sign-out/deactivation, and the
 * campus the pass is for (the user is limited to that campus's colleges).
 */
export function requireAuth({ allowPasswordChange = false } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (config.uos.enabled) {
        const pass = readUosPass(req);
        if (pass) {
          const ctx = await authenticateUosPass(pass);
          (req as AuthedRequest).user = ctx.user;
          (req as AuthedRequest).uos = ctx;
          return next();
        }
      }
      const raw = req.cookies?.[ACCESS_COOKIE] as string | undefined;
      const claims = raw ? verifyAccessToken(raw) : null;
      if (!claims) throw loginRequired();
      if (!legacyLoginEnabled()) throw loginRequired();
      const user = await findUser(claims.username);
      if (!user || user.token_version !== claims.tokenVersion) throw new HttpError(401, 'Session expired. Login again.');
      if (user.status !== 'active') throw new HttpError(403, 'User is blocked. Contact admin1.');
      if (user.must_change_password && !allowPasswordChange) {
        throw new HttpError(403, 'Password change required before continuing.');
      }
      (req as AuthedRequest).user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 401 that tells the web app whether to re-enter through UOS or show the sign-in page. */
function loginRequired(): HttpError {
  return config.uos.enabled && !legacyLoginEnabled()
    ? new HttpError(401, 'Open Accounts from UOS to sign in.', { reauth: 'uos' })
    : new HttpError(401, 'Login required');
}

export function clientIp(req: Request): string {
  return req.ip ?? '';
}
