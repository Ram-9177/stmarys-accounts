/**
 * On Account: money first, goods later, then settle.
 * Finance flow F2 and MRF flow B4 on the UOS flow maps, built on Accounts' own
 * On Account vouchers.
 *
 *  planned ──prepare──▶ prepared ──second person approves──▶ paid ──▶ settled (closed)
 *     │                    │  ▲                                 │
 *     └──────cancel────────┘  └──returned for changes           ├─ set against bills
 *                                                               ├─ unspent money returned (a receipt voucher)
 *                                                               └─ past the settle-by date, or all bills in: "to recover"
 *
 * Paying writes the On Account voucher (cash book, voucher list, print) and
 * tells MRF (hand-off X4). Every change after that tells MRF the four figures
 * it reads: given, settled, to recover and the due date.
 */
import type { Knex } from 'knex';
import { config } from '../config.js';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { advanceNumber, voucherNumber } from '../lib/numbers.js';
import { allowedCollege, displayUsername, hasPerm, isSuperAdmin, isVoucherAdmin, type PermUser } from '../lib/permissions.js';
import { clean, isoFromAny, isValidIsoDate, norm, normalizeCollegeCode } from '../lib/text.js';
import { amountInWords } from './words.js';

// ---------------------------------------------------------------- types

export const FORMS = ['Cash', 'Cheque', 'DD', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'Card'] as const;
export type Form = (typeof FORMS)[number];
const BANK_TRANSFER = new Set<string>(['NEFT', 'RTGS', 'IMPS', 'UPI']);

export type PayeeKind = 'vendor' | 'employee';
export type Status = 'planned' | 'prepared' | 'paid' | 'cancelled';
/** What the register and MRF show: the status before payment, then how far it is settled. */
export type State = 'planned' | 'prepared' | 'cancelled' | 'with_payee' | 'to_recover' | 'closed';

export interface AdvanceRow {
  id: number;
  advance_no: string | null;
  college: string;
  status: Status;
  payee_kind: PayeeKind;
  payee_name: string;
  payee_phone: string;
  vendor_id: string;
  vendor_code: string;
  vendor_gst: string;
  employee_ref: string;
  amount: number;
  planned_form: string;
  form: string;
  reference: string;
  bank: string;
  received_by: string;
  settle_by: string | null;
  recovered_by: string;
  purpose: string;
  head: string;
  block: string;
  case_no: string;
  po_no: string;
  clearance_ref: string;
  source: 'accounts' | 'mrf' | 'legacy';
  source_event_id: string | null;
  bills_final: boolean;
  bills_final_at: Date | null;
  bills_final_by: string | null;
  planned_by: string | null;
  planned_at: Date | null;
  prepared_by: string | null;
  prepared_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  paid_date: string | null;
  return_reason: string;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  cancel_reason: string;
  voucher_id: number | null;
  closed_on: string | null;
  overdue_notified_at: Date | null;
  remarks: string;
  created_at: Date;
  updated_at: Date;
}

export interface SettlementRow {
  id: number;
  advance_id: number;
  kind: 'bill' | 'returned' | 'legacy_clear';
  bill_no: string;
  bill_date: string | null;
  bill_total: number | null;
  bill_key: string;
  amount: number;
  date: string;
  form: string;
  reference: string;
  receipt_voucher_id: number | null;
  notes: string;
  created_by: string;
  created_at: Date;
}

export interface Figures {
  /** Paid out (0 until the advance is paid). */
  given: number;
  /** Set against bills (including advances cleared before settlements were tracked). */
  setOff: number;
  /** Unspent money returned or refunded. */
  returned: number;
  /** setOff + returned. */
  settled: number;
  /** given - settled: still with the payee. */
  outstanding: number;
  /** The part of `outstanding` that is now owed back: past the settle-by date, or all bills are in. */
  toRecover: number;
  overdue: boolean;
  dueDate: string | null;
  state: State;
}

/** Who the "system" is when MRF acts (inbound events). */
export const MRF_ACTOR = 'mrf';

// ---------------------------------------------------------------- small helpers

const ZONE = process.env.ADVANCE_TIMEZONE || 'Asia/Kolkata';
/** Today on the college's calendar (India), as YYYY-MM-DD, whatever the server's own time zone is. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const digits = (v: string) => v.replace(/\D+/g, '');
const rupees = (v: unknown) => Math.round(Number(v));
const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN').format(n);

function dateOrNull(v: unknown, label: string): string | null {
  const s = clean(v, 20);
  if (!s) return null;
  const iso = isoFromAny(s);
  if (!isValidIsoDate(iso)) throw badRequest(`${label}: not a valid date`);
  return iso;
}

function normalizeForm(v: unknown): Form | '' {
  const s = clean(v, 20);
  if (!s) return '';
  const hit = FORMS.find((f) => f.toLowerCase() === s.toLowerCase());
  if (!hit) throw badRequest(`Form of payment must be one of: ${FORMS.join(', ')}`);
  return hit;
}

/** The person or firm an advance goes to, the same across colleges (for "that person's next advance"). */
export function payeeKey(a: Pick<AdvanceRow, 'vendor_code' | 'vendor_id' | 'payee_name' | 'payee_phone' | 'payee_kind'>): string {
  if (a.vendor_code) return 'v:' + norm(a.vendor_code);
  if (a.vendor_id) return 'a:' + norm(a.vendor_id);
  return 'p:' + norm(a.payee_name) + '|' + digits(a.payee_phone).slice(-10);
}

