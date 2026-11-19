import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/knex.js';
import { app, closeAll, login, makeMainAdmins, makeUser, ORIGIN, PASSWORD, resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  await makeMainAdmins();
});
afterAll(closeAll);

describe('user management', () => {
  it('main admin creates a user who must change the password on first login', async () => {
    const admin = await login('superadmin');
    const res = await admin
      .post('/api/users')
      .set('Origin', ORIGIN)
      .send({ username: 'Clerk1', password: 'Initial-Pass-1', role: 'user', college: 'smwec', email: 'clerk1@stmarys.example' });
    expect(res.status).toBe(201);
    const row = await db('users').where({ username: 'clerk1' }).first();
    expect(row.must_change_password).toBe(true);
    expect(row.college_access).toEqual(['smwec']);
    expect(row.permissions).toEqual(expect.arrayContaining(['create_voucher', 'view_own_vouchers']));
    expect(row.permissions).not.toContain('view_all_vouchers');
    expect((await admin.post('/api/users').set('Origin', ORIGIN).send({ username: 'clerk1', password: 'Initial-Pass-1' })).status).toBe(409);
    expect((await admin.post('/api/users').set('Origin', ORIGIN).send({ username: 'superadmin', password: 'Initial-Pass-1' })).status).toBe(400);
  });

  it('a delegated admin cannot grant permissions or colleges they do not have', async () => {
    await makeUser('manager', { role: 'admin', permissions: ['create_users', 'create_voucher', 'view_own_vouchers'], college_access: ['smgg'] });
    const mgr = await login('manager');
    const escalate = await mgr
      .post('/api/users')
      .set('Origin', ORIGIN)
      .send({ username: 'x1', password: 'Initial-Pass-1', permissions: ['create_voucher', 'delete_voucher'] });
    expect(escalate.status).toBe(403);
    const otherCollege = await mgr.post('/api/users').set('Origin', ORIGIN).send({ username: 'x2', password: 'Initial-Pass-1', college: 'smwec' });
    expect(otherCollege.status).toBe(403);
    const makeAdmin = await mgr.post('/api/users').set('Origin', ORIGIN).send({ username: 'x3', password: 'Initial-Pass-1', role: 'admin' });
    expect(makeAdmin.status).toBe(403);
    const ok = await mgr
      .post('/api/users')
      .set('Origin', ORIGIN)
      .send({ username: 'x4', password: 'Initial-Pass-1', permissions: ['create_voucher'] });
    expect(ok.status).toBe(201);
  });

  it('cannot take over a more privileged account', async () => {
    await makeUser('resetter', { role: 'user', permissions: ['reset_passwords', 'block_users'] });
    await makeUser('power', { role: 'user', permissions: ['delete_voucher'] });
    const r = await login('resetter');
    expect((await r.post('/api/users/power/reset-password').set('Origin', ORIGIN).send({ password: 'Hijack-Pass-11' })).status).toBe(403);
    expect((await r.post('/api/users/admin/reset-password').set('Origin', ORIGIN).send({ password: 'Hijack-Pass-11' })).status).toBe(403);
    expect((await r.patch('/api/users/admin/status').set('Origin', ORIGIN).send({ status: 'blocked' })).status).toBe(400);
  });

  it('password reset and blocking sign the target out immediately', async () => {
    await makeUser('clerk');
    const clerk = await login('clerk');
    const admin = await login('superadmin');
    expect((await clerk.get('/api/auth/me')).status).toBe(200);

    expect((await admin.post('/api/users/clerk/reset-password').set('Origin', ORIGIN).send({ password: 'Reset-Pass-123' })).status).toBe(200);
    expect((await clerk.get('/api/auth/me')).status).toBe(401);
    const relog = await request(app).post('/api/auth/login').send({ username: 'clerk', password: 'Reset-Pass-123' });
    expect(relog.body.user.mustChangePassword).toBe(true);

    const clerk2 = await login('clerk', 'Reset-Pass-123');
    expect((await admin.patch('/api/users/clerk/status').set('Origin', ORIGIN).send({ status: 'blocked' })).status).toBe(200);
    expect((await clerk2.get('/api/auth/me')).status).toBe(401);
  });

  it('lists only manageable users and never exposes password data', async () => {
    await makeUser('clerk');
    const admin = await login('superadmin');
    const res = await admin.get('/api/users');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
    await makeUser('nobody');
    const nobody = await login('nobody');
    expect((await nobody.get('/api/users')).status).toBe(403);
  });

  it('records an audit trail visible to main admins only', async () => {
    await makeUser('clerk');
    const admin = await login('superadmin');
    await login('clerk');
    const logs = (await admin.get('/api/audit')).body.logs as { action: string; actor: string }[];
    expect(logs.some((l) => l.action === 'login' && l.actor === 'clerk')).toBe(true);
    expect((await (await login('clerk')).get('/api/audit')).status).toBe(403);
  });
});

const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');

