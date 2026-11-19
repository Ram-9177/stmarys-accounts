import bcrypt from 'bcryptjs';
import { createHash, pbkdf2 as pbkdf2Cb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { badRequest } from './errors.js';

const pbkdf2 = promisify(pbkdf2Cb);

export const MIN_PASSWORD_LENGTH = 8;
const LEGACY_PBKDF2_ITERATIONS = 100_000;

export type PasswordAlgo = 'bcrypt' | 'pbkdf2' | 'sha256';

export interface StoredPassword {
  password_hash: string;
  password_algo: PasswordAlgo | string;
  password_salt: string | null;
}

export function assertPassword(password: unknown): string {
  const p = String(password ?? '');
  if (p.length < MIN_PASSWORD_LENGTH) throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (p.length > 72) throw badRequest('Password is too long (maximum 72 characters)');
  if (/^stmarys@1234$/i.test(p)) throw badRequest('This default password is not allowed. Choose a unique password.');
  return p;
}

export async function hashPassword(password: string): Promise<{ password_hash: string; password_algo: 'bcrypt'; password_salt: null }> {
  return { password_hash: await bcrypt.hash(password, config.BCRYPT_ROUNDS), password_algo: 'bcrypt', password_salt: null };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verifies bcrypt hashes and the two legacy D1 formats:
 *  - pbkdf2: PBKDF2-SHA256, 100k iterations, base64 salt and base64 hash
 *  - sha256: unsalted hex SHA-256 (oldest accounts)
 */
export async function verifyPassword(password: string, stored: StoredPassword): Promise<boolean> {
  if (!password || password.length > 256) return false;
  switch (stored.password_algo) {
    case 'bcrypt':
      return bcrypt.compare(password, stored.password_hash);
    case 'pbkdf2': {
      if (!stored.password_salt) return false;
      const bits = await pbkdf2(password, Buffer.from(stored.password_salt, 'base64'), LEGACY_PBKDF2_ITERATIONS, 32, 'sha256');
      return safeEqual(bits.toString('base64'), stored.password_hash);
    }
    case 'sha256':
      return safeEqual(createHash('sha256').update(password).digest('hex'), stored.password_hash);
    default:
      return false;
  }
}

/** Run a comparable amount of work when the user does not exist, so timing does not reveal it. */
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', 10);
export async function fakeVerify(password: string): Promise<false> {
  await bcrypt.compare(password || 'x', DUMMY_HASH);
  return false;
}
