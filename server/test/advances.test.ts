import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { db } from '../src/db/knex.js';
import { addDays, backfillLegacyAdvances, sweepOverdue, today } from '../src/finance/advances.js';
import { app, closeAll, login, makeMainAdmins, makeUser, ORIGIN, resetDb, voucher } from './helpers.js';

const SECRET = 'test-mrf-link-secret-0123456789';
const defaults = { approval: config.ADVANCE_APPROVAL };

beforeEach(async () => {
  await resetDb();
  await makeMainAdmins();
  await makeUser('clerk'); // default permissions include manage_advances
  await makeUser('anitha', { role: 'admin', permissions: ['manage_advances', 'approve_advances', 'view_all_vouchers'] });
  await makeUser('rekha', { role: 'admin', permissions: ['approve_advances', 'view_all_vouchers'] });
});
afterEach(() => {
  config.ADVANCE_APPROVAL = defaults.approval;
});
afterAll(closeAll);

type Agent = Awaited<ReturnType<typeof login>>;
const post = (agent: Agent, path: string, body: Record<string, unknown> = {}) => agent.post(path).set('Origin', ORIGIN).send(body);
const mrf = () => ({
  send: (type: string, data: Record<string, unknown>, eventId = `${type}-${Math.random()}`) =>
    request(app).post('/api/mrf/v1/events').set('x-module-credential', SECRET).send({ eventId, type, data }),
  get: (path: string) => request(app).get(`/api/mrf/v1${path}`).set('x-module-credential', SECRET),
});
const outbox = () => db('mrf_outbox').orderBy('id');

const employeeAdvance = (extra: Record<string, unknown> = {}) => ({
  college: 'smgg',
  payeeKind: 'employee',
  payeeName: 'Kiran',
  payeePhone: '9876543210',
  amount: 20000,
  purpose: 'Cables, local market',
  caseNo: 'MRF-0145',
  recoveredBy: 'Anitha',
  form: 'NEFT',
  reference: 'UTR-SBIN-0001',
  ...extra,
});

