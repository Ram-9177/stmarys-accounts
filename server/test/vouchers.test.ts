import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAll, login, makeMainAdmins, makeUser, ORIGIN, resetDb, voucher } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  await makeMainAdmins();
  await makeUser('clerk'); // default user perms: create_voucher, view_own_vouchers, print_voucher, view_vendor_ledger
  await makeUser('clerk2', { permissions: ['create_voucher', 'view_own_vouchers'] });
  await makeUser('editor', { permissions: ['create_voucher', 'view_own_vouchers', 'edit_voucher', 'delete_voucher'] });
});
afterAll(closeAll);

describe('vouchers', () => {
  it('creates a voucher with a campus/type/year number', async () => {
    const clerk = await login('clerk');
    const res = await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ date: '19/11/2026' }));
    expect(res.status).toBe(201);
    expect(res.body.voucher.voucherNo).toMatch(/^SMGG-DV-\d{4}-00001$/);
    expect(res.body.voucher.date).toBe('2026-11-19');
    expect(res.body.voucher.createdBy).toBe('clerk');
  });

  it('validates required fields, dates and on-account rules', async () => {
    const clerk = await login('clerk');
    const post = (v: Record<string, unknown>) => clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher(v));
    expect((await post({ amount: 0 })).status).toBe(400);
    expect((await post({ head: '' })).status).toBe(400);
    expect((await post({ date: '2026-02-30' })).status).toBe(400);
    expect((await post({ type: 'refund' })).status).toBe(400);
    expect((await post({ type: 'onaccount' })).body.error).toMatch(/phone/i);
    const early = await post({ type: 'onaccount', recipientPhone: '9999999999', reversalDate: '2026-11-01' });
    expect(early.body.error).toMatch(/cannot be before/);
  });

  it('regular users see their own vouchers plus all on-account ones; admins see everything', async () => {
    const clerk = await login('clerk2');
    const other = await login('editor');
    const admin = await login('superadmin');
    await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ head: 'Mine' }));
    await other.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ head: 'Theirs' }));
    await other.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ head: 'Shared OA', type: 'onaccount', recipientPhone: '9000000000' }));

    const mine = (await clerk.get('/api/vouchers?college=smgg')).body.vouchers.map((v: { head: string }) => v.head).sort();
    expect(mine).toEqual(['Mine', 'Shared OA']);
    expect((await admin.get('/api/vouchers?college=smgg')).body.vouchers).toHaveLength(3);
  });

  it('enforces college access', async () => {
    const clerk = await login('clerk');
    expect((await clerk.get('/api/vouchers?college=smwec')).status).toBe(403);
    expect((await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ college: 'smwec' }))).status).toBe(403);
    const admin = await login('superadmin');
    expect((await admin.get('/api/vouchers?college=smwec')).status).toBe(200);
  });

  it('without edit_voucher a user may only update on-account vouchers', async () => {
    const clerk = await login('clerk');
    const debit = (await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher())).body.voucher;
    const oa = (await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ type: 'onaccount', recipientPhone: '9000000000' })))
      .body.voucher;

    expect((await clerk.put(`/api/vouchers/${debit.id}`).set('Origin', ORIGIN).send(voucher({ amount: 1 }))).status).toBe(403);
    const cleared = await clerk
      .put(`/api/vouchers/${oa.id}`)
      .set('Origin', ORIGIN)
      .send(voucher({ type: 'onaccount', recipientPhone: '9000000000', reversalDate: '2026-11-20' }));
    expect(cleared.status).toBe(200);
    expect(cleared.body.voucher.reversalDate).toBe('2026-11-20');
    // ...but cannot turn it into a debit voucher
    expect((await clerk.put(`/api/vouchers/${oa.id}`).set('Origin', ORIGIN).send(voucher({ type: 'debit' }))).status).toBe(403);
  });

  it('editors cannot modify other users\' non-on-account vouchers; admins can; delete is a soft delete', async () => {
    const clerk = await login('clerk');
    const editor = await login('editor');
    const admin = await login('superadmin');
    const v = (await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher())).body.voucher;

    expect((await editor.put(`/api/vouchers/${v.id}`).set('Origin', ORIGIN).send(voucher({ amount: 99 }))).status).toBe(403);
    expect((await clerk.delete(`/api/vouchers/${v.id}`).set('Origin', ORIGIN)).status).toBe(403); // no delete_voucher
    const upd = await admin.put(`/api/vouchers/${v.id}`).set('Origin', ORIGIN).send(voucher({ amount: 99 }));
    expect(upd.body.voucher.amount).toBe(99);
    expect(upd.body.voucher.voucherNo).toBe(v.voucherNo);
    expect((await admin.delete(`/api/vouchers/${v.id}`).set('Origin', ORIGIN)).status).toBe(200);
    expect((await admin.get('/api/vouchers?college=smgg')).body.vouchers).toHaveLength(0);
    expect((await admin.delete(`/api/vouchers/${v.id}`).set('Origin', ORIGIN)).status).toBe(404);
  });

  it('answers 304 when nothing changed (cheap live sync)', async () => {
    const clerk = await login('clerk');
    await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher());
    const first = await clerk.get('/api/vouchers?college=smgg');
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    expect((await clerk.get('/api/vouchers?college=smgg').set('If-None-Match', etag)).status).toBe(304);
    await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher());
    expect((await clerk.get('/api/vouchers?college=smgg').set('If-None-Match', etag)).status).toBe(200);
  });

  it('account heads and blocks need account_heads permission to add and are per-college', async () => {
    const clerk = await login('clerk');
    const admin = await login('superadmin');
    expect((await clerk.post('/api/heads').set('Origin', ORIGIN).send({ name: 'Diesel' })).status).toBe(403);
    await admin.post('/api/heads').set('Origin', ORIGIN).send({ name: 'Diesel', type: 'debit', college: 'smgg' });
    await admin.post('/api/heads').set('Origin', ORIGIN).send({ name: '  diesel ', college: 'smgg' }); // duplicate ignored
    await admin.post('/api/blocks').set('Origin', ORIGIN).send({ name: 'A Block', college: 'smwec' });
    expect((await clerk.get('/api/heads?college=smgg')).body.heads.map((h: { name: string }) => h.name)).toEqual(['Diesel']);
    expect((await clerk.get('/api/blocks?college=smgg')).body.blocks).toHaveLength(0);
  });
});
