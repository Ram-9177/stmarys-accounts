import type { Request, Response } from 'express';
import { config } from '../config.js';
import { resolveForRequest, type UosContext } from './identity.js';
import { verifyModulePass } from './pass.js';
import { assertNotRevoked } from './revocation.js';

/**
 * After the handoff the module pass is kept in an httpOnly cookie, so page
 * scripts never hold it. API clients may instead send it as
 * `Authorization: Bearer <pass>`, the way UOS modules are normally called.
 * There is no refresh: when the pass expires the web app re-enters through the
 * shell's /reselect, which issues a new pass.
 */
export const UOS_COOKIE = 'smv_uos';

export function readUosPass(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim() || null;
  const cookie = req.cookies?.[UOS_COOKIE] as string | undefined;
  return cookie || null;
}

const cookieOptions = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: '/api' });

/**
 * The cookie outlives the pass on purpose: an expired pass still tells the API
 * this was a UOS session, so it answers "re-enter through UOS" (and the web app
 * keeps unsaved work) instead of a plain "login required".
 */
const COOKIE_GRACE_MS = 8 * 60 * 60 * 1000;

export function setUosCookie(res: Response, pass: string, exp: number): void {
  res.cookie(UOS_COOKIE, pass, { ...cookieOptions(), maxAge: Math.max(0, exp * 1000 - Date.now()) + COOKIE_GRACE_MS });
}

export function clearUosCookie(res: Response): void {
  res.clearCookie(UOS_COOKIE, cookieOptions());
}

/** Verifies the pass, checks UOS sign-out/deactivation and loads the linked Accounts user. */
export async function authenticateUosPass(pass: string): Promise<UosContext> {
  const claims = verifyModulePass(pass);
  await assertNotRevoked(claims);
  return resolveForRequest(claims);
}