export function figures(a: AdvanceRow, settlements: SettlementRow[], on = today()): Figures {
  const given = a.status === 'paid' ? Number(a.amount) : 0;
  let setOff = 0;
  let returned = 0;
  for (const s of settlements) {
    if (s.kind === 'returned') returned += Number(s.amount);
    else setOff += Number(s.amount);
  }
  const settled = setOff + returned;
  const outstanding = Math.max(0, given - settled);
  const overdue = a.status === 'paid' && outstanding > 0 && !!a.settle_by && on > a.settle_by;
  const toRecover = a.status === 'paid' && outstanding > 0 && (overdue || a.bills_final) ? outstanding : 0;
  const state: State =
    a.status !== 'paid' ? a.status : outstanding === 0 ? 'closed' : toRecover > 0 ? 'to_recover' : 'with_payee';
  return { given, setOff, returned, settled, outstanding, toRecover, overdue, dueDate: a.settle_by, state };
}

// ---------------------------------------------------------------- permissions

export function canManage(u: PermUser) {
  return isSuperAdmin(u) || hasPerm(u, 'manage_advances');
}
export function canApprove(u: PermUser) {
  return isSuperAdmin(u) || hasPerm(u, 'approve_advances');
}
/** Everyone who works with advances sees the register; others see the ones they planned or prepared. */
export function canSeeAll(u: PermUser) {
  return canManage(u) || canApprove(u) || isVoucherAdmin(u) || hasPerm(u, 'view_all_vouchers');
}
function isHead(u: PermUser) {
  return isSuperAdmin(u) || u.custom_role === 'head';
}

// ---------------------------------------------------------------- reading

async function settlementsFor(trx: Knex | Knex.Transaction, ids: number[]): Promise<Map<number, SettlementRow[]>> {
  const map = new Map<number, SettlementRow[]>();
  if (!ids.length) return map;
  const rows = await trx<SettlementRow>('advance_settlements').whereIn('advance_id', ids).orderBy(['date', 'id']);
  for (const r of rows) {
    const list = map.get(Number(r.advance_id)) ?? [];
    list.push(r);
    map.set(Number(r.advance_id), list);
  }
  return map;
}

async function lockAdvance(trx: Knex.Transaction, id: number): Promise<AdvanceRow> {
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid advance id');
  const row = await trx<AdvanceRow>('advances').where({ id }).forUpdate().first();
  if (!row) throw notFound('Advance not found');
  return row;
}

/** An active blacklist or suspension that matches this payee in this college, if any. */
export async function activeMark(
  trx: Knex | Knex.Transaction,
  payee: { vendor_code?: string; vendor_gst?: string; payee_name: string },
  college: string,
  on = today(),
): Promise<{ mark: string; reason: string; details: string; until_date: string | null; vendor_name: string } | undefined> {
  const code = clean(payee.vendor_code, 80);
  const gst = clean(payee.vendor_gst, 20).toUpperCase();
  const name = norm(payee.payee_name);
  return trx('vendor_marks')
    .whereNull('lifted_at')
    .andWhere((w) => w.whereNull('from_date').orWhere('from_date', '<=', on))
    .andWhere((w) => w.whereNull('until_date').orWhere('until_date', '>=', on))
    .andWhereRaw('(cardinality(scope_colleges) = 0 OR ? = ANY(scope_colleges))', [college])
    .andWhere((w) => {
      if (code) w.orWhereRaw('lower(vendor_code) = lower(?)', [code]);
      if (gst) w.orWhereRaw('upper(vendor_gst) = ?', [gst]);
      if (name) w.orWhereRaw('lower(vendor_name) = ?', [name]);
      if (!code && !gst && !name) w.whereRaw('false');
    })
    .orderBy('created_at', 'desc')
    .first();
}

/** Paid advances of the same payee that now have money to recover (blocks their next advance). */
export async function toRecoverFor(trx: Knex | Knex.Transaction, key: string, excludeId?: number) {
  const candidates: AdvanceRow[] = await trx<AdvanceRow>('advances')
    .where({ status: 'paid' })
    .modify((q) => {
      if (excludeId) q.whereNot({ id: excludeId });
      if (key.startsWith('v:')) q.whereRaw('lower(vendor_code) = ?', [key.slice(2)]);
      else if (key.startsWith('a:')) q.whereRaw('lower(vendor_id) = ?', [key.slice(2)]);
      else q.whereRaw('lower(payee_name) = ?', [key.slice(2).split('|')[0]]);
    });
  const exact = candidates.filter((a) => payeeKey(a) === key);
  const sets = await settlementsFor(trx, exact.map((a) => Number(a.id)));
  return exact
    .map((a) => ({ advance: a, f: figures(a, sets.get(Number(a.id)) ?? []) }))
    .filter((x) => x.f.toRecover > 0);
}

// ---------------------------------------------------------------- DTOs and the outbox