describe('vendors', () => {
  it('saves vendors with attachments, lists them, and serves files with a safe content type', async () => {
    const admin = await login('superadmin');
    const save = await admin
      .put('/api/vendors')
      .set('Origin', ORIGIN)
      .send({
        college: 'smgg',
        vendor: {
          vendorId: 'V00001',
          companyName: 'ACME Works',
          agreedAmount: 12000,
          address: 'Guntur',
          agreement: { agreementNo: 'AGR-V00001', files: [] },
          files: [{ name: 'agreement.pdf', dataUrl: PDF }],
        },
      });
    expect(save.status).toBe(200);
    const vendor = save.body.vendor;
    expect(vendor.address).toBe('Guntur');
    expect(vendor.files).toHaveLength(1);
    expect(JSON.stringify(vendor)).not.toContain('base64');

    const file = await admin.get(`/api/vendors/V00001/files/${vendor.files[0].id}?college=smgg`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    // keep the existing file, update a field
    const upd = await admin
      .put('/api/vendors')
      .set('Origin', ORIGIN)
      .send({ college: 'smgg', vendor: { vendorId: 'V00001', companyName: 'ACME Works Ltd', files: [{ id: vendor.files[0].id }] } });
    expect(upd.body.vendor.companyName).toBe('ACME Works Ltd');
    expect(upd.body.vendor.files).toHaveLength(1);
  });

  it('create mode refuses to overwrite an existing vendor ID', async () => {
    const admin = await login('superadmin');
    const first = await admin.put('/api/vendors').set('Origin', ORIGIN).send({ college: 'smgg', create: true, vendor: { vendorId: 'V00009', companyName: 'First' } });
    expect(first.status).toBe(200);
    const clash = await admin.put('/api/vendors').set('Origin', ORIGIN).send({ college: 'smgg', create: true, vendor: { vendorId: 'V00009', companyName: 'Second' } });
    expect(clash.status).toBe(409);
    const list = (await admin.get('/api/vendors?college=smgg')).body.vendors;
    expect(list.find((v: { vendorId: string }) => v.vendorId === 'V00009').companyName).toBe('First');
  });

  it('rejects disguised or disallowed attachments', async () => {
    const admin = await login('superadmin');
    const html = 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
    const bad1 = await admin.put('/api/vendors').set('Origin', ORIGIN).send({ vendor: { vendorId: 'V1', companyName: 'X', files: [{ name: 'a.pdf', dataUrl: html }] } });
    const bad2 = await admin.put('/api/vendors').set('Origin', ORIGIN).send({ vendor: { vendorId: 'V1', companyName: 'X', files: [{ name: 'a.html', dataUrl: PDF }] } });
    expect(bad1.status).toBe(400);
    expect(bad2.status).toBe(400);
  });

  it('regular users can view the vendor ledger but not change vendors; bulk import reports failures', async () => {
    await makeUser('clerk');
    const clerk = await login('clerk');
    const admin = await login('superadmin');
    expect((await clerk.put('/api/vendors').set('Origin', ORIGIN).send({ vendor: { vendorId: 'V2', companyName: 'X' } })).status).toBe(403);
    const bulk = await admin
      .post('/api/vendors/bulk')
      .set('Origin', ORIGIN)
      .send({ college: 'smgg', vendors: [{ vendorId: 'V10', companyName: 'A' }, { vendorId: '', companyName: 'B' }, { vendorId: 'V11', vendorName: 'C' }] });
    expect(bulk.body).toMatchObject({ saved: 2, failed: [{ error: 'Vendor ID is required' }] });
    expect((await clerk.get('/api/vendors?college=smgg')).body.vendors).toHaveLength(2);
    expect((await admin.delete('/api/vendors/V10?college=smgg').set('Origin', ORIGIN)).status).toBe(200);
    expect((await clerk.get('/api/vendors?college=smgg')).body.vendors).toHaveLength(1);
  });
});

describe('colleges', () => {
  it('public picker lists active colleges; only manage_colleges can add or disable', async () => {
    const admin = await login('superadmin');
    expect((await request(app).get('/api/colleges/public')).body.colleges).toHaveLength(3);
    const created = await admin.post('/api/colleges').set('Origin', ORIGIN).send({ name: 'St. Marys Vizag', code: 'smvz', location: 'Vizag' });
    expect(created.status).toBe(201);
    expect((await admin.patch('/api/colleges/smgg/status').set('Origin', ORIGIN).send({ status: 'inactive' })).status).toBe(400);
    await admin.patch('/api/colleges/smvz/status').set('Origin', ORIGIN).send({ status: 'inactive' });
    expect((await request(app).get('/api/colleges/public')).body.colleges).toHaveLength(3);
    await makeUser('clerk');
    const clerk = await login('clerk');
    expect((await clerk.post('/api/colleges').set('Origin', ORIGIN).send({ name: 'Nope' })).status).toBe(403);
    expect(PASSWORD).toBeTruthy();
  });
});
