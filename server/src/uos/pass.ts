import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * A UOS module pass, reduced to what Accounts needs.
 *
 * The auth server signs a pass at POST /auth/select-module: RS256, about 15
 * minutes, audience = this module's id, carrying the campus and the person's
 * facts. The claim names below are read tolerantly (snake_case, camelCase,
 * nested `user`/`campus` objects) until they are pinned against
 * uos-auth-server; see docs/UOS_INTEGRATION.md.
 */
export interface UosClaims {
  userId: string;
  orgId: string;
  campusId: string;
  campusCode: string;
  campusName: string;
  email: string;
  name: string;
  orgRole: string;
  isSuperAdmin: boolean;
  /** Modules the person can reach (`mods`, only on some auth-server branches). */
  modules: string[];
  /** Seconds since epoch. */
  iat: number;
  exp: number;
}

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

function pick(sources: (Obj | null)[], keys: string[]): string {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
  }
  return '';
}

/** Maps a verified JWT payload to UosClaims. Throws if it lacks a person or a campus. */
export function normalizeClaims(payload: Obj): UosClaims {
  const user = asObj(payload.user) ?? asObj(payload.person);
  const campusObj = asObj(payload.campus);
  const orgObj = asObj(payload.org) ?? asObj(payload.organization);
  const top = [payload, user];

  const userId = pick([payload], ['sub', 'user_id', 'userId', 'uid']) || pick([user], ['id', 'user_id', 'userId']);
  const campusId =
    pick([payload], ['campus_id', 'campusId']) || pick([campusObj], ['id', 'campus_id']) || (typeof payload.campus === 'string' ? payload.campus : '');
  const campusCode = pick([payload], ['campus_code', 'campusCode', 'campus_tag']) || pick([campusObj], ['code', 'tag', 'slug']);
  const orgId =
    pick([payload, user], ['org_id', 'orgId', 'organization_id', 'tenant_id']) ||
    pick([orgObj], ['id']) ||
    (typeof payload.org === 'string' ? payload.org : '') ||
    config.uos.orgId;
  const first = pick(top, ['first_name', 'given_name', 'firstName']);
  const last = pick(top, ['last_name', 'family_name', 'lastName']);
  const name = pick(top, ['name', 'full_name', 'fullName', 'display_name', 'displayName']) || [first, last].filter(Boolean).join(' ');
  const rawMods = payload.mods ?? payload.modules;
  const modules = Array.isArray(rawMods)
    ? rawMods.map((m) => (typeof m === 'string' ? m : pick([asObj(m)], ['id', 'name']))).filter(Boolean)
    : [];

  const exp = Number(payload.exp ?? 0);
  const iat = Number(payload.iat ?? 0);
  if (!userId) throw new HttpError(401, 'This UOS pass does not say who you are.', { reauth: 'uos' });
  if (!campusId && !campusCode) throw new HttpError(401, 'This UOS pass is not for a campus.', { reauth: 'uos' });
  return {
    userId,
    orgId,
    campusId,
    campusCode,
    campusName: pick([payload], ['campus_name', 'campusName']) || pick([campusObj], ['name']),
    email: pick(top, ['email', 'mail', 'preferred_username']).toLowerCase(),
    name,
    orgRole: pick(top, ['org_role', 'orgRole']),
    isSuperAdmin: payload.is_super_admin === true || payload.isSuperAdmin === true,
    modules,
    iat: Number.isFinite(iat) ? iat : 0,
    exp: Number.isFinite(exp) ? exp : 0,
  };
}

const reauth = (message: string) => new HttpError(401, message, { reauth: 'uos' });

/**
 * Verifies a module pass with the auth server's public key(s): RS256 only,
 * audience = UOS_MODULE_ID, optional issuer, 30 s clock tolerance.
 */
export function verifyModulePass(token: string): UosClaims {
  const { publicKeys, moduleId, issuer } = config.uos;
  if (!token || token.split('.').length !== 3) throw reauth('Sign in through UOS to open Accounts.');
  let lastError: unknown = null;
  for (const key of publicKeys) {
    try {
      const payload = jwt.verify(token, key, {
        algorithms: ['RS256'],
        audience: moduleId,
        ...(issuer ? { issuer } : {}),
        clockTolerance: 30,
      });
      if (typeof payload === 'string') throw reauth('This UOS pass is not valid.');
      const claims = normalizeClaims(payload as Obj);
      if (!claims.exp) throw reauth('This UOS pass has no expiry.');
      return claims;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastError = err;
      // A signature made with another key: try the next one (key rotation).
      if (err instanceof jwt.JsonWebTokenError && err.message === 'invalid signature') continue;
      break;
    }
  }
  if (lastError instanceof jwt.TokenExpiredError) throw reauth('Your UOS session has expired.');
  if (lastError instanceof jwt.JsonWebTokenError && /audience/.test(lastError.message)) {
    throw reauth('This UOS pass is for a different module.');
  }
  throw reauth('This UOS pass is not valid.');
}
