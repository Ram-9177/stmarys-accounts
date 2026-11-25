import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { db } from '../src/db/knex.js';
import { redis } from '../src/lib/redis.js';
import { parseCampusMap } from '../src/uos/campusMap.js';
import { normalizeClaims } from '../src/uos/pass.js';
import { toEpochSeconds } from '../src/uos/revocation.js';
import { app, closeAll, enterFromUos, login, makeMainAdmins, makeUser, mintPass, ORIGIN, resetDb, voucher } from './helpers.js';

const defaults = { ...config.uos };

beforeEach(resetDb);
afterEach(() => {
  Object.assign(config.uos, defaults);
});
afterAll(closeAll);

const cookieNames = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split('=')[0]);

describe('UOS handoff', () => {
  it('publishes what the web app needs to reach the shell', async () => {
    const res = await request(app).get('/api/uos/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, moduleId: 'accounts-test', shellUrl: 'https://uos.test', legacyLogin: true });
    expect(res.body.campuses).toEqual([
      { campusId: 'campus-ap', code: 'AP', name: 'AP campus', colleges: ['smgg', 'smwec'] },
      { campusId: 'campus-hyd', code: 'HYD', name: 'Hyderabad campus', colleges: ['smhyd'] },
    ]);
  });

  it('links an existing user by email, keeps the pass in an httpOnly cookie and limits them to the campus', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in', college_access: ['smgg', 'smhyd'] });
    const { agent, res } = await enterFromUos(mintPass());
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('clerk');
    // smhyd is in the user's access but not in the AP campus the pass is for
    expect(res.body.user.collegeAccess).toEqual(['smgg']);
    expect(res.body.uos).toMatchObject({ campusId: 'campus-ap', colleges: ['smgg'], moduleId: 'accounts-test' });
    expect(res.body.uos.otherColleges).toEqual([{ code: 'smhyd', campusId: 'campus-hyd' }]);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('smv_uos='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api/);

    const row = await db('users').where({ username: 'clerk' }).first();
    expect(row.uos_user_id).toBe('uos-user-1');
    expect(row.uos_org_id).toBe('org-1');
    expect(await db('audit_logs').where({ action: 'uos_linked', entity_id: 'clerk' }).first()).toBeTruthy();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('clerk');
    expect(me.body.uos.campusId).toBe('campus-ap');
    expect((await agent.get('/api/vouchers').query({ college: 'smgg' })).status).toBe(200);
    expect((await agent.get('/api/vouchers').query({ college: 'smhyd' })).status).toBe(403);

    const created = await agent.post('/api/vouchers').set('Origin', ORIGIN).send(voucher());
    expect(created.status).toBe(201);
    expect((await db('vouchers').where({ id: created.body.voucher.id }).first()).created_by).toBe('clerk');
  });

  it('limits main administrators to the campus of the pass too', async () => {
    await makeMainAdmins();
    await db('users').where({ username: 'admin' }).update({ email: 'principal@smru.in' });
    const { agent, res } = await enterFromUos(mintPass({ sub: 'uos-principal', email: 'principal@smru.in' }));
    expect(res.status).toBe(200);
    expect(res.body.user.isSuperAdmin).toBe(true);
    expect(res.body.user.collegeAccess).toEqual(['smgg', 'smwec']);
    expect((await agent.get('/api/vouchers').query({ college: 'smwec' })).status).toBe(200);
    expect((await agent.get('/api/vouchers').query({ college: 'smhyd' })).status).toBe(403);
    expect((await agent.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ college: 'smhyd' }))).status).toBe(403);

    const hyd = await enterFromUos(mintPass({ sub: 'uos-principal', email: 'principal@smru.in', campus_id: 'campus-hyd' }));
    expect(hyd.res.status).toBe(200);
    expect(hyd.res.body.user.collegeAccess).toEqual(['smhyd']);
    expect((await hyd.agent.get('/api/vouchers').query({ college: 'smhyd' })).status).toBe(200);
  });

  it('keeps the cookie past the pass so an expired pass still says "re-enter through UOS"', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const { res } = await enterFromUos(mintPass());
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('smv_uos='))!;
    expect(Number(/Max-Age=(\d+)/i.exec(cookie)?.[1])).toBeGreaterThan(900);
    const expired = mintPass({}, { expiresIn: -60 });
    const me = await request(app).get('/api/auth/me').set('Cookie', `smv_uos=${expired}`);
    expect(me.status).toBe(401);
    expect(me.body).toMatchObject({ reauth: 'uos', error: expect.stringMatching(/expired/) });
  });

  it('accepts the pass as a Bearer header (how UOS modules are normally called)', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const pass = mintPass();
    expect((await enterFromUos(pass)).res.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${pass}`);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('clerk');
  });

  it('creates an unknown person as pending, and lets them in once an admin approves', async () => {
    await makeMainAdmins();
    const pass = mintPass({ sub: 'uos-new', email: 'new.person@smru.in', name: 'New Person' });
    const first = await enterFromUos(pass);
    expect(first.res.status).toBe(403);
    expect(first.res.body.pending).toBe(true);
    expect(cookieNames(first.res)).not.toContain('smv_uos');
    const row = await db('users').where({ uos_user_id: 'uos-new' }).first();
    expect(row).toMatchObject({ username: 'new.person', status: 'pending', email: 'new.person@smru.in', full_name: 'New Person' });
    expect(row.college_access).toEqual(['smgg', 'smwec']);
    expect(row.permissions).toEqual(expect.arrayContaining(['create_voucher', 'view_own_vouchers', 'print_voucher']));

    const admin = await login('superadmin');
    const list = await admin.get('/api/users');
    expect(list.body.users.find((u: { username: string }) => u.username === 'new.person')).toMatchObject({ status: 'pending', uosLinked: true });
    expect((await admin.patch('/api/users/new.person/status').set('Origin', ORIGIN).send({ status: 'active' })).status).toBe(200);

    const again = await enterFromUos(pass);
    expect(again.res.status).toBe(200);
    expect(again.res.body.user.username).toBe('new.person');
    expect((await db('users').where({ uos_user_id: 'uos-new' })).length).toBe(1);
  });

  it('creates ready-to-use users when UOS_NEW_USERS=active, once even if two tabs race', async () => {
    config.uos.newUsers = 'active';
    const pass = mintPass({ sub: 'uos-race', email: 'race@smru.in' });
    const [a, b] = await Promise.all([enterFromUos(pass), enterFromUos(pass)]);
    expect([a.res.status, b.res.status]).toEqual([200, 200]);
    expect((await db('users').where({ uos_user_id: 'uos-race' })).length).toBe(1);
  });

  it('refuses unknown people when UOS_NEW_USERS=off', async () => {
    config.uos.newUsers = 'off';
    const { res } = await enterFromUos(mintPass({ sub: 'uos-x', email: 'x@smru.in' }));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/No Accounts user is linked to x@smru.in/);
    expect(await db('users').where({ uos_user_id: 'uos-x' }).first()).toBeUndefined();
  });

  it('rejects passes that are expired, for another module, wrongly signed or missing a campus', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const other = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const cases: [string, RegExp][] = [
      [mintPass({}, { expiresIn: -120 }), /expired/],
      [mintPass({}, { audience: 'inventory' }), /different module/],
      [mintPass({}, { key: other.privateKey }), /not valid/],
      [mintPass({ campus_id: undefined }), /not for a campus/],
      ['not-a-jwt-at-all-xxxxxxxx', /Sign in through UOS/],
    ];
    for (const [pass, message] of cases) {
      const { res } = await enterFromUos(pass);
      expect(res.status, String(message)).toBe(401);
      expect(res.body.reauth).toBe('uos');
      expect(res.body.error).toMatch(message);
    }
    expect((await db('users').where({ username: 'clerk' }).first()).uos_user_id).toBeNull();
  });

  it('refuses a campus that is not mapped to colleges, and passes for another university', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const unmapped = await enterFromUos(mintPass({ campus_id: 'campus-elsewhere', campus_name: 'Elsewhere' }));
    expect(unmapped.res.status).toBe(403);
    expect(unmapped.res.body.error).toMatch(/not set up for the campus "Elsewhere"/);

    config.uos.orgId = 'org-1';
    expect((await enterFromUos(mintPass({ org_id: 'org-2' }))).res.status).toBe(403);
    expect((await enterFromUos(mintPass({ org_id: 'org-1' }))).res.status).toBe(200);
  });

  it('refuses blocked users and users with no college on the campus', async () => {
    await makeUser('blocked', { email: 'blocked@smru.in', status: 'blocked' });
    await makeUser('hydonly', { email: 'hyd@smru.in', college: 'smhyd', college_access: ['smhyd'] });
    expect((await enterFromUos(mintPass({ sub: 'u-b', email: 'blocked@smru.in' }))).res.status).toBe(403);
    const hyd = await enterFromUos(mintPass({ sub: 'u-h', email: 'hyd@smru.in' }));
    expect(hyd.res.status).toBe(403);
    expect(hyd.res.body.error).toMatch(/no access to the colleges of AP campus/);
  });

  it('refuses an email that is already linked to another UOS person', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in', uos_user_id: 'someone-else' });
    const { res } = await enterFromUos(mintPass());
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/different UOS account/);
  });
});

describe('UOS sign-out and deactivation (platform Redis)', () => {
  it('stops a session at once when the person is deactivated in UOS', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const { agent } = await enterFromUos(mintPass());
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await redis.sadd('org-1:revoked_users', 'uos-user-1');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body).toMatchObject({ reauth: 'uos', error: expect.stringMatching(/no longer active/) });
  });

  it('refuses passes issued before the person signed out of UOS, but not newer ones', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const now = Math.floor(Date.now() / 1000);
    const { agent } = await enterFromUos(mintPass({ iat: now - 60 }));
    await redis.set('org-1:signed_out_at:uos-user-1', String(now - 10));
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const fresh = await enterFromUos(mintPass({ iat: now + 1 }));
    expect(fresh.res.status).toBe(200);
    // milliseconds are understood too
    await redis.set('org-1:signed_out_at:uos-user-1', String((now + 5) * 1000));
    expect((await fresh.agent.get('/api/auth/me')).status).toBe(401);
  });

  it('copes with the revocation list stored as a hash instead of a set', async () => {
    await makeUser('clerk', { email: 'clerk@smru.in' });
    await redis.hset('org-1:revoked_users', 'uos-user-1', '1');
    expect((await enterFromUos(mintPass())).res.status).toBe(401);
  });
});

describe('UOS-only sign-in (UOS_LEGACY_LOGIN=false)', () => {
  it('switches off password sign-in and ends old password sessions', async () => {
    await makeMainAdmins();
    const old = await login('superadmin');
    config.uos.legacyLogin = false;
    expect((await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ username: 'superadmin', password: 'x', college: 'smgg' })).status).toBe(403);
    const me = await old.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.reauth).toBe('uos');
    expect((await old.post('/api/auth/refresh').set('Origin', ORIGIN)).body.reauth).toBe('uos');
    const options = await request(app).get('/api/auth/options');
    expect(options.body).toMatchObject({ legacyLogin: false, needsBootstrap: false, ssoEnabled: false, uosEnabled: true });
    expect((await request(app).post('/api/auth/bootstrap').set('Origin', ORIGIN).send({ password: 'Long-Enough-1' })).status).toBe(403);
  });
});

describe('managing UOS-linked users', () => {
  it('unlinks a user when an admin changes their email, and keeps password changes in UOS', async () => {
    await makeMainAdmins();
    await makeUser('clerk', { email: 'clerk@smru.in' });
    const uos = await enterFromUos(mintPass());
    expect((await uos.agent.post('/api/auth/change-password').set('Origin', ORIGIN).send({ password: 'Another-Pass-9' })).status).toBe(400);

    const admin = await login('superadmin');
    const patch = await admin
      .patch('/api/users/clerk')
      .set('Origin', ORIGIN)
      .send({ role: 'user', fullName: 'Clerk', email: 'clerk.new@smru.in', college: 'smgg', collegeAccess: ['smgg'], permissions: ['create_voucher'] });
    expect(patch.status).toBe(200);
    expect((await db('users').where({ username: 'clerk' }).first()).uos_user_id).toBeNull();
  });

  it('a campus-scoped admin cannot grant colleges outside the campus', async () => {
    await makeUser('boss', {
      email: 'boss@smru.in',
      role: 'admin',
      college_access: ['smgg', 'smhyd'],
      permissions: ['create_users', 'manage_permissions', 'view_dashboard'],
    });
    const { agent } = await enterFromUos(mintPass({ sub: 'uos-boss', email: 'boss@smru.in' }));
    const res = await agent
      .post('/api/users')
      .set('Origin', ORIGIN)
      .send({ username: 'helper', password: 'Helper-Pass-1', role: 'user', college: 'smhyd', collegeAccess: ['smhyd'] });
    expect(res.status).toBe(403);
  });
});

describe('UOS helpers', () => {
  it('parses the campus map and rejects a college under two campuses', () => {
    expect(parseCampusMap('{"c1": "smgg, smg", "c2": {"code": "HYD", "colleges": ["SMHYD"]}}')).toEqual([
      { campusId: 'c1', code: '', name: '', colleges: ['smgg'] },
      { campusId: 'c2', code: 'HYD', name: '', colleges: ['smhyd'] },
    ]);
    expect(() => parseCampusMap('{"c1": ["smgg"], "c2": ["smgg"]}')).toThrow(/two campuses/);
    expect(() => parseCampusMap('not json')).toThrow(/must be JSON/);
  });

  it('reads pass claims in the shapes the auth server may use', () => {
    const c = normalizeClaims({
      sub: 'u1',
      exp: 2,
      iat: 1,
      orgId: 'o1',
      campus: { id: 'c1', code: 'AP', name: 'AP campus' },
      user: { email: 'A@SMRU.IN', first_name: 'Asha', last_name: 'Rao' },
      mods: ['accounts', { id: 'hostel' }],
    });
    expect(c).toMatchObject({ userId: 'u1', orgId: 'o1', campusId: 'c1', campusCode: 'AP', email: 'a@smru.in', name: 'Asha Rao', modules: ['accounts', 'hostel'] });
  });

  it('reads sign-out times in seconds, milliseconds or ISO form', () => {
    expect(toEpochSeconds('1700000000')).toBe(1700000000);
    expect(toEpochSeconds('1700000000123')).toBe(1700000000);
    expect(toEpochSeconds('2023-11-14T22:13:20.000Z')).toBe(1700000000);
    expect(toEpochSeconds(null)).toBeNull();
  });
});