export function advanceDto(a: AdvanceRow, settlements: SettlementRow[], on = today()) {
  const f = figures(a, settlements, on);
  return {
    id: Number(a.id),
    advanceNo: a.advance_no ?? '',
    college: normalizeCollegeCode(a.college),
    status: a.status,
    state: f.state,
    payee: {
      kind: a.payee_kind,
      name: a.payee_name,
      phone: a.payee_phone,
      vendorId: a.vendor_id,
      vendorCode: a.vendor_code,
      vendorGst: a.vendor_gst,
      employeeRef: a.employee_ref,
    },
    amount: Number(a.amount),
    plannedForm: a.planned_form,
    payment: a.status === 'paid' || a.form
      ? { form: a.form, reference: a.reference, bank: a.bank, receivedBy: a.received_by, datePaid: a.paid_date }
      : null,
    settleBy: a.settle_by,
    recoveredBy: a.recovered_by,
    purpose: a.purpose,
    head: a.head,
    block: a.block,
    caseNo: a.case_no,
    poNo: a.po_no,
    clearanceRef: a.clearance_ref,
    source: a.source,
    billsFinal: a.bills_final,
    voucherId: a.voucher_id ? Number(a.voucher_id) : null,
    closedOn: a.closed_on,
    returnReason: a.return_reason,
    cancelReason: a.cancel_reason,
    remarks: a.remarks,
    plannedBy: a.planned_by ?? '',
    plannedAt: a.planned_at,
    preparedBy: a.prepared_by ?? '',
    preparedAt: a.prepared_at,
    approvedBy: a.approved_by ?? '',
    approvedAt: a.approved_at,
    figures: {
      given: f.given,
      setOff: f.setOff,
      returned: f.returned,
      settled: f.settled,
      outstanding: f.outstanding,
      toRecover: f.toRecover,
      overdue: f.overdue,
      dueDate: f.dueDate,
    },
    settlements: settlements.map((s) => ({
      id: Number(s.id),
      kind: s.kind,
      billNo: s.bill_no,
      billDate: s.bill_date,
      billTotal: s.bill_total === null ? null : Number(s.bill_total),
      amount: Number(s.amount),
      date: s.date,
      form: s.form,
      reference: s.reference,
      receiptVoucherId: s.receipt_voucher_id ? Number(s.receipt_voucher_id) : null,
      notes: s.notes,
      createdBy: displayUsername(s.created_by),
      createdAt: s.created_at,
    })),
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}
export type AdvanceDto = ReturnType<typeof advanceDto>;

/** The shape MRF reads (events and the read API): the plan, the payment and the four figures. */
export function mrfView(a: AdvanceRow, settlements: SettlementRow[], on = today()) {
  const f = figures(a, settlements, on);
  return {
    advanceNo: a.advance_no ?? '',
    college: normalizeCollegeCode(a.college),
    case: a.case_no || null,
    po: a.po_no || null,
    clearance: a.clearance_ref || null,
    payee: { kind: a.payee_kind, name: a.payee_name, vendorCode: a.vendor_code || null },
    amount: Number(a.amount),
    plannedForm: a.planned_form || null,
    recoveredBy: a.recovered_by || null,
    state: f.state,
    // The four figures MRF reads (B4, F2).
    given: f.given,
    settled: f.settled,
    toRecover: f.toRecover,
    dueDate: f.dueDate,
    outstanding: f.outstanding,
    setOff: f.setOff,
    returned: f.returned,
    overdue: f.overdue,
    billsFinal: a.bills_final,
    payment:
      a.status === 'paid'
        ? { form: a.form, reference: a.reference, datePaid: a.paid_date, approvedBy: displayUsername(a.approved_by ?? '') }
        : null,
    blocksClosure: a.status === 'paid' && f.outstanding > 0,
  };
}
export type MrfAdvanceView = ReturnType<typeof mrfView>;

export type OutboxEvent = 'advance.planned' | 'advance.paid' | 'advance.changed' | 'advance.closed' | 'advance.cancelled';

async function tellMrf(trx: Knex.Transaction, type: OutboxEvent, a: AdvanceRow, reason: string) {
  const sets = (await settlementsFor(trx, [Number(a.id)])).get(Number(a.id)) ?? [];
  await trx('mrf_outbox').insert({
    event_type: type,
    advance_no: a.advance_no ?? '',
    case_no: a.case_no,
    payload: JSON.stringify({ reason, advance: mrfView(a, sets) }),
  });
}

async function log(trx: Knex.Transaction, id: number, actor: string, action: string, details: Record<string, unknown> = {}) {
  await trx('advance_log').insert({ advance_id: id, actor, action, details: JSON.stringify(details) });
}

// ---------------------------------------------------------------- rules shared by several acts

function assertFormLimit(form: string, amount: number) {
  const limit =
    form === 'Cash' ? config.ADVANCE_CASH_LIMIT : form === 'UPI' ? config.ADVANCE_UPI_LIMIT : form === 'Card' ? config.ADVANCE_CARD_LIMIT : null;
  if (limit !== null && amount > limit) {
    throw badRequest(`${form} can pay at most ${inr(limit)} at a time. Choose another form of payment.`);
  }
}

/** Form and reference, as F4 requires for every payment ("no form or reference: not saved"). */
function paymentDetails(input: { form?: unknown; reference?: unknown; bank?: unknown; receivedBy?: unknown }) {
  const form = normalizeForm(input.form);
  if (!form) throw badRequest('Choose the form of payment.');
  const reference = clean(input.reference, 120);
  const bank = clean(input.bank, 120);
  const receivedBy = clean(input.receivedBy, 120);
  if (form === 'Cash' && !receivedBy) throw badRequest('Cash: enter who receives the money.');
  if ((form === 'Cheque' || form === 'DD') && (!reference || !bank)) throw badRequest(`${form}: enter its number and the bank.`);
  if ((BANK_TRANSFER.has(form) || form === 'Card') && !reference) throw badRequest(`${form}: enter the reference (UTR or transaction number).`);
  return { form, reference, bank, receivedBy };
}

async function assertMayAdvance(trx: Knex.Transaction, a: Pick<AdvanceRow, 'id' | 'vendor_code' | 'vendor_gst' | 'vendor_id' | 'payee_name' | 'payee_phone' | 'payee_kind' | 'college'>) {
  const mark = await activeMark(trx, a, a.college);
  if (mark) {
    const label = mark.mark === 'blacklisted' ? 'blacklisted' : `suspended${mark.until_date ? ' till ' + mark.until_date : ''}`;
    throw new HttpError(409, `No advance to ${a.payee_name}: the vendor is ${label}${mark.reason ? ` (${mark.reason})` : ''}.`, { mark: mark.mark });
  }
  const open = await toRecoverFor(trx, payeeKey(a), a.id ? Number(a.id) : undefined);
  if (open.length) {
    const first = open[0];
    throw new HttpError(
      409,
      `${a.payee_name} has ${inr(first.f.toRecover)} to recover on ${first.advance.advance_no}. Recover it before a new advance.`,
      { toRecover: first.f.toRecover, advanceNo: first.advance.advance_no },
    );
  }
}

/** Paying writes the On Account voucher: the cash book, the voucher list and the printed voucher all come from it. */
async function writeAdvanceVoucher(trx: Knex.Transaction, a: AdvanceRow, paidDate: string, approver: string): Promise<number> {
  const refs = [a.case_no && `Case ${a.case_no}`, a.po_no && `PO ${a.po_no}`].filter(Boolean).join(' · ');
  const [ins] = await trx('vouchers')
    .insert({
      college: a.college,
      type: 'onaccount',
      date: paidDate,
      head: a.head || 'On Account',
      ac_name: '',
      received_from: '',
      paid_to: a.payee_name,
      vendor_id: '',
      recipient_phone: a.payee_phone,
      reversal_date: null,
      towards: clean([a.purpose || 'Advance', refs].filter(Boolean).join(' · '), 500),
      block: a.block,
      amount: a.amount,
      amt_words: amountInWords(Number(a.amount)),
      mode: a.form,
      cheque: a.reference,
      prep_by: displayUsername(a.prepared_by ?? ''),
      checked_by: displayUsername(approver),
      remarks: clean(`Advance ${a.advance_no}${a.recovered_by ? ` · recovers: ${a.recovered_by}` : ''}`, 500),
      created_by: a.prepared_by ?? approver,
      updated_by: approver,
    })
    .returning<{ id: number }[]>('id');
  await trx('vouchers').where({ id: ins.id }).update({ voucher_no: voucherNumber(a.college, 'onaccount', ins.id) });
  return Number(ins.id);
}

/** When nothing is outstanding any more: the advance closes and its voucher shows Cleared on that date. */
async function closeIfSettled(trx: Knex.Transaction, a: AdvanceRow, on: string, actor: string): Promise<boolean> {
  const sets = (await settlementsFor(trx, [Number(a.id)])).get(Number(a.id)) ?? [];
  const f = figures(a, sets, on);
  if (f.outstanding > 0 || a.closed_on) return false;
  await trx('advances').where({ id: a.id }).update({ closed_on: on, updated_at: new Date() });
  if (a.voucher_id) await trx('vouchers').where({ id: a.voucher_id }).update({ reversal_date: on, updated_by: actor, updated_at: new Date() });
  return true;
}

// ---------------------------------------------------------------- acts

export interface PlanInput {
  college?: unknown;
  payeeKind?: unknown;
  payeeName?: unknown;
  payeePhone?: unknown;
  vendorId?: unknown;
  vendorCode?: unknown;
  vendorGst?: unknown;
  employeeRef?: unknown;
  amount?: unknown;
  plannedForm?: unknown;
  settleBy?: unknown;
  recoveredBy?: unknown;
  purpose?: unknown;
  head?: unknown;
  block?: unknown;
  caseNo?: unknown;
  poNo?: unknown;
  clearanceRef?: unknown;
  remarks?: unknown;
  /** Prepare straight away with these payment details. */
  form?: unknown;
  reference?: unknown;
  bank?: unknown;
  receivedBy?: unknown;
}

function readPlan(input: PlanInput, college: string) {
  const kind = clean(input.payeeKind, 20) as PayeeKind;
  if (kind !== 'vendor' && kind !== 'employee') throw badRequest('Choose who the advance is for: a vendor or an employee.');
  const payeeName = clean(input.payeeName, 200);
  if (!payeeName) throw badRequest(kind === 'vendor' ? 'Enter the vendor.' : 'Enter the employee.');
  const payeePhone = clean(input.payeePhone, 30);
  if (kind === 'employee' && digits(payeePhone).length < 10) throw badRequest("Enter the employee's phone number (10 digits).");
  const amount = rupees(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000_000) throw badRequest('Enter the amount of the advance.');
  const plannedForm = normalizeForm(input.plannedForm);
  let settleBy = dateOrNull(input.settleBy, 'Settle by');
  if (!settleBy && kind === 'employee') settleBy = addDays(today(), config.ADVANCE_EMPLOYEE_DAYS);
  if (!settleBy) throw badRequest('Enter the date the advance must be settled by.');
  return {
    college,
    payee_kind: kind,
    payee_name: payeeName,
    payee_phone: payeePhone,
    vendor_id: clean(input.vendorId, 50),
    vendor_code: clean(input.vendorCode, 80),
    vendor_gst: clean(input.vendorGst, 20).toUpperCase(),
    employee_ref: clean(input.employeeRef, 80),
    amount,
    planned_form: plannedForm,
    settle_by: settleBy,
    recovered_by: clean(input.recoveredBy, 120),
    purpose: clean(input.purpose, 400),
    head: clean(input.head, 250) || 'On Account',
    block: clean(input.block, 250),
    case_no: clean(input.caseNo, 80),
    po_no: clean(input.poNo, 80),
    clearance_ref: clean(input.clearanceRef, 80),
    remarks: clean(input.remarks, 500),
  };
}

/**
 * Plans an advance (F1/F2: "at clearance fixes the payee, the amount, the form,
 * the date to settle by and who recovers"). With payment details it is prepared
 * at once; with approval off it is paid at once.
 */
export async function planAdvance(
  actor: PermUser,
  input: PlanInput,
  ip: string,
  origin: { source?: 'accounts' | 'mrf'; eventId?: string; college?: string } = {},
): Promise<AdvanceDto> {
  const fromMrf = origin.source === 'mrf';
  if (!fromMrf && !canManage(actor)) throw forbidden('Access denied. Missing manage_advances permission.');
  const college = fromMrf ? normalizeCollegeCode(origin.college) : allowedCollege(actor, input.college);
  const plan = readPlan(input, college);
  const wantsPrepare = !fromMrf && clean(input.form, 20) !== '';
  const pay = wantsPrepare ? paymentDetails(input) : null;
  if (pay) assertFormLimit(pay.form, plan.amount);
  else if (plan.planned_form) assertFormLimit(plan.planned_form, plan.amount);

  const id = await db.transaction(async (trx) => {
    await assertMayAdvance(trx, { id: 0, ...plan });
    const now = new Date();
    const [row] = await trx('advances')
      .insert({
        ...plan,
        status: pay ? 'prepared' : 'planned',
        source: fromMrf ? 'mrf' : 'accounts',
        source_event_id: origin.eventId ?? null,
        planned_by: actor.username,
        planned_at: now,
        ...(pay
          ? { form: pay.form, reference: pay.reference, bank: pay.bank, received_by: pay.receivedBy, prepared_by: actor.username, prepared_at: now }
          : {}),
      })
      .returning<{ id: number }[]>('id');
    const advanceNo = advanceNumber(college, row.id);
    await trx('advances').where({ id: row.id }).update({ advance_no: advanceNo });
    await log(trx, row.id, actor.username, 'planned', { amount: plan.amount, payee: plan.payee_name, source: fromMrf ? 'mrf' : 'accounts' });
    if (pay) await log(trx, row.id, actor.username, 'prepared', { form: pay.form, reference: pay.reference });
    await audit(actor.username, 'plan_advance', 'advance', advanceNo, { amount: plan.amount, payee: plan.payee_name, case: plan.case_no }, ip, trx);
    const fresh = await trx<AdvanceRow>('advances').where({ id: row.id }).first();
    if (!fromMrf) await tellMrf(trx, 'advance.planned', fresh!, 'planned in Accounts');
    return Number(row.id);
  });
  if (pay && config.ADVANCE_APPROVAL === 'off') return approveAdvance(actor, id, {}, ip);
  return getAdvance(actor, id);
}

/** F4: the Finance Officer confirms the form of payment and fills its reference. */
export async function prepareAdvance(actor: PermUser, id: number, input: { form?: unknown; reference?: unknown; bank?: unknown; receivedBy?: unknown; amount?: unknown; settleBy?: unknown }, ip: string): Promise<AdvanceDto> {
  if (!canManage(actor)) throw forbidden('Access denied. Missing manage_advances permission.');
  const pay = paymentDetails(input);
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    allowedCollege(actor, a.college);
    if (a.status !== 'planned') throw badRequest(`This advance is ${a.status}; only a planned advance can be prepared.`);
    const amount = input.amount === undefined || input.amount === '' ? Number(a.amount) : rupees(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter the amount of the advance.');
    if (a.source === 'mrf' && amount > Number(a.amount)) {
      throw badRequest(`The advance cannot be more than the ${inr(Number(a.amount))} cleared for it.`);
    }
    assertFormLimit(pay.form, amount);
    const settleBy = dateOrNull(input.settleBy, 'Settle by') ?? a.settle_by;
    await assertMayAdvance(trx, a);
    await trx('advances').where({ id }).update({
      status: 'prepared',
      amount,
      settle_by: settleBy,
      form: pay.form,
      reference: pay.reference,
      bank: pay.bank,
      received_by: pay.receivedBy,
      prepared_by: actor.username,
      prepared_at: new Date(),
      return_reason: '',
      updated_at: new Date(),
    });
    const why = a.planned_form && a.planned_form !== pay.form ? `planned ${a.planned_form}` : undefined;
    await log(trx, id, actor.username, 'prepared', { form: pay.form, reference: pay.reference, amount, ...(why ? { changedForm: why } : {}) });
    await audit(actor.username, 'prepare_advance', 'advance', a.advance_no ?? String(id), { form: pay.form, amount }, ip, trx);
  });
  if (config.ADVANCE_APPROVAL === 'off') return approveAdvance(actor, id, {}, ip);
  return getAdvance(actor, id);
}

