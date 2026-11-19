import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});
