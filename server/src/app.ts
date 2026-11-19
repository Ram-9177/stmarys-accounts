import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db/knex.js';
import { errorHandler, HttpError } from './lib/errors.js';
import { redis } from './lib/redis.js';
import { requireAuth } from './middleware/auth.js';
import { auditRouter, collegesRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { blocksRouter, headsRouter } from './routes/lookups.js';
import { usersRouter } from './routes/users.js';
import { vendorsRouter } from './routes/vendors.js';
import { vouchersRouter } from './routes/vouchers.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence: auth cookies are SameSite=Lax, and every state-changing request
 * must come from an allowed Origin (browsers always send Origin on POST/PUT/PATCH/DELETE).
 */
function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser clients (curl, server-to-server) carry no ambient cookies
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin === self || config.allowedOrigins.includes(origin)) return next();
  next(new HttpError(403, 'Cross-origin request rejected'));
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'blob:'],
          objectSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          formAction: ["'self'", 'https://login.microsoftonline.com'],
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginEmbedderPolicy: false,
      frameguard: { action: 'sameorigin' },
    }),
  );
  app.use(cookieParser());
  // Vendor attachments travel as base64 (3 files x 5 MB max).
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([
      db.raw('select 1').then(() => true, () => false),
      redis.ping().then(() => true, () => false),
    ]);
    res.status(dbOk && redisOk ? 200 : 503).json({ ok: dbOk && redisOk, db: dbOk, redis: redisOk });
  });

  app.use('/api', originGuard, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/auth', authRouter);
  app.use('/api/colleges', collegesRouter);
  app.use('/api/vouchers', requireAuth(), vouchersRouter);
  app.use('/api/heads', requireAuth(), headsRouter);
  app.use('/api/blocks', requireAuth(), blocksRouter);
  app.use('/api/vendors', requireAuth(), vendorsRouter);
  app.use('/api/users', requireAuth(), usersRouter);
  app.use('/api/audit', requireAuth(), auditRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route')));

  if (config.STATIC_DIR && fs.existsSync(config.STATIC_DIR)) {
    const dir = path.resolve(config.STATIC_DIR);
    app.use('/assets', express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