describe('On Account: plan, prepare, second approver, paid (F2 steps 1-3)', () => {
  it('pays only after a second person approves, writes the voucher and tells MRF (X4)', async () => {
    const clerk = await login('clerk');
    const planned = await post(clerk, '/api/advances', employeeAdvance());
    expect(planned.status).toBe(201);
    const a = planned.body.advance;
    expect(a).toMatchObject({ state: 'prepared', amount: 20000, settleBy: addDays(today(), 15), caseNo: 'MRF-0145' });
    expect(a.advanceNo).toMatch(/^SMGG-ADV-\d{4}-00001$/);
    expect(a.figures).toMatchObject({ given: 0, outstanding: 0, toRecover: 0 });
    expect(await db('vouchers').count<{ c: string }[]>({ c: '*' }).first()).toMatchObject({ c: 0 });

    // The one who prepared it cannot approve it; nor can someone without approve_advances.
    expect((await post(clerk, `/api/advances/${a.id}/approve`)).status).toBe(403);

    const rekha = await login('rekha');
    const paid = await post(rekha, `/api/advances/${a.id}/approve`);
    expect(paid.status).toBe(200);
    expect(paid.body.advance).toMatchObject({ state: 'with_payee', approvedBy: 'rekha' });
    expect(paid.body.advance.figures).toMatchObject({ given: 20000, settled: 0, outstanding: 20000, toRecover: 0, overdue: false });

    const v = await db('vouchers').where({ id: paid.body.advance.voucherId }).first();
    expect(v).toMatchObject({ type: 'onaccount', amount: 20000, paid_to: 'Kiran', recipient_phone: '9876543210', mode: 'NEFT', cheque: 'UTR-SBIN-0001', created_by: 'clerk' });
    expect(v.voucher_no).toMatch(/^SMGG-OA-/);
    expect(v.amt_words).toBe('Twenty Thousand Rupees Only');

    const events = await outbox();
    expect(events.map((e) => e.event_type)).toEqual(['advance.planned', 'advance.paid']);
    expect(events[1].payload.advance).toMatchObject({ case: 'MRF-0145', given: 20000, settled: 0, toRecover: 0, payment: { form: 'NEFT', reference: 'UTR-SBIN-0001' } });

    // The voucher list shows which advance a voucher belongs to.
    const list = await clerk.get('/api/vouchers').query({ college: 'smgg' });
    expect(list.body.vouchers[0].advance).toMatchObject({ advanceNo: a.advanceNo, role: 'payment' });
  });

  it('refuses a form above its limit, and payments without a form or reference', async () => {
    const clerk = await login('clerk');
    const cash = await post(clerk, '/api/advances', employeeAdvance({ form: 'Cash', reference: '', receivedBy: 'Kiran', amount: 15000 }));
    expect(cash.status).toBe(400);
    expect(cash.body.error).toMatch(/Cash can pay at most ₹10,000/);
    const noRef = await post(clerk, '/api/advances', employeeAdvance({ reference: '' }));
    expect(noRef.body.error).toMatch(/reference/);
    const noReceiver = await post(clerk, '/api/advances', employeeAdvance({ form: 'Cash', reference: '', amount: 5000 }));
    expect(noReceiver.body.error).toMatch(/who receives/);
    expect((await post(clerk, '/api/advances', employeeAdvance({ form: 'Cash', reference: '', receivedBy: 'Kiran', amount: 5000 }))).status).toBe(201);
  });

  it('a big advance is approved by a main administrator or a Head', async () => {
    const anitha = await login('anitha');
    const big = (await post(anitha, '/api/advances', employeeAdvance({ amount: 250000 }))).body.advance;
    const rekha = await login('rekha');
    const refused = await post(rekha, `/api/advances/${big.id}/approve`);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/above ₹2,00,000/);
    const admin = await login('superadmin');
    expect((await post(admin, `/api/advances/${big.id}/approve`)).status).toBe(200);
  });

  it('can be sent back for changes, and cancelled before it is paid', async () => {
    const clerk = await login('clerk');
    const a = (await post(clerk, '/api/advances', employeeAdvance())).body.advance;
    const rekha = await login('rekha');
    const back = await post(rekha, `/api/advances/${a.id}/send-back`, { reason: 'Wrong UTR' });
    expect(back.body.advance).toMatchObject({ state: 'planned', returnReason: 'Wrong UTR' });
    const again = await post(clerk, `/api/advances/${a.id}/prepare`, { form: 'NEFT', reference: 'UTR-SBIN-0002' });
    expect(again.body.advance).toMatchObject({ state: 'prepared', returnReason: '' });
    const cancelled = await post(clerk, `/api/advances/${a.id}/cancel`, { reason: 'Bought from stock instead' });
    expect(cancelled.body.advance.state).toBe('cancelled');
    expect((await outbox()).map((e) => e.event_type)).toEqual(['advance.planned', 'advance.cancelled']);
  });

  it('with approval switched off, prepared means paid', async () => {
    config.ADVANCE_APPROVAL = 'off';
    const clerk = await login('clerk');
    const a = (await post(clerk, '/api/advances', employeeAdvance())).body.advance;
    expect(a.state).toBe('with_payee');
    expect(a.figures.given).toBe(20000);
  });
});

