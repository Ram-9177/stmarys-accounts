import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { PERMISSIONS } from './lib/permissions.js';
import { type CampusRule, parseCampusMap } from './uos/campusMap.js';

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
  /** Postgres schema holding this app's tables. UOS tenant DBs keep one schema per module (e.g. "accounts"). Empty = public. */
  DATABASE_SCHEMA: z.string().default(''),
  /** Connection used to run migrations (UOS: the <prefix>_admin role). Defaults to DATABASE_URL. */
  MIGRATION_DATABASE_URL: z.string().default(''),
  /** After migrating, grant table and sequence rights on the schema to this role (UOS: the <prefix>_app role). */
  DB_APP_ROLE: z.string().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Prefix for this app's own Redis keys, e.g. "accounts:" when the Redis is shared with other UOS services. */
  REDIS_KEY_PREFIX: z.string().default(''),

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

  // ---- UOS platform: open Accounts from the UOS shell with a module pass (see docs/UOS_INTEGRATION.md) ----
  UOS_ENABLED: bool.default(false),
  /** This module's id on the UOS auth server: the audience of its module passes and the moduleId sent to /reselect. */
  UOS_MODULE_ID: z.string().default(''),
  /** Expected `iss` of module passes (optional). */
  UOS_ISSUER: z.string().default(''),
  /** The auth server's public key: PEM or base64 PEM. Several PEM blocks may be given during key rotation. */
  UOS_AUTH_PUBLIC_KEY: z.string().optional(),
  /** Alternatively, a file holding the public key (the module template's AUTH_PUBLIC_KEY_PATH). */
  UOS_AUTH_PUBLIC_KEY_PATH: z.string().default(''),
  /** The UOS shell (uos-auth-ui) origin, e.g. https://uos.smru.in. Used for /reselect and the launcher link. */
  UOS_SHELL_URL: z.string().default(''),
  /** Shell page to open when someone signs out of Accounts (default: the shell's home page). */
  UOS_SHELL_LOGOUT_PATH: z.string().default(''),
  /** JSON map of UOS campus id -> college codes, e.g. {"<campus id>": ["smgg","smwec"], "<campus id>": ["smhyd"]}. */
  UOS_CAMPUS_MAP: z.string().default(''),
  /** Org id to use when a pass carries none (normally the pass has it). */
  UOS_ORG_ID: z.string().default(''),
  /**
   * A UOS person with no linked Accounts user (no matching email) gets a new user:
   * "pending" = created but waiting for an Accounts admin to approve (Users & Permissions),
   * "active"  = created ready to use, "off" = refused until an admin adds their email.
   */
  UOS_NEW_USERS: z.enum(['pending', 'active', 'off']).default('pending'),
  /** Permissions for users created that way (the same default set as a user created by an admin). */
  UOS_DEFAULT_PERMISSIONS: z.string().default('create_voucher,view_own_vouchers,print_voucher'),
  /** Keep username/password and Microsoft sign-in. Turn off once everyone opens Accounts from UOS. */
  UOS_LEGACY_LOGIN: bool.default(true),
  /** Check UOS sign-out and deactivation in the platform Redis on every request. */
  UOS_REVOCATION_CHECK: bool.default(true),
  /** The platform Redis the auth server writes revocations to (with its db number). Defaults to REDIS_URL outside production. */
  UOS_REDIS_URL: z.string().default(''),
  /** Pre-link existing users to UOS by email on start-up, e.g. "admin:principal@smru.in,baji:baji@smru.in". Only fills empty emails. */
  UOS_LINK_EMAILS: z.string().default(''),
});

export interface UosConfig {
  enabled: boolean;
  moduleId: string;
  issuer: string;
  publicKeys: string[];
  shellUrl: string;
  shellLogoutPath: string;
  campuses: CampusRule[];
  orgId: string;
  newUsers: 'pending' | 'active' | 'off';
  defaultPermissions: string[];
  legacyLogin: boolean;
  revocationCheck: boolean;
  redisUrl: string;
  linkEmails: { username: string; email: string }[];
}

export type Config = z.infer<typeof EnvSchema> & {
  jwtPrivateKey: string;
  jwtPublicKey: string;
  cookieSecure: boolean;
  allowedOrigins: string[];
  ssoEnabled: boolean;
  mailEnabled: boolean;
  uos: UosConfig;
};

function decodePem(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v.startsWith('-----BEGIN')) return v.replace(/\\n/g, '\n');
  return Buffer.from(v, 'base64').toString('utf8');
}

const PEM_BLOCK = /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g;
const SQL_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** All PEM blocks in a value (PEM, escaped-newline PEM or base64 PEM). */
function pemBlocks(value: string | undefined): string[] {
  const pem = decodePem(value);
  return pem ? (pem.match(PEM_BLOCK) ?? []) : [];
}