/** F2/F4: a second person approves; the money goes; the On Account voucher is written; MRF is told (X4). */
export async function approveAdvance(actor: PermUser, id: number, input: { paidDate?: unknown }, ip: string): Promise<AdvanceDto> {
  const secondPerson = config.ADVANCE_APPROVAL === 'second_person';
  if (secondPerson ? !canApprove(actor) : !canManage(actor)) throw forbidden('Access denied. Missing approve_advances permission.');
  const paidDate = dateOrNull(input.paidDate, 'Paid on') ?? today();
  if (paidDate > today()) throw badRequest('The payment date cannot be in the future.');
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    allowedCollege(actor, a.college);
    if (a.status !== 'prepared') throw badRequest(`This advance is ${a.status}; only a prepared advance can be approved.`);
    if (secondPerson && a.prepared_by === actor.username) {
      throw forbidden('The person who prepared a payment cannot approve it. Ask another approver.');
    }
    if (secondPerson && Number(a.amount) > config.ADVANCE_HIGH_LIMIT && !isHead(actor)) {
      throw forbidden(`An advance above ${inr(config.ADVANCE_HIGH_LIMIT)} is approved by a main administrator or a Head.`);
    }
    assertFormLimit(a.form, Number(a.amount));
    await assertMayAdvance(trx, a);
    const voucherId = await writeAdvanceVoucher(trx, a, paidDate, actor.username);
    await trx('advances').where({ id }).update({
      status: 'paid',
      approved_by: actor.username,
      approved_at: new Date(),
      paid_date: paidDate,
      voucher_id: voucherId,
      updated_at: new Date(),
    });
    await log(trx, id, actor.username, 'paid', { form: a.form, reference: a.reference, voucherId });
    await audit(actor.username, 'approve_advance', 'advance', a.advance_no ?? String(id), { amount: Number(a.amount), form: a.form }, ip, trx);
    const fresh = (await trx<AdvanceRow>('advances').where({ id }).first())!;
    await tellMrf(trx, 'advance.paid', fresh, 'advance paid (X4)');
  });
  return getAdvance(actor, id);
}