describe('On Account: settle against bills, return, recover (F2 steps 4-7)', () => {
  async function paidAdvance(extra: Record<string, unknown> = {}) {
    const clerk = await login('clerk');
    const a = (await post(clerk, '/api/advances', employeeAdvance(extra))).body.advance;
    await post(await login('rekha'), `/api/advances/${a.id}/approve`);
    return { clerk, id: a.id as number, advanceNo: a.advanceNo as string };
  }

  it('sets bills off never above the advance or the bill and never twice; recovers the rest; closes', async () => {
    const { clerk, id } = await paidAdvance();
    const over = await post(clerk, `/api/advances/${id}/set-off`, { billNo: 'B-1', billTotal: 30000, amount: 25000 });
    expect(over.body.error).toMatch(/Never above the advance: only ₹20,000/);
    const aboveBill = await post(clerk, `/api/advances/${id}/set-off`, { billNo: 'B-1', billTotal: 5000, amount: 6000 });
    expect(aboveBill.body.error).toMatch(/Never above the bill/);

    const b1 = await post(clerk, `/api/advances/${id}/set-off`, { billNo: 'B-1', billTotal: 12500, amount: 12500 });
    expect(b1.body.advance.figures).toMatchObject({ setOff: 12500, outstanding: 7500, toRecover: 0 });
    const twice = await post(clerk, `/api/advances/${id}/set-off`, { billNo: 'b-1', billTotal: 12500, amount: 100 });
    expect(twice.body.error).toMatch(/already set against this advance/);
    await post(clerk, `/api/advances/${id}/set-off`, { billNo: 'B-2', billTotal: 5000, amount: 5000 });

    // All the bills are in: the ₹2,500 left is to recover, and it blocks Kiran's next advance.
    const final = await post(clerk, `/api/advances/${id}/bills-final`);
    expect(final.body.advance).toMatchObject({ state: 'to_recover' });
    expect(final.body.advance.figures).toMatchObject({ settled: 17500, outstanding: 2500, toRecover: 2500 });
    const blocked = await post(clerk, '/api/advances', employeeAdvance({ amount: 1000 }));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/₹2,500 to recover/);

    const tooMuch = await post(clerk, `/api/advances/${id}/return`, { amount: 3000, form: 'Cash' });
    expect(tooMuch.body.error).toMatch(/Only ₹2,500/);
    const back = await post(clerk, `/api/advances/${id}/return`, { amount: 2500, form: 'Cash', reference: 'RCPT-77' });
    expect(back.body.advance).toMatchObject({ state: 'closed', closedOn: today() });
    expect(back.body.advance.figures).toMatchObject({ given: 20000, setOff: 17500, returned: 2500, settled: 20000, outstanding: 0, toRecover: 0 });

    // The books: the On Account voucher shows Cleared; the returned cash is a receipt in the cash book.
    const oa = await db('vouchers').where({ id: back.body.advance.voucherId }).first();
    expect(oa.reversal_date).toBe(today());
    const receiptId = back.body.advance.settlements.find((s: { kind: string }) => s.kind === 'returned').receiptVoucherId;
    expect(await db('vouchers').where({ id: receiptId }).first()).toMatchObject({ type: 'credit', amount: 2500, received_from: 'Kiran', mode: 'Cash' });

    // Now Kiran can take a new advance.
    expect((await post(clerk, '/api/advances', employeeAdvance({ amount: 1000 }))).status).toBe(201);
    const types = (await outbox()).map((e) => e.event_type);
    expect(types.slice(-1)).toEqual(['advance.planned']);
    expect(types).toContain('advance.closed');
  });

  it('one bill cannot be set off across advances for more than its total', async () => {
    const first = await paidAdvance({ amount: 5000 });
    await post(first.clerk, `/api/advances/${first.id}/set-off`, { billNo: 'INV-9', billTotal: 8000, amount: 5000 });
    const second = await paidAdvance({ amount: 5000 });
    const res = await post(second.clerk, `/api/advances/${second.id}/set-off`, { billNo: 'INV-9', billTotal: 8000, amount: 4000 });
    expect(res.body.error).toMatch(/only ₹3,000 of bill INV-9/);
  });

  it('past the settle-by date the money still out is to recover, and MRF is told once', async () => {
    const { id } = await paidAdvance({ settleBy: addDays(today(), -1) });
    const detail = await (await login('clerk')).get(`/api/advances/${id}`);
    expect(detail.body.advance).toMatchObject({ state: 'to_recover' });
    expect(detail.body.advance.figures).toMatchObject({ overdue: true, toRecover: 20000 });
    expect(await sweepOverdue()).toBe(1);
    expect(await sweepOverdue()).toBe(0);
    const last = (await outbox()).pop();
    expect(last).toMatchObject({ event_type: 'advance.changed' });
    expect(last.payload).toMatchObject({ reason: expect.stringMatching(/settle-by/), advance: { toRecover: 20000, state: 'to_recover' } });
  });

  it('a paid advance is not deleted or edited through the voucher, and On Account is not made from the voucher form', async () => {
    const { clerk, id } = await paidAdvance();
    const a = (await clerk.get(`/api/advances/${id}`)).body.advance;
    const admin = await login('superadmin');
    const del = await admin.delete(`/api/vouchers/${a.voucherId}`).set('Origin', ORIGIN);
    expect(del.status).toBe(400);
    expect(del.body.error).toMatch(/settled \(set off or returned\), not deleted/);
    const v = (await admin.get('/api/vouchers').query({ college: 'smgg' })).body.vouchers[0];
    const body = { ...v, college: 'smgg' };
    expect((await admin.put(`/api/vouchers/${v.id}`).set('Origin', ORIGIN).send({ ...body, amount: 1 })).status).toBe(400);
    expect((await admin.put(`/api/vouchers/${v.id}`).set('Origin', ORIGIN).send({ ...body, towards: 'Cables for lab 2' })).status).toBe(200);
    const direct = await admin.post('/api/vouchers').set('Origin', ORIGIN).send(voucher({ type: 'onaccount', recipientPhone: '9876543210' }));
    expect(direct.status).toBe(400);
    expect(direct.body.error).toMatch(/On Account → New advance/);
  });
});

