import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/knex.js';
import { hashPassword } from '../src/lib/passwords.js';
import { redis } from '../src/lib/redis.js';

export const app = createApp();
export const ORIGIN = 'http://app.test';
export const PASSWORD = 'Correct-Horse-9';

export async function resetDb() {
  await db.migrate.latest();
  await db.raw('TRUNCATE vendor_files, vendors, audit_logs, blocks, account_heads, vouchers, users RESTART IDENTITY CASCADE');
  await db('colleges').whereNotIn('code', ['smgg', 'smwec', 'smhyd']).delete();
  await db('colleges').update({ status: 'active' });
  await redis.flushdb();
}

export async function makeUser(username: string, overrides: Record<string, unknown> = {}, password = PASSWORD) {
  await db('users').insert({
    username,
    ...(await hashPassword(password)),
    role: 'user',
    status: 'active',
    college: 'smgg',
    college_access: ['smgg'],
    permissions: null,
    full_name: username,
    ...overrides,
  });
}

export async function makeMainAdmins() {
  await makeUser('admin', { role: 'admin', permissions: ['*'], college_access: ['*'] });
  await makeUser('admin_stmw', { role: 'admin', college: 'smwec', permissions: ['*'], college_access: ['*'] });
}

/** Logs in and returns a supertest agent that keeps the auth cookies. */
export async function login(username: string, password = PASSWORD, college = 'smgg') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ username, password, college });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export function voucher(overrides: Record<string, unknown> = {}) {
  return {
    college: 'smgg',
    type: 'debit',
    date: '2026-11-19',
    head: 'Electricity',
    towards: 'November bill',
    amount: 1500,
    amtWords: 'One Thousand Five Hundred Rupees Only',
    paidTo: 'APSPDCL',
    mode: 'Cash',
    ...overrides,
  };
}

export async function closeAll() {
  await Promise.allSettled([db.destroy(), redis.quit()]);
}