/** The approver sends it back to the one who prepared it, with a reason (C1: "returns it, with a reason"). */
export async function returnForChanges(actor: PermUser, id: number, reasonIn: unknown, ip: string): Promise<AdvanceDto> {
  if (!canApprove(actor)) throw forbidden('Access denied. Missing approve_advances permission.');
  const reason = clean(reasonIn, 400);
  if (!reason) throw badRequest('Give a reason.');
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    allowedCollege(actor, a.college);
    if (a.status !== 'prepared') throw badRequest('Only a prepared advance can be sent back.');
    await trx('advances').where({ id }).update({ status: 'planned', return_reason: reason, updated_at: new Date() });
    await log(trx, id, actor.username, 'returned_for_changes', { reason });
    await audit(actor.username, 'return_advance', 'advance', a.advance_no ?? String(id), reason, ip, trx);
  });
  return getAdvance(actor, id);
}

/** A plan that will not be paid. Once paid, an advance is settled instead (set off or returned). */
export async function cancelAdvance(actor: PermUser, id: number, reasonIn: unknown, ip: string, by = actor.username): Promise<AdvanceDto | null> {
  const fromMrf = by === MRF_ACTOR;
  if (!fromMrf && !canManage(actor)) throw forbidden('Access denied. Missing manage_advances permission.');
  const reason = clean(reasonIn, 400);
  if (!reason) throw badRequest('Give a reason.');
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    if (!fromMrf) allowedCollege(actor, a.college);
    if (a.status === 'paid') throw badRequest('This advance is paid. Set it against bills or record the money returned.');
    if (a.status === 'cancelled') return;
    await trx('advances').where({ id }).update({ status: 'cancelled', cancelled_by: by, cancelled_at: new Date(), cancel_reason: reason, updated_at: new Date() });
    await log(trx, id, by, 'cancelled', { reason });
    await audit(by, 'cancel_advance', 'advance', a.advance_no ?? String(id), reason, ip, trx);
    const fresh = (await trx<AdvanceRow>('advances').where({ id }).first())!;
    await tellMrf(trx, 'advance.cancelled', fresh, reason);
  });
  return fromMrf ? null : getAdvance(actor, id);
}