describe('MRF link (hand-offs X2, X3, X4, X12, X13)', () => {
  it('needs the module credential', async () => {
    expect((await request(app).get('/api/mrf/v1/events')).status).toBe(401);
    expect((await request(app).get('/api/mrf/v1/events').set('x-module-credential', 'wrong')).status).toBe(401);
  });

  it('takes the On Account plan from clearance, once, and MRF reads the four figures back', async () => {
    const plan = {
      college: 'smgg',
      case: 'MRF-0150',
      po: 'PO-0052',
      clearanceRef: 'CLR-0150',
      payee: { kind: 'vendor', name: 'Sai Electronics', vendorCode: 'V-SAI', gst: '36ABCDE1234F1Z5' },
      amount: 50000,
      plannedForm: 'NEFT',
      settleBy: addDays(today(), 20),
      recoveredBy: 'Kiran',
      purpose: 'Network switches',
    };
    const first = await mrf().send('advance.requested', plan, 'evt-1');
    expect(first.status).toBe(201);
    const again = await mrf().send('advance.requested', plan, 'evt-1');
    expect(again.body).toMatchObject({ duplicate: true, result: { advanceNo: first.body.result.advanceNo } });
    expect(await db('advances').count<{ c: string }[]>({ c: '*' }).first()).toMatchObject({ c: 1 });

    const anitha = await login('anitha');
    const id = (await db('advances').first()).id;
    const tooMuch = await post(anitha, `/api/advances/${id}/prepare`, { form: 'NEFT', reference: 'UTR-1', amount: 60000 });
    expect(tooMuch.body.error).toMatch(/more than the ₹50,000 cleared/);
    await post(anitha, `/api/advances/${id}/prepare`, { form: 'NEFT', reference: 'UTR-1' });
    await post(await login('rekha'), `/api/advances/${id}/approve`);

    const read = await mrf().get('/advances?case=MRF-0150');
    expect(read.body.advances).toHaveLength(1);
    expect(read.body.advances[0]).toMatchObject({ po: 'PO-0052', given: 50000, settled: 0, toRecover: 0, dueDate: plan.settleBy, state: 'with_payee', blocksClosure: true });

    const status = await mrf().get('/cases/MRF-0150/financial-status');
    expect(status.body).toMatchObject({ advancesClosed: false, open: [{ outstanding: 50000, why: '₹50000 still with the payee' }] });

    const feed = await mrf().get('/events?after=0');
    expect(feed.body.events.map((e: { type: string }) => e.type)).toEqual(['advance.paid']);
    expect(feed.body.events[0].data.advance).toMatchObject({ case: 'MRF-0150', given: 50000 });
    expect((await mrf().get(`/events?after=${feed.body.next}`)).body.events).toEqual([]);

    await post(anitha, `/api/advances/${id}/set-off`, { billNo: 'INV-778', billTotal: 584100, amount: 50000 });
    const closed = await mrf().get('/cases/MRF-0150/financial-status');
    expect(closed.body).toMatchObject({ advancesClosed: true, open: [] });
  });

  it('a cancelled order: a plan is cancelled; a paid advance is to recover (F7)', async () => {
    const base = { college: 'smgg', case: 'MRF-0160', payee: { kind: 'vendor', name: 'Vision Traders', vendorCode: 'V-VIS' }, amount: 8000, settleBy: addDays(today(), 10) };
    await mrf().send('advance.requested', { ...base, po: 'PO-0070' });
    await mrf().send('advance.requested', { ...base, po: 'PO-0071', payee: { kind: 'vendor', name: 'Beta Supplies', vendorCode: 'V-BETA' } });
    const [a70] = await db('advances').where({ po_no: 'PO-0070' });
    const anitha = await login('anitha');
    await post(anitha, `/api/advances/${a70.id}/prepare`, { form: 'NEFT', reference: 'UTR-70' });
    await post(await login('rekha'), `/api/advances/${a70.id}/approve`);

    const c70 = await mrf().send('order.cancelled', { po: 'PO-0070' });
    expect(c70.body.result).toEqual({ cancelled: [], toRecover: [a70.advance_no] });
    expect((await anitha.get(`/api/advances/${a70.id}`)).body.advance).toMatchObject({ state: 'to_recover', billsFinal: true });
    const c71 = await mrf().send('order.cancelled', { po: 'PO-0071' });
    expect(c71.body.result.cancelled).toHaveLength(1);
  });

  it('links a PO issued after the plan (X3)', async () => {
    await mrf().send('advance.requested', { college: 'smgg', case: 'MRF-0170', payee: { kind: 'vendor', name: 'Gamma Systems', vendorCode: 'V-GAM' }, amount: 2000, settleBy: addDays(today(), 5) });
    const issued = await mrf().send('order.issued', { case: 'MRF-0170', po: 'PO-0153', vendorCode: 'V-GAM' });
    expect(issued.body.result.linked).toHaveLength(1);
    expect((await db('advances').first()).po_no).toBe('PO-0153');
  });

  it('no advance to a blacklisted vendor until the mark is lifted (X13)', async () => {
    const mark = await mrf().send('vendor.marked', {
      vendor: { code: 'V-ORB', name: 'Orbit Furniture' },
      mark: 'blacklisted',
      reason: 'Refused to replace or refund',
      approvedBy: 'Prakash',
    });
    expect(mark.status).toBe(201);
    const clerk = await login('clerk');
    const vendorAdvance = { college: 'smgg', payeeKind: 'vendor', payeeName: 'Orbit Furniture', vendorCode: 'V-ORB', amount: 5000, settleBy: addDays(today(), 7) };
    const refused = await post(clerk, '/api/advances', vendorAdvance);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/blacklisted \(Refused to replace or refund\)/);
    // By name too, when the code is not known in Accounts.
    expect((await post(clerk, '/api/advances', { ...vendorAdvance, vendorCode: '' })).status).toBe(409);
    // A suspension limited to another college does not stop this one.
    await mrf().send('vendor.marked', { vendor: { code: 'V-ORB', name: 'Orbit Furniture' }, mark: 'suspended', scopeColleges: ['smhyd'], until: addDays(today(), 30) });
    expect((await post(clerk, '/api/advances', vendorAdvance)).status).toBe(201);
    await mrf().send('vendor.marked', { vendor: { code: 'V-ORB', name: 'Orbit Furniture' }, mark: 'lifted' });
    expect(await db('vendor_marks').whereNull('lifted_at').count<{ c: string }[]>({ c: '*' }).first()).toMatchObject({ c: 0 });
  });

  it('a failed event can be sent again once fixed', async () => {
    const bad = await mrf().send('advance.requested', { college: 'nope', case: 'X', payee: { kind: 'employee', name: 'A', phone: '9876543210' }, amount: 10 }, 'evt-bad');
    expect(bad.status).toBe(400);
    const good = await mrf().send('advance.requested', { college: 'smgg', case: 'X', payee: { kind: 'employee', name: 'A', phone: '9876543210' }, amount: 10 }, 'evt-bad');
    expect(good.status).toBe(201);
  });
});

