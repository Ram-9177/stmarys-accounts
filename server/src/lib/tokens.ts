import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { redis } from './redis.js';

export const ACCESS_COOKIE = 'smv_at';
export const REFRESH_COOKIE = 'smv_rt';
const ISSUER = 'stmarys-vouchers';

interface AccessClaims {
  sub: string;
  tv: number;
  typ: 'access';
}

export function signAccessToken(username: string, tokenVersion: number): string {
  const claims: AccessClaims = { sub: username, tv: tokenVersion, typ: 'access' };
  return jwt.sign(claims, config.jwtPrivateKey, {
    algorithm: 'RS256',
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
  });
}

export function verifyAccessToken(token: string): { username: string; tokenVersion: number } | null {
  try {
    const p = jwt.verify(token, config.jwtPublicKey, { algorithms: ['RS256'], issuer: ISSUER }) as jwt.JwtPayload;
    if (p.typ !== 'access' || typeof p.sub !== 'string') return null;
    return { username: p.sub, tokenVersion: Number(p.tv ?? 0) };
  } catch {
    return null;
  }
}

// ---- Refresh tokens: opaque, stored hashed in Redis, rotated on every use ----

const rtKey = (hash: string) => `rt:${hash}`;
const userSetKey = (username: string) => `urt:${username}`;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function issueRefreshToken(username: string, tokenVersion: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = sha(token);
  const ttl = config.REFRESH_TOKEN_TTL_DAYS * 86400;
  await redis
    .multi()
    .set(rtKey(hash), JSON.stringify({ username, tv: tokenVersion }), 'EX', ttl)
    .sadd(userSetKey(username), hash)
    .expire(userSetKey(username), ttl)
    .exec();
  return token;
}

/** Consumes a refresh token (single use). Returns its owner or null if unknown/expired. */
export async function consumeRefreshToken(token: string): Promise<{ username: string; tokenVersion: number } | null> {
  if (!token) return null;
  const hash = sha(token);
  const raw = await redis.getdel(rtKey(hash));
  if (!raw) return null;
  const data = JSON.parse(raw) as { username: string; tv: number };
  await redis.srem(userSetKey(data.username), hash);
  return { username: data.username, tokenVersion: data.tv };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  if (token) await consumeRefreshToken(token);
}

/** Signs a user out everywhere (password reset, block, delete). Access tokens die via token_version. */
export async function revokeAllRefreshTokens(username: string, exceptToken?: string): Promise<void> {
  const keep = exceptToken ? sha(exceptToken) : null;
  const hashes = await redis.smembers(userSetKey(username));
  const drop = hashes.filter((h) => h !== keep);
  if (!drop.length) return;
  await redis
    .multi()
    .del(...drop.map(rtKey))
    .srem(userSetKey(username), ...drop)
    .exec();
}

function cookieBase(): CookieOptions {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...cookieBase(), path: '/api', maxAge: config.ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieBase(),
    path: '/api/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/api/auth' });
}

export async function startSession(res: Response, username: string, tokenVersion: number): Promise<void> {
  const access = signAccessToken(username, tokenVersion);
  const refresh = await issueRefreshToken(username, tokenVersion);
  setAuthCookies(res, access, refresh);
}
