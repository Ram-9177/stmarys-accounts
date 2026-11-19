import { createHash, webcrypto } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/knex.js';
import { app, closeAll, login, makeMainAdmins, makeUser, ORIGIN, PASSWORD, resetDb } from './helpers.js';

/** Exactly how the Cloudflare Worker hashed passwords (WebCrypto PBKDF2-SHA256, 100k, base64). */
async function legacyPbkdf2(password: string) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { password_salt: Buffer.from(salt).toString('base64'), password_hash: Buffer.from(new Uint8Array(bits)).toString('base64') };
}

beforeEach(resetDb);
afterAll(closeAll);

describe('login', () => {
  it('accepts a migrated PBKDF2 password and upgrades it to bcrypt', async () => {
    await makeUser('5812');
    await db('users').where({ username: '5812' }).update({ ...(await legacyPbkdf2('Legacy-Pass-1')), password_algo: 'pbkdf2' });

    const res = await request(app).post('/api/auth/login').send({ username: '5812', password: 'Legacy-Pass-1', college: 'smgg' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('5812');
    const row = await db('users').where({ username: '5812' }).first();
    expect(row.password_algo).toBe('bcrypt');
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);

    // still works after the upgrade
    expect((await request(app).post('/api/auth/login').send({ username: '5812', password: 'Legacy-Pass-1' })).status).toBe(200);
  });

  it('accepts the oldest unsalted SHA-256 format', async () => {
    await makeUser('old');
    await db('users')
      .where({ username: 'old' })
      .update({ password_algo: 'sha256', password_salt: null, password_hash: createHash('sha256').update('Sha-Pass-12').digest('hex') });
    expect((await request(app).post('/api/auth/login').send({ username: 'old', password: 'Sha-Pass-12' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ username: 'old', password: 'wrong-pass' })).status).toBe(401);
  });

  it('main admins sign in as "superadmin" + campus, not with their real username', async () => {
    await makeMainAdmins();
    const direct = await request(app).post('/api/auth/login').send({ username: 'admin', password: PASSWORD });
    expect(direct.status).toBe(401);
    const stmw = await request(app).post('/api/auth/login').send({ username: 'superadmin', password: PASSWORD, college: 'smwec' });
    expect(stmw.status).toBe(200);
    expect(stmw.body.user.username).toBe('admin_stmw');
    expect(stmw.body.user.displayName).toBe('admin1');
    expect(stmw.body.user.isSuperAdmin).toBe(true);
    expect(stmw.body.user.collegeAccess).toEqual(expect.arrayContaining(['smgg', 'smwec', 'smhyd']));
  });

  it('gives the same error for unknown users and wrong passwords, and locks an account after 10 failures', async () => {
    await makeUser('clerk');
    const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'whatever1' });
    const wrong = await request(app).post('/api/auth/login').send({ username: 'clerk', password: 'whatever1' });
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    for (let i = 0; i < 9; i++) await request(app).post('/api/auth/login').send({ username: 'clerk', password: 'bad-pass-x' });
    const locked = await request(app).post('/api/auth/login').send({ username: 'clerk', password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it('rejects blocked users', async () => {
    await makeUser('blocked', { status: 'blocked' });
    expect((await request(app).post('/api/auth/login').send({ username: 'blocked', password: PASSWORD })).status).toBe(403);
  });
});

describe('sessions', () => {
  it('sets httpOnly cookies, serves /me, and rotates refresh tokens (old one becomes invalid)', async () => {
    await makeUser('clerk');
    const res = await request(app).post('/api/auth/login').send({ username: 'clerk', password: PASSWORD });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toMatch(/smv_at=.*HttpOnly/);
    const rt = cookies.find((c) => c.startsWith('smv_rt='))!.split(';')[0];
    const at = cookies.find((c) => c.startsWith('smv_at='))!.split(';')[0];

    expect((await request(app).get('/api/auth/me').set('Cookie', at)).body.user.username).toBe('clerk');
    const first = await request(app).post('/api/auth/refresh').set('Cookie', rt);
    expect(first.status).toBe(200);
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', rt);
    expect(replay.status).toBe(401);
  });

  it('rejects requests without a session and logout revokes the refresh token', async () => {
    expect((await request(app).get('/api/vouchers')).status).toBe(401);
    await makeUser('clerk');
    const agent = await login('clerk');
    expect((await agent.post('/api/auth/logout').set('Origin', ORIGIN)).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await agent.post('/api/auth/refresh').set('Origin', ORIGIN)).status).toBe(401);
  });

  it('forces a password change before anything else, then signs other devices out', async () => {
    await makeUser('newbie', { must_change_password: true });
    const agent = await login('newbie');
    const other = await login('newbie');
    expect((await agent.get('/api/vouchers')).status).toBe(403);
    expect((await agent.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);

    const same = await agent.post('/api/auth/change-password').set('Origin', ORIGIN).send({ password: PASSWORD });
    expect(same.status).toBe(400);
    const short = await agent.post('/api/auth/change-password').set('Origin', ORIGIN).send({ password: 'short' });
    expect(short.status).toBe(400);
    const ok = await agent.post('/api/auth/change-password').set('Origin', ORIGIN).send({ password: 'Brand-New-Pass-7' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);

    expect((await agent.get('/api/vouchers')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects state-changing requests from foreign origins', async () => {
    await makeUser('clerk');
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ username: 'clerk', password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('bootstrap', () => {
  it('creates the main admins only when there are no users', async () => {
    expect((await request(app).get('/api/auth/options')).body.needsBootstrap).toBe(true);
    const ok = await request(app).post('/api/auth/bootstrap').send({ password: 'First-Admin-Pass1' });
    expect(ok.status).toBe(200);
    expect((await db('users').pluck('username')).sort()).toEqual(['admin', 'admin_smhyd', 'admin_stmw']);
    const again = await request(app).post('/api/auth/bootstrap').send({ password: 'Another-Pass-11' });
    expect(again.status).toBe(403);
    const signIn = await request(app).post('/api/auth/login').send({ username: 'superadmin', password: 'First-Admin-Pass1', college: 'smhyd' });
    expect(signIn.body.user.username).toBe('admin_smhyd');
  });
});
