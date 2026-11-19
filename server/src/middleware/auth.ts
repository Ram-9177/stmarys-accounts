import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/tokens.js';
import { findUser, type UserRow } from '../lib/users.js';

export interface AuthedRequest extends Request {
  user: UserRow;
}

/**
 * Loads the signed-in user on every request so blocking, permission changes and
 * password resets take effect immediately (token_version mismatch => 401).
 */
export function requireAuth({ allowPasswordChange = false } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const raw = req.cookies?.[ACCESS_COOKIE] as string | undefined;
      const claims = raw ? verifyAccessToken(raw) : null;
      if (!claims) throw new HttpError(401, 'Login required');
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

export function clientIp(req: Request): string {
  return req.ip ?? '';
}
