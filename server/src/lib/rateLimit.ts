import { HttpError } from './errors.js';
import { redis } from './redis.js';

/** Fixed-window counters in Redis. */
export async function readHits(key: string): Promise<number> {
  return Number((await redis.get('rl:' + key)) ?? 0);
}

export async function recordHit(key: string, windowSeconds: number): Promise<number> {
  const k = 'rl:' + key;
  const [[, count]] = (await redis.multi().incr(k).expire(k, windowSeconds, 'NX').exec()) as [[unknown, number]];
  return count;
}

export async function clearHits(key: string): Promise<void> {
  await redis.del('rl:' + key);
}

/** Counts this attempt and rejects with 429 once the limit is exceeded. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const count = await recordHit(key, windowSeconds);
  if (count > limit) {
    throw new HttpError(429, `Too many attempts. Please wait ${Math.ceil(windowSeconds / 60)} minutes and try again.`);
  }
}