/**
 * F2: "sets the advance against the bill. Never above the advance or the bill,
 * never twice, the same vendor only."
 */
export async function setOffBill(
  actor: PermUser,
  id: number,
  input: { billNo?: unknown; billDate?: unknown; billTotal?: unknown; amount?: unknown; notes?: unknown; billVendorCode?: unknown },
  ip: string,
): Promise<AdvanceDto> {
  if (!canManage(actor)) throw forbidden('Access denied. Missing manage_advances permission.');
  const billNo = clean(input.billNo, 80);
  if (!billNo) throw badRequest('Enter the bill number.');
  const billDate = dateOrNull(input.billDate, 'Bill date');
  const billTotal = rupees(input.billTotal);
  if (!Number.isFinite(billTotal) || billTotal <= 0) throw badRequest('Enter the bill total.');
  const amount = rupees(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter the amount to set off.');
  const on = today();
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    allowedCollege(actor, a.college);
    if (a.status !== 'paid') throw badRequest('Only a paid advance can be set against a bill.');
    const billVendor = clean(input.billVendorCode, 80);
    if (a.payee_kind === 'vendor' && billVendor && a.vendor_code && norm(billVendor) !== norm(a.vendor_code)) {
      throw badRequest("This bill is another vendor's. An advance is set only against its own vendor's bills.");
    }
    const sets = (await settlementsFor(trx, [id])).get(id) ?? [];
    const f = figures(a, sets, on);
    if (f.outstanding === 0) throw badRequest('Nothing is left on this advance.');
    if (amount > f.outstanding) throw badRequest(`Never above the advance: only ${inr(f.outstanding)} is left on it.`);
    if (sets.some((s) => s.kind === 'bill' && norm(s.bill_no) === norm(billNo))) {
      throw badRequest(`Bill ${billNo} is already set against this advance.`);
    }
    const key = payeeKey(a);
    // One bill can be spread over several advances of the same payee: serialise the "never above the bill" check per bill.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`${key}|${norm(billNo)}`]);
    const used = await trx('advance_settlements')
      .where({ kind: 'bill', bill_key: key })
      .whereRaw('lower(bill_no) = lower(?)', [billNo])
      .sum<{ s: string | null }>({ s: 'amount' })
      .first();
    const left = billTotal - Number(used?.s ?? 0);
    if (amount > left) throw badRequest(`Never above the bill: only ${inr(Math.max(0, left))} of bill ${billNo} is left to set off.`);
    await trx('advance_settlements').insert({
      advance_id: id,
      kind: 'bill',
      bill_no: billNo,
      bill_date: billDate,
      bill_total: billTotal,
      bill_key: key,
      amount,
      date: on,
      notes: clean(input.notes, 400),
      created_by: actor.username,
    });
    await log(trx, id, actor.username, 'set_off', { billNo, billTotal, amount });
    await audit(actor.username, 'set_off_advance', 'advance', a.advance_no ?? String(id), { billNo, amount }, ip, trx);
    const closed = await closeIfSettled(trx, a, on, actor.username);
    if (closed) await log(trx, id, actor.username, 'closed', {});
    const fresh = (await trx<AdvanceRow>('advances').where({ id }).first())!;
    await tellMrf(trx, closed ? 'advance.closed' : 'advance.changed', fresh, `bill ${billNo} set off`);
  });
  return getAdvance(actor, id);
}

