import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/knex.js';
import { audit } from '../lib/audit.js';
import { ah, badRequest, forbidden, notFound } from '../lib/errors.js';
import { allowedCollege, canViewAllVouchers, displayUsername, hasPerm, isVoucherAdmin, type PermUser } from '../lib/permissions.js';
import { clean, isoFromAny, isValidIsoDate, normalizeCollegeCode } from '../lib/text.js';
import { clientIp, type AuthedRequest } from '../middleware/auth.js';

export const vouchersRouter = Router();

export interface VoucherRow {
  id: number;
  voucher_no: string | null;
  college: string;
  type: 'debit' | 'onaccount' | 'credit';
  date: string;
  head: string;
  ac_name: string;
  received_from: string;
  paid_to: string;
  vendor_id: string;
  recipient_phone: string;
  reversal_date: string | null;
  towards: string;
  block: string;
  amount: number;
  amt_words: string;
  mode: string;
  cheque: string;
  prep_by: string;
  checked_by: string;
  remarks: string;
  created_by: string;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
  deleted_at: Date | null;
}

/** The advance a voucher belongs to: its payment (On Account) or a return of unspent money (a receipt). */
export interface AdvanceLink {
  id: number;
  advanceNo: string;
  role: 'payment' | 'return';
}

export function voucherDto(v: VoucherRow, advance: AdvanceLink | null = null) {
  return {
    id: v.id,
    voucherNo: v.voucher_no ?? '',
    college: normalizeCollegeCode(v.college),
    type: v.type,
    date: v.date,
    head: v.head,
    acName: v.ac_name,
    receivedFrom: v.received_from,
    paidTo: v.paid_to,
    vendorId: v.vendor_id,
    recipientPhone: v.recipient_phone,
    reversalDate: v.reversal_date ?? '',
    towards: v.towards,
    block: v.block,
    amount: Number(v.amount),
    amtWords: v.amt_words,
    mode: v.mode || 'Cash',
    cheque: v.cheque,
    prepBy: v.prep_by,
    checkedBy: v.checked_by,
    remarks: v.remarks,
    createdBy: v.created_by,
    createdByLabel: displayUsername(v.created_by),
    createdAt: v.created_at,
    updatedAt: v.updated_at,
    advance,
  };
}
export type VoucherDto = ReturnType<typeof voucherDto>;

/** Which of these vouchers belong to an advance (On Account payments and returns). */
export async function advanceLinks(ids: number[]): Promise<Map<number, AdvanceLink>> {
  const map = new Map<number, AdvanceLink>();
  if (!ids.length) return map;
  const payments = await db('advances').whereIn('voucher_id', ids).select('id', 'advance_no', 'voucher_id');
  for (const a of payments) map.set(Number(a.voucher_id), { id: Number(a.id), advanceNo: a.advance_no ?? '', role: 'payment' });
  const returns = await db('advance_settlements as s')
    .join('advances as a', 'a.id', 's.advance_id')
    .whereIn('s.receipt_voucher_id', ids)
    .select('a.id', 'a.advance_no', 's.receipt_voucher_id');
  for (const r of returns) map.set(Number(r.receipt_voucher_id), { id: Number(r.id), advanceNo: r.advance_no ?? '', role: 'return' });
  return map;
}

async function advanceLink(id: number): Promise<AdvanceLink | null> {
  return (await advanceLinks([id])).get(id) ?? null;
}

/** Vouchers the user may see in a college: everything for admins, own + on-account for others. */
function visibleVouchers(user: PermUser, college: string) {
  const q = db<VoucherRow>('vouchers').whereNull('deleted_at').andWhere({ college });
  if (!canViewAllVouchers(user)) {
    q.andWhere((w) => w.where('created_by', user.username).orWhere('type', 'onaccount'));
  }
  return q;
}

