import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAll, login, makeMainAdmins, makeUser, ORIGIN, resetDb, voucher } from './helpers.js';

/** On Account vouchers now come from an advance: planned and prepared by `by`, approved by a main administrator. */
async function paidAdvance(by: Awaited<ReturnType<typeof login>>, extra: Record<string, unknown> = {}) {
  const planned = await by
    .post('/api/advances')
    .set('Origin', ORIGIN)
    .send({ college: 'smgg', payeeKind: 'employee', payeeName: 'Ravi', payeePhone: '9000000000', amount: 1500, form: 'Cash', receivedBy: 'Ravi', ...extra });
  if (planned.status !== 201) throw new Error(`plan failed: ${JSON.stringify(planned.body)}`);
  const admin = await login('superadmin');
  const paid = await admin.post(`/api/advances/${planned.body.advance.id}/approve`).set('Origin', ORIGIN).send({});
  if (paid.status !== 200) throw new Error(`approve failed: ${JSON.stringify(paid.body)}`);
  return paid.body.advance as { id: number; voucherId: number; advanceNo: string };
}

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
    await paidAdvance(await login('clerk'), { head: 'Shared OA' });

    const mine = (await clerk.get('/api/vouchers?college=smgg')).body.vouchers.map((v: { head: string }) => v.head).sort();
    expect(mine).toEqual(['Mine', 'Shared OA']);
    expect((await admin.get('/api/vouchers?college=smgg')).body.vouchers).toHaveLength(3);
  });

  it('view_vendor_ledger alone does not reveal other users\' vouchers, but ledger payments stay complete', async () => {
    const clerk = await login('clerk'); // default perms include view_vendor_ledger
    const other = await login('editor');
    await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ head: 'Mine' }));
    await other.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ head: 'Theirs' }));
    await other.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ head: 'Vendor pay', vendorId: 'V00001', amount: 4000 }));

    const list = (await clerk.get('/api/vouchers?college=smgg')).body.vouchers.map((v: { head: string }) => v.head);
    expect(list).toEqual(['Mine']);
    const pay = await clerk.get('/api/vendors/payments?college=smgg');
    expect(pay.status).toBe(200);
    expect(pay.body.vouchers.map((v: { head: string; amount: number }) => [v.head, v.amount])).toEqual([['Vendor pay', 4000]]);
    const noVendorPerm = await login('clerk2');
    expect((await noVendorPerm.get('/api/vendors/payments?college=smgg')).status).toBe(403);
  });

  it('enforces college access', async () => {
    const clerk = await login('clerk');
    expect((await clerk.get('/api/vouchers?college=smwec')).status).toBe(403);
    expect((await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ college: 'smwec' }))).status).toBe(403);
    const admin = await login('superadmin');
    expect((await admin.get('/api/vouchers?college=smwec')).status).toBe(200);
  });

  it('without edit_voucher a user may only update on-account vouchers, and never what the advance owns', async () => {
    const clerk = await login('clerk');
    const debit = (await clerk.post('/api/vouchers').set('Origin', ORIGIN).send(voucher())).body.voucher;
    const advance = await paidAdvance(clerk);
    const oa = (await clerk.get('/api/vouchers?college=smgg')).body.vouchers.find((v: { id: number }) => v.id === advance.voucherId);
    expect(oa.advance).toMatchObject({ advanceNo: advance.advanceNo, role: 'payment' });
    const same = { ...oa, college: 'smgg' };

    expect((await clerk.put(`/api/vouchers/${debit.id}`).set('Origin', ORIGIN).send(voucher({ amount: 1 }))).status).toBe(403);
    const described = await clerk.put(`/api/vouchers/${oa.id}`).set('Origin', ORIGIN).send({ ...same, towards: 'Exam stationery' });
    expect(described.status).toBe(200);
    expect(described.body.voucher.towards).toBe('Exam stationery');
    // Clearing is done on the advance (set off or money returned), not by typing a date on the voucher...
    const cleared = await clerk.put(`/api/vouchers/${oa.id}`).set('Origin', ORIGIN).send({ ...same, reversalDate: '2099-12-31' });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error).toMatch(/kept on the advance/);
    // ...and it cannot be turned into a debit voucher.
    expect((await clerk.put(`/api/vouchers/${oa.id}`).set('Origin', ORIGIN).send({ ...same, type: 'debit' })).status).toBe(400);
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
