import { generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Public origin of the web app, e.g. https://vouchers.stmarys.edu.in. Used for CORS/origin checks and SSO redirects. */
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Extra comma-separated origins allowed to call the API (e.g. the Vite dev server). */
  EXTRA_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default('1'),
  /** If set, the API also serves the built React app from this folder (single-container deploys). */
  STATIC_DIR: z.string().default(''),

  DATABASE_URL: z.string().default('postgres://localhost:5432/stmarys'),
  DATABASE_SSL: bool.default(false),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  /** RS256 key pair, PEM or base64-encoded PEM. Generate with `npm run keys`. */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: bool.optional(),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  /** Only used when the users table is empty: creates the three main administrators with this password. */
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),

  // Microsoft SSO (optional) - leave MS_CLIENT_ID empty to disable.
  MS_TENANT_ID: z.string().default('common'),
  MS_CLIENT_ID: z.string().default(''),
  MS_CLIENT_SECRET: z.string().default(''),

  // Email (optional) - leave SMTP_HOST empty to disable.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default("St. Mary's Vouchers <no-reply@localhost>"),
});

export type Config = z.infer<typeof EnvSchema> & {
  jwtPrivateKey: string;
  jwtPublicKey: string;
  cookieSecure: boolean;
  allowedOrigins: string[];
  ssoEnabled: boolean;
  mailEnabled: boolean;
};

function decodePem(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v.startsWith('-----BEGIN')) return v.replace(/\\n/g, '\n');
  return Buffer.from(v, 'base64').toString('utf8');
}

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('Invalid environment configuration: ' + JSON.stringify(parsed.error.flatten().fieldErrors));
  }
  const env = parsed.data;
  let priv = decodePem(env.JWT_PRIVATE_KEY);
  let pub = decodePem(env.JWT_PUBLIC_KEY);
  if (!priv || !pub) {
    if (env.NODE_ENV === 'production') {
      throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production. Run `npm run keys -w server`.');
    }
    // Development/test: ephemeral key pair (sessions reset on restart).
    const kp = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    priv = kp.privateKey;
    pub = kp.publicKey;
  }
  const allowedOrigins = [env.APP_ORIGIN, ...env.EXTRA_ORIGINS.split(',')]
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return {
    ...env,
    jwtPrivateKey: priv,
    jwtPublicKey: pub,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    allowedOrigins,
    ssoEnabled: Boolean(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET),
    mailEnabled: Boolean(env.SMTP_HOST),
  };
}

export const config: Config = load();
