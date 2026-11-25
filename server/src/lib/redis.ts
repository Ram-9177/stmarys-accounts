import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  // On a Redis shared with other UOS services, keep this app's keys apart (e.g. "accounts:").
  ...(config.REDIS_KEY_PREFIX ? { keyPrefix: config.REDIS_KEY_PREFIX } : {}),
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});
