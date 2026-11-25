import { Redis } from 'ioredis';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import type { UosClaims } from './pass.js';

/**
 * UOS sign-out and deactivation.
 *
 * The auth server writes these to the platform Redis so that every module
 * refuses a person's passes at once:
 *   <orgId>:revoked_users           - people who are deactivated (a set of user ids)
 *   <orgId>:signed_out_at:<userId>  - when the person last signed out
 * A pass issued at or before the sign-out time is refused.
 */

let client: Redis | null = null;

/** Separate client, never key-prefixed: these keys belong to the platform. */
function uosRedis(): Redis {
  if (!client) {
    client = new Redis(config.uos.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: true });
    client.on('error', (err) => console.error('UOS Redis error:', err.message));
  }
  return client;
}

export async function closeUosRedis(): Promise<void> {
  if (client) {
    const c = client;
    client = null;
    await c.quit().catch(() => c.disconnect());
  }
}

/** Seconds since epoch from a stored sign-out time (epoch seconds, epoch ms or an ISO date). */
export function toEpochSeconds(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** Membership test that copes with the revocation list being a set, hash, sorted set, list or JSON string. */
async function isListed(r: Redis, key: string, userId: string): Promise<boolean> {
  const type = await r.type(key);
  if (type === 'none') return false;
  if (type === 'set') return (await r.sismember(key, userId)) === 1;
  if (type === 'hash') return (await r.hexists(key, userId)) === 1;
  if (type === 'zset') return (await r.zscore(key, userId)) !== null;
  if (type === 'list') return (await r.lrange(key, 0, -1)).includes(userId);
  const raw = (await r.get(key)) ?? '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).includes(userId);
  } catch {
    /* not JSON */
  }
  return raw.split(',').map((s) => s.trim()).includes(userId);
}

/** Throws 401 (re-enter through UOS) if the person was signed out or deactivated since the pass was issued. */
export async function assertNotRevoked(c: UosClaims): Promise<void> {
  if (!config.uos.revocationCheck) return;
  if (!c.orgId) throw new HttpError(401, 'This UOS pass does not name a university.', { reauth: 'uos' });
  const r = uosRedis();
  const listKey = `${c.orgId}:revoked_users`;
  const outKey = `${c.orgId}:signed_out_at:${c.userId}`;
  let revoked: boolean;
  let signedOut: number | null;
  try {
    const res = await r.pipeline().sismember(listKey, c.userId).get(outKey).exec();
    const [memberErr, member] = res?.[0] ?? [null, 0];
    const [outErr, out] = res?.[1] ?? [null, null];
    if (outErr) throw outErr;
    revoked = memberErr ? await isListed(r, listKey, c.userId) : member === 1;
    signedOut = toEpochSeconds(out as string | null);
  } catch (err) {
    console.error('UOS revocation check failed', err);
    // Fail closed: without the check, a signed-out person could keep using a pass.
    throw new HttpError(503, "Can't check your UOS session right now. Please try again in a minute.");
  }
  if (revoked) throw new HttpError(401, 'Your UOS account is no longer active.', { reauth: 'uos' });
  const issuedAt = c.iat || c.exp - 15 * 60;
  if (signedOut !== null && issuedAt <= signedOut) {
    throw new HttpError(401, 'You signed out of UOS. Sign in again to continue.', { reauth: 'uos' });
  }
}