describe('On Account vouchers from before advances', () => {
  it('become advances: pending ones with the payee, cleared ones closed', async () => {
    const base = { college: 'smgg', type: 'onaccount', head: 'On Account', towards: 'Exam stationery', created_by: 'clerk', paid_to: 'Ravi', recipient_phone: '9000000001' };
    await db('vouchers').insert([
      { ...base, date: '2026-10-01', amount: 3000, voucher_no: 'SMGG-OA-2026-00001' },
      { ...base, date: '2026-10-02', amount: 4000, voucher_no: 'SMGG-OA-2026-00002', reversal_date: '2026-10-09' },
    ]);
    expect(await backfillLegacyAdvances()).toBe(2);
    expect(await backfillLegacyAdvances()).toBe(0);
    const clerk = await login('clerk');
    const list = (await clerk.get('/api/advances').query({ college: 'smgg' })).body;
    const byAmount = Object.fromEntries(list.advances.map((a: { amount: number }) => [a.amount, a]));
    expect(byAmount[3000]).toMatchObject({ state: 'with_payee', source: 'legacy', settleBy: null });
    expect(byAmount[4000]).toMatchObject({ state: 'closed', closedOn: '2026-10-09' });
    expect(list.summary).toMatchObject({ given: 7000, settled: 4000, outstanding: 3000, toRecover: 0 });
  });
});