vouchersRouter.get(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    const college = allowedCollege(req.user, req.query.college);
    // Cheap change detector so the 30s live-sync poll usually costs one tiny query.
    const meta = await visibleVouchers(req.user, college)
      .clone()
      .select(db.raw('count(*)::int as c'), db.raw("coalesce(extract(epoch from max(updated_at))::text, '0') as m"))
      .first<{ c: number; m: string }>();
    const etag = `W/"v-${college}-${meta?.c ?? 0}-${String(meta?.m ?? '0').replace(/[^0-9.]/g, '')}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const rows = await visibleVouchers(req.user, college).select('*').orderBy([
      { column: 'date', order: 'desc' },
      { column: 'id', order: 'desc' },
    ]);
    const links = await advanceLinks(rows.filter((r) => r.type !== 'debit').map((r) => Number(r.id)));
    res.json({ vouchers: rows.map((r) => voucherDto(r, links.get(Number(r.id)) ?? null)) });
  }),
);

const str = (max: number) =>
  z
    .any()
    .optional()
    .transform((v) => clean(v, max));

const VoucherBody = z.object({
  college: str(20),
  type: z.enum(['debit', 'onaccount', 'credit']),
  date: str(20),
  head: str(250),
  acName: str(250),
  receivedFrom: str(250),
  paidTo: str(250),
  vendorId: str(50),
  recipientPhone: str(30),
  reversalDate: str(20),
  towards: str(500),
  block: str(250),
  amount: z.coerce.number(),
  amtWords: str(500),
  mode: str(50),
  cheque: str(120),
  prepBy: str(120),
  checkedBy: str(120),
  remarks: str(500),
});

function normalizeVoucher(user: PermUser, body: unknown) {
  const v = VoucherBody.parse(body);
  const row = {
    college: allowedCollege(user, v.college),
    type: v.type,
    date: isoFromAny(v.date),
    head: v.head,
    ac_name: v.acName,
    received_from: v.receivedFrom,
    paid_to: v.paidTo,
    vendor_id: v.vendorId,
    recipient_phone: v.type === 'onaccount' ? v.recipientPhone : '',
    reversal_date: v.type === 'onaccount' && v.reversalDate ? isoFromAny(v.reversalDate) : null,
    towards: v.towards,
    block: v.block,
    amount: Math.round(v.amount),
    amt_words: v.amtWords,
    mode: v.mode || 'Cash',
    cheque: v.cheque,
    prep_by: v.prepBy,
    checked_by: v.checkedBy,
    remarks: v.remarks,
  };
  if (!row.date || !row.head || !row.towards || !row.amount) throw badRequest('Date, head, towards and amount are required');
  if (!isValidIsoDate(row.date)) throw badRequest('Invalid voucher date');
  if (row.reversal_date && !isValidIsoDate(row.reversal_date)) throw badRequest('Invalid reverse / cleared date');
  if (!Number.isFinite(row.amount) || row.amount <= 0 || row.amount > 10_000_000_000) {
    throw badRequest('Amount must be a positive number');
  }
  if (row.type === 'onaccount' && !row.recipient_phone) {
    throw badRequest('Receiver phone number is required for On Account vouchers');
  }
  if (row.reversal_date && row.reversal_date < row.date) {
    throw badRequest('Reverse / cleared date cannot be before the voucher date');
  }
  return row;
}

export { voucherNumber } from '../lib/numbers.js';
import { voucherNumber } from '../lib/numbers.js';

vouchersRouter.post(
  '/',
  ah<AuthedRequest>(async (req, res) => {
    const user = req.user;
    if (!hasPerm(user, 'create_voucher')) throw forbidden('Access denied. Missing create_voucher permission.');
    const row = normalizeVoucher(user, req.body);
    if (row.type === 'onaccount') throw badRequest(ON_ACCOUNT_ELSEWHERE);
    const created = await db.transaction(async (trx) => {
      const [ins] = await trx('vouchers')
        .insert({ ...row, created_by: user.username, updated_by: user.username })
        .returning<{ id: number }[]>('id');
      const voucherNo = voucherNumber(row.college, row.type, ins.id);
      const [saved] = await trx('vouchers').where({ id: ins.id }).update({ voucher_no: voucherNo }).returning<VoucherRow[]>('*');
      await audit(user.username, 'create_voucher', 'voucher', String(ins.id), { voucherNo, amount: row.amount, head: row.head }, clientIp(req), trx);
      return saved;
    });
    res.status(201).json({ voucher: voucherDto(created) });
  }),
);

async function getActiveVoucher(id: number): Promise<VoucherRow> {
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid voucher id');
  const row = await db<VoucherRow>('vouchers').where({ id }).whereNull('deleted_at').first();
  if (!row) throw notFound('Voucher not found');
  return row;
}

const ON_ACCOUNT_ELSEWHERE =
  'On Account advances are made from On Account → New advance: they are planned, approved by a second person and then paid.';

/** Fields an advance owns on its vouchers: change them on the advance, never on the voucher. */
const ADVANCE_OWNED: (keyof VoucherRow)[] = ['type', 'college', 'date', 'amount', 'mode', 'cheque', 'paid_to', 'received_from', 'recipient_phone', 'reversal_date'];

function ensureVoucherMutationAccess(user: PermUser, v: VoucherRow): void {
  const college = normalizeCollegeCode(v.college);
  allowedCollege(user, college);
  if (!isVoucherAdmin(user) && v.created_by !== user.username && v.type !== 'onaccount') {
    throw forbidden('Access denied. You can only modify your own vouchers.');
  }
}

vouchersRouter.put(
  '/:id',
  ah<AuthedRequest>(async (req, res) => {
    const user = req.user;
    const id = Number(req.params.id);
    const existing = await getActiveVoucher(id);
    const row = normalizeVoucher(user, req.body);
    const link = await advanceLink(id);
    if (link) {
      const same = (k: keyof VoucherRow, v: unknown) => {
        if (k === 'college') return normalizeCollegeCode(v) === normalizeCollegeCode(existing.college);
        if (k === 'mode') return String(v || 'Cash') === String(existing.mode || 'Cash');
        return String(v ?? '') === String(existing[k] ?? '');
      };
      const changed = ADVANCE_OWNED.filter((k) => !same(k, (row as Record<string, unknown>)[k]));
      if (changed.length) {
        throw badRequest(`This voucher belongs to advance ${link.advanceNo}. Its amount, date, payment and status are kept on the advance.`);
      }
    } else if (row.type === 'onaccount' && existing.type !== 'onaccount') {
      throw badRequest(ON_ACCOUNT_ELSEWHERE);
    }
    // Users without edit_voucher may still update on-account vouchers (e.g. their description).
    const canEdit = hasPerm(user, 'edit_voucher');
    if (!canEdit && existing.type !== 'onaccount') throw forbidden('Access denied. Missing edit_voucher permission.');
    if (!canEdit && row.type !== 'onaccount') throw forbidden('Only authorized users can change the voucher type');
    ensureVoucherMutationAccess(user, existing);
    const [saved] = await db('vouchers')
      .where({ id, college: existing.college })
      .whereNull('deleted_at')
      .update({ ...row, updated_by: user.username, updated_at: new Date() })
      .returning<VoucherRow[]>('*');
    await audit(user.username, 'update_voucher', 'voucher', String(id), { amount: row.amount, head: row.head }, clientIp(req));
    res.json({ voucher: voucherDto(saved, link) });
  }),
);

vouchersRouter.delete(
  '/:id',
  ah<AuthedRequest>(async (req, res) => {
    const user = req.user;
    if (!hasPerm(user, 'delete_voucher')) throw forbidden('Access denied. Missing delete_voucher permission.');
    const id = Number(req.params.id);
    const existing = await getActiveVoucher(id);
    ensureVoucherMutationAccess(user, existing);
    const link = await advanceLink(id);
    if (link) {
      throw badRequest(
        link.role === 'payment'
          ? `This voucher is the payment of advance ${link.advanceNo}. A paid advance is settled (set off or returned), not deleted.`
          : `This receipt is money returned on advance ${link.advanceNo} and cannot be deleted.`,
      );
    }
    const now = new Date();
    await db('vouchers')
      .where({ id, college: existing.college })
      .whereNull('deleted_at')
      .update({ deleted_at: now, deleted_by: user.username, updated_by: user.username, updated_at: now });
    await audit(user.username, 'delete_voucher', 'voucher', String(id), 'Soft delete', clientIp(req));
    res.json({ ok: true });
  }),
);