/** F2: "records the refund or the cash returned. The advance is closed." Writes a receipt voucher for the books. */
export async function recordReturn(
  actor: PermUser,
  id: number,
  input: { amount?: unknown; form?: unknown; reference?: unknown; date?: unknown; notes?: unknown },
  ip: string,
): Promise<AdvanceDto> {
  if (!canManage(actor)) throw forbidden('Access denied. Missing manage_advances permission.');
  const amount = rupees(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Enter the amount returned.');
  const form = normalizeForm(input.form) || 'Cash';
  const reference = clean(input.reference, 120);
  if (form !== 'Cash' && !reference) throw badRequest(`${form}: enter the reference.`);
  const date = dateOrNull(input.date, 'Returned on') ?? today();
  if (date > today()) throw badRequest('The date cannot be in the future.');
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    allowedCollege(actor, a.college);
    if (a.status !== 'paid') throw badRequest('Only a paid advance can have money returned.');
    const sets = (await settlementsFor(trx, [id])).get(id) ?? [];
    const f = figures(a, sets, date);
    if (f.outstanding === 0) throw badRequest('Nothing is left on this advance.');
    if (amount > f.outstanding) throw badRequest(`Only ${inr(f.outstanding)} is left on this advance.`);
    const [rv] = await trx('vouchers')
      .insert({
        college: a.college,
        type: 'credit',
        date,
        head: a.head || 'On Account',
        ac_name: '',
        received_from: a.payee_name,
        paid_to: '',
        vendor_id: '',
        recipient_phone: '',
        towards: clean(`Advance ${a.advance_no} returned${a.purpose ? ' · ' + a.purpose : ''}`, 500),
        block: a.block,
        amount,
        amt_words: amountInWords(amount),
        mode: form,
        cheque: reference,
        prep_by: displayUsername(actor.username),
        checked_by: '',
        remarks: clean(`Returned on advance ${a.advance_no}`, 500),
        created_by: actor.username,
        updated_by: actor.username,
      })
      .returning<{ id: number }[]>('id');
    await trx('vouchers').where({ id: rv.id }).update({ voucher_no: voucherNumber(a.college, 'credit', rv.id) });
    await trx('advance_settlements').insert({
      advance_id: id,
      kind: 'returned',
      amount,
      date,
      form,
      reference,
      receipt_voucher_id: rv.id,
      notes: clean(input.notes, 400),
      created_by: actor.username,
    });
    await log(trx, id, actor.username, 'returned', { amount, form, reference, receiptVoucherId: rv.id });
    await audit(actor.username, 'advance_returned', 'advance', a.advance_no ?? String(id), { amount, form }, ip, trx);
    const closed = await closeIfSettled(trx, a, date, actor.username);
    if (closed) await log(trx, id, actor.username, 'closed', {});
    const fresh = (await trx<AdvanceRow>('advances').where({ id }).first())!;
    await tellMrf(trx, closed ? 'advance.closed' : 'advance.changed', fresh, 'money returned');
  });
  return getAdvance(actor, id);
}

/**
 * All the bills are in (or the order was cancelled): whatever is left is to be
 * recovered now, without waiting for the settle-by date.
 */
export async function markBillsFinal(actor: PermUser, id: number, ip: string, by = actor.username, reason = 'all bills are in'): Promise<AdvanceDto | null> {
  const fromMrf = by === MRF_ACTOR;
  if (!fromMrf && !canManage(actor)) throw forbidden('Access denied. Missing manage_advances permission.');
  await db.transaction(async (trx) => {
    const a = await lockAdvance(trx, id);
    if (!fromMrf) allowedCollege(actor, a.college);
    if (a.status !== 'paid') throw badRequest('Only a paid advance can be marked “all bills in”.');
    if (a.bills_final) return;
    await trx('advances').where({ id }).update({ bills_final: true, bills_final_at: new Date(), bills_final_by: by, updated_at: new Date() });
    await log(trx, id, by, 'bills_final', { reason });
    await audit(by, 'advance_bills_final', 'advance', a.advance_no ?? String(id), reason, ip, trx);
    const fresh = (await trx<AdvanceRow>('advances').where({ id }).first())!;
    await tellMrf(trx, 'advance.changed', fresh, reason);
  });
  return fromMrf ? null : getAdvance(actor, id);
}

// ---------------------------------------------------------------- queries

export async function getAdvance(actor: PermUser, id: number) {
  const a = await db<AdvanceRow>('advances').where({ id }).first();
  if (!a) throw notFound('Advance not found');
  allowedCollege(actor, a.college);
  if (!canSeeAll(actor) && a.planned_by !== actor.username && a.prepared_by !== actor.username) {
    throw forbidden('Access denied.');
  }
  const sets = (await settlementsFor(db, [id])).get(id) ?? [];
  const track = await db('advance_log').where({ advance_id: id }).orderBy(['at', 'id']);
  const mark = a.payee_kind === 'vendor' && a.status !== 'paid' ? await activeMark(db, a, a.college) : undefined;
  return {
    ...advanceDto(a, sets),
    vendorMark: mark ? { mark: mark.mark, reason: mark.reason, details: mark.details, until: mark.until_date } : null,
    track: track.map((t) => ({
      at: t.at,
      actor: t.actor === MRF_ACTOR ? 'MRF' : displayUsername(t.actor),
      action: t.action,
      details: t.details,
    })),
    can: {
      prepare: canManage(actor) && a.status === 'planned',
      approve: canApprove(actor) && a.status === 'prepared' && (config.ADVANCE_APPROVAL === 'off' || a.prepared_by !== actor.username),
      sendBack: canApprove(actor) && a.status === 'prepared',
      cancel: canManage(actor) && (a.status === 'planned' || a.status === 'prepared'),
      settle: canManage(actor) && a.status === 'paid',
    },
  };
}