function loadUos(env: z.infer<typeof EnvSchema>): UosConfig {
  const fail = (msg: string): never => {
    throw new Error(`UOS configuration: ${msg}`);
  };
  const publicKeys = [...pemBlocks(env.UOS_AUTH_PUBLIC_KEY)];
  if (env.UOS_AUTH_PUBLIC_KEY_PATH) {
    if (!fs.existsSync(env.UOS_AUTH_PUBLIC_KEY_PATH)) fail(`UOS_AUTH_PUBLIC_KEY_PATH not found: ${env.UOS_AUTH_PUBLIC_KEY_PATH}`);
    publicKeys.push(...pemBlocks(fs.readFileSync(env.UOS_AUTH_PUBLIC_KEY_PATH, 'utf8')));
  }
  let campuses: CampusRule[] = [];
  try {
    campuses = parseCampusMap(env.UOS_CAMPUS_MAP);
  } catch (err) {
    // A half-filled example value must not stop the app while UOS is switched off.
    if (env.UOS_ENABLED) throw err;
  }
  const defaultPermissions = env.UOS_DEFAULT_PERMISSIONS.split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of defaultPermissions) {
    if (!(PERMISSIONS as readonly string[]).includes(p)) fail(`UOS_DEFAULT_PERMISSIONS: unknown permission "${p}"`);
  }
  const linkEmails = env.UOS_LINK_EMAILS.split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      const username = pair.slice(0, i).trim().toLowerCase();
      const email = pair.slice(i + 1).trim().toLowerCase();
      if (i < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`UOS_LINK_EMAILS: expected username:email, got "${pair}"`);
      return { username, email };
    });
  const shellUrl = env.UOS_SHELL_URL.trim().replace(/\/+$/, '');
  const uos: UosConfig = {
    enabled: env.UOS_ENABLED,
    moduleId: env.UOS_MODULE_ID.trim(),
    issuer: env.UOS_ISSUER.trim(),
    publicKeys,
    shellUrl,
    shellLogoutPath: env.UOS_SHELL_LOGOUT_PATH.trim(),
    campuses,
    orgId: env.UOS_ORG_ID.trim(),
    newUsers: env.UOS_NEW_USERS,
    defaultPermissions,
    legacyLogin: env.UOS_LEGACY_LOGIN,
    revocationCheck: env.UOS_REVOCATION_CHECK,
    redisUrl: env.UOS_REDIS_URL.trim() || (env.NODE_ENV === 'production' ? '' : env.REDIS_URL),
    linkEmails,
  };
  if (!uos.enabled) return uos;

  if (!uos.moduleId) fail('UOS_MODULE_ID is required (the module id registered on the auth server).');
  if (!publicKeys.length) fail('UOS_AUTH_PUBLIC_KEY or UOS_AUTH_PUBLIC_KEY_PATH is required (the auth server public key).');
  for (const key of publicKeys) {
    let type: string | undefined;
    try {
      type = createPublicKey(key).asymmetricKeyType;
    } catch {
      fail('the UOS auth server public key could not be read.');
    }
    if (type !== 'rsa') fail('the UOS auth server public key must be an RSA key (passes are RS256).');
  }
  let shell: URL | null = null;
  try {
    shell = new URL(shellUrl);
  } catch {
    fail('UOS_SHELL_URL must be the shell URL, e.g. https://uos.smru.in');
  }
  if (env.NODE_ENV === 'production' && shell!.protocol !== 'https:') fail('UOS_SHELL_URL must use https in production.');
  if (!campuses.length) fail('UOS_CAMPUS_MAP is required: which colleges each UOS campus opens.');
  if (uos.revocationCheck && !uos.redisUrl) {
    fail('UOS_REDIS_URL is required in production: the platform Redis (and db number) where the auth server writes sign-outs.');
  }
  return uos;
}

/** Username/password (and Microsoft) sign-in: always on without UOS, optional with it. */
export function legacyLoginEnabled(): boolean {
  return !config.uos.enabled || config.uos.legacyLogin;
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
  if (env.DATABASE_SCHEMA && !SQL_IDENT.test(env.DATABASE_SCHEMA)) {
    throw new Error('DATABASE_SCHEMA must be a lowercase SQL identifier, e.g. accounts');
  }
  if (env.DB_APP_ROLE && !SQL_IDENT.test(env.DB_APP_ROLE)) {
    throw new Error('DB_APP_ROLE must be a lowercase SQL identifier, e.g. accounts_app');
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
    uos: loadUos(env),
  };
}

export const config: Config = load();