export async function listAdvances(actor: PermUser, query: { college?: unknown; state?: unknown; q?: unknown }) {
  const college = allowedCollege(actor, query.college);
  const rows: AdvanceRow[] = await db<AdvanceRow>('advances')
    .where({ college })
    .modify((q) => {
      if (!canSeeAll(actor)) q.andWhere((w) => w.where('planned_by', actor.username).orWhere('prepared_by', actor.username));
      const term = clean(query.q, 100).toLowerCase();
      if (term) {
        q.andWhere((w) =>
          w
            .whereRaw('lower(payee_name) like ?', [`%${term}%`])
            .orWhereRaw('lower(advance_no) like ?', [`%${term}%`])
            .orWhereRaw('lower(case_no) like ?', [`%${term}%`])
            .orWhereRaw('lower(po_no) like ?', [`%${term}%`])
            .orWhereRaw('lower(purpose) like ?', [`%${term}%`]),
        );
      }
    })
    .orderBy('id', 'desc')
    .limit(2000);
  const sets = await settlementsFor(db, rows.map((r) => Number(r.id)));
  const on = today();
  const all = rows.map((r) => advanceDto(r, sets.get(Number(r.id)) ?? [], on));
  const state = clean(query.state, 20);
  const list = state ? all.filter((a) => a.state === state || (state === 'open' && (a.state === 'with_payee' || a.state === 'to_recover'))) : all;
  const summary = { given: 0, settled: 0, outstanding: 0, toRecover: 0, overdue: 0, awaitingApproval: 0, planned: 0 };
  for (const a of all) {
    summary.given += a.figures.given;
    summary.settled += a.figures.settled;
    summary.outstanding += a.figures.outstanding;
    summary.toRecover += a.figures.toRecover;
    if (a.figures.overdue) summary.overdue++;
    if (a.state === 'prepared') summary.awaitingApproval++;
    if (a.state === 'planned') summary.planned++;
  }
  return { advances: list, summary };
}

/** Advances for MRF's case, PO or vendor (the four figures; "MRF shows the advance by reading Finance"). */
export async function advancesForMrf(filter: { case?: string; po?: string; vendor?: string }) {
  const rows: AdvanceRow[] = await db<AdvanceRow>('advances')
    .whereNot({ status: 'cancelled' })
    .modify((q) => {
      if (filter.case) q.whereRaw('lower(case_no) = lower(?)', [filter.case]);
      if (filter.po) q.whereRaw('lower(po_no) = lower(?)', [filter.po]);
      if (filter.vendor) q.whereRaw('lower(vendor_code) = lower(?)', [filter.vendor]);
    })
    .orderBy('id');
  const sets = await settlementsFor(db, rows.map((r) => Number(r.id)));
  const on = today();
  return rows.map((r) => mrfView(r, sets.get(Number(r.id)) ?? [], on));
}

// ---------------------------------------------------------------- background

/**
 * Advances whose settle-by date has passed with money still out turn "to
 * recover" on their own. This tells MRF once per advance when that happens.
 */
export async function sweepOverdue(on = today()): Promise<number> {
  return db.transaction(async (trx) => {
    const due = await trx<AdvanceRow>('advances')
      .where({ status: 'paid' })
      .whereNull('overdue_notified_at')
      .whereNull('closed_on')
      .where('settle_by', '<', on)
      .forUpdate()
      .skipLocked();
    if (!due.length) return 0;
    const sets = await settlementsFor(trx, due.map((a) => Number(a.id)));
    let told = 0;
    for (const a of due) {
      const f = figures(a, sets.get(Number(a.id)) ?? [], on);
      await trx('advances').where({ id: a.id }).update({ overdue_notified_at: new Date() });
      if (f.toRecover <= 0) continue;
      await log(trx, Number(a.id), 'system', 'overdue', { toRecover: f.toRecover, settleBy: a.settle_by });
      await tellMrf(trx, 'advance.changed', a, 'past the settle-by date: to recover');
      told++;
    }
    return told;
  });
}

/**
 * On Account vouchers made before advances were tracked (or imported from the
 * Cloudflare app) get an advance each, so the register and MRF see them. One
 * already cleared gets a settlement for the whole amount on its cleared date.
 */
export async function backfillLegacyAdvances(trx: Knex | Knex.Transaction = db): Promise<number> {
  const orphans = await trx('vouchers as v')
    .leftJoin('advances as a', 'a.voucher_id', 'v.id')
    .where('v.type', 'onaccount')
    .whereNull('v.deleted_at')
    .whereNull('a.id')
    .select('v.*');
  for (const v of orphans) {
    const [row] = await trx('advances')
      .insert({
        college: v.college,
        status: 'paid',
        payee_kind: 'employee',
        payee_name: v.paid_to || v.ac_name || 'Unknown',
        payee_phone: v.recipient_phone || '',
        amount: v.amount,
        form: v.mode || 'Cash',
        reference: v.cheque || '',
        purpose: v.towards || '',
        head: v.head || 'On Account',
        block: v.block || '',
        source: 'legacy',
        planned_by: v.created_by,
        planned_at: v.created_at,
        prepared_by: v.created_by,
        prepared_at: v.created_at,
        approved_by: v.created_by,
        approved_at: v.created_at,
        paid_date: v.date,
        voucher_id: v.id,
        closed_on: v.reversal_date,
        remarks: 'On Account voucher from before advances were tracked',
      })
      .returning<{ id: number }[]>('id');
    await trx('advances').where({ id: row.id }).update({ advance_no: advanceNumber(v.college, row.id, new Date(v.date).getFullYear()) });
    if (v.reversal_date) {
      await trx('advance_settlements').insert({
        advance_id: row.id,
        kind: 'legacy_clear',
        amount: v.amount,
        date: v.reversal_date,
        notes: 'Cleared before settlements were tracked',
        created_by: v.updated_by || v.created_by,
      });
    }
  }
  return orphans.length;
}
