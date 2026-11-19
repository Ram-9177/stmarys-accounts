import type { CollegeCode, Voucher, VoucherInput, VoucherType } from '@/api/types';
import { amountInWords } from '@/lib/format';

export const PAYMENT_MODES = ['Cash', 'Cheque', 'NEFT', 'DD'] as const;

/** Form state: everything as strings so inputs stay controlled. */
export interface VoucherDraft {
  type: VoucherType;
  date: string;
  head: string;
  acName: string;
  receivedFrom: string;
  paidTo: string;
  vendorId: string;
  recipientPhone: string;
  reversalDate: string;
  towards: string;
  block: string;
  amount: string;
  amtWords: string;
  mode: string;
  cheque: string;
  prepBy: string;
  checkedBy: string;
  remarks: string;
}

/** Default account head per type (legacy: credit vouchers book to "Credit", on-account to "On Account"). */
export function defaultHead(type: VoucherType): string {
  return type === 'credit' ? 'Credit' : type === 'onaccount' ? 'On Account' : '';
}

export function emptyDraft(type: VoucherType, today: string): VoucherDraft {
  return {
    type,
    date: today,
    head: defaultHead(type),
    acName: type === 'credit' ? 'Credit' : '',
    receivedFrom: '',
    paidTo: '',
    vendorId: '',
    recipientPhone: '',
    reversalDate: '',
    towards: '',
    block: '',
    amount: '',
    amtWords: '',
    mode: 'Cash',
    cheque: '',
    prepBy: '',
    checkedBy: '',
    remarks: '',
  };
}

export function draftFromVoucher(v: Voucher): VoucherDraft {
  return {
    type: v.type,
    date: v.date,
    head: v.head,
    acName: v.acName,
    receivedFrom: v.receivedFrom,
    paidTo: v.paidTo,
    vendorId: v.vendorId,
    recipientPhone: v.recipientPhone,
    reversalDate: v.reversalDate,
    towards: v.towards,
    block: v.block,
    amount: v.amount ? String(v.amount) : '',
    amtWords: v.amtWords,
    mode: v.mode || 'Cash',
    cheque: v.cheque,
    prepBy: v.prepBy,
    checkedBy: v.checkedBy,
    remarks: v.remarks,
  };
}

/** Switch voucher type, keeping shared fields and resetting the default head if it was untouched. */
export function changeType(d: VoucherDraft, type: VoucherType): VoucherDraft {
  const head = !d.head || d.head === defaultHead(d.type) ? defaultHead(type) : d.head;
  return { ...d, type, head, acName: type === 'credit' ? d.acName || 'Credit' : d.acName };
}

/** Amount change also refreshes the amount-in-words (legacy autoWords). */
export function withAmount(d: VoucherDraft, amount: string): VoucherDraft {
  const n = parseFloat(amount);
  return { ...d, amount, amtWords: n > 0 ? amountInWords(n) : '' };
}

export type DraftErrors = Partial<Record<keyof VoucherDraft, string>>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function validIso(s: string) {
  if (!ISO.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Mirrors the legacy form checks plus the server rules (server/src/routes/vouchers.ts). */
export function validateDraft(d: VoucherDraft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.date) e.date = 'Pick a date';
  else if (!validIso(d.date)) e.date = 'Invalid date';
  const amt = parseFloat(d.amount);
  if (!d.amount.trim() || !Number.isFinite(amt) || amt <= 0) e.amount = 'Enter an amount greater than 0';
  else if (amt > 10_000_000_000) e.amount = 'Amount is too large';
  if (!d.towards.trim()) e.towards = 'Towards is required';
  if (d.type === 'credit') {
    if (!d.receivedFrom.trim()) e.receivedFrom = 'Received from is required';
  } else {
    if (!d.head.trim()) e.head = 'Account head is required';
    if (!d.paidTo.trim()) e.paidTo = 'Paid to is required';
  }
  if (d.type === 'onaccount') {
    if (!d.recipientPhone.trim()) e.recipientPhone = 'Receiver phone number is required for On Account vouchers';
    else if (!/^[0-9+\-\s()]{6,30}$/.test(d.recipientPhone.trim())) e.recipientPhone = 'Enter a valid phone number';
    if (d.reversalDate) {
      if (!validIso(d.reversalDate)) e.reversalDate = 'Invalid date';
      else if (d.date && d.reversalDate < d.date) e.reversalDate = 'Reverse / cleared date cannot be before the voucher date';
    }
  }
  return e;
}

export function draftToInput(d: VoucherDraft, college: CollegeCode): VoucherInput {
  const t = (s: string) => s.trim();
  const amount = Math.round(parseFloat(d.amount) || 0);
  return {
    college,
    type: d.type,
    date: d.date,
    head: t(d.head) || defaultHead(d.type),
    acName: d.type === 'credit' ? t(d.acName) || 'Credit' : t(d.acName),
    receivedFrom: d.type === 'credit' ? t(d.receivedFrom) : '',
    paidTo: d.type === 'credit' ? '' : t(d.paidTo),
    vendorId: d.type === 'debit' ? t(d.vendorId) : '',
    recipientPhone: d.type === 'onaccount' ? t(d.recipientPhone) : '',
    reversalDate: d.type === 'onaccount' ? d.reversalDate : '',
    towards: t(d.towards),
    block: t(d.block),
    amount,
    amtWords: t(d.amtWords) || amountInWords(amount),
    mode: d.mode || 'Cash',
    cheque: t(d.cheque),
    prepBy: t(d.prepBy),
    checkedBy: t(d.checkedBy),
    remarks: t(d.remarks),
  };
}

/** Full PUT body for an existing voucher (used by inline "mark cleared"). */
export function voucherToInput(v: Voucher, patch: Partial<VoucherInput> = {}): VoucherInput {
  return {
    college: v.college,
    type: v.type,
    date: v.date,
    head: v.head,
    acName: v.acName,
    receivedFrom: v.receivedFrom,
    paidTo: v.paidTo,
    vendorId: v.vendorId,
    recipientPhone: v.recipientPhone,
    reversalDate: v.reversalDate,
    towards: v.towards,
    block: v.block,
    amount: v.amount,
    amtWords: v.amtWords,
    mode: v.mode,
    cheque: v.cheque,
    prepBy: v.prepBy,
    checkedBy: v.checkedBy,
    remarks: v.remarks,
    ...patch,
  };
}

/**
 * Who may edit / delete a voucher (mirrors the server):
 * on-account vouchers are editable by anyone who can see them; others need edit_voucher
 * and must be the creator unless the user is a voucher admin.
 */
export function canEditVoucher(v: Pick<Voucher, 'type' | 'createdBy'>, opts: { username: string; canEdit: boolean; isAdmin: boolean }): boolean {
  if (v.type === 'onaccount') return true;
  return opts.canEdit && (opts.isAdmin || v.createdBy === opts.username);
}

export function canDeleteVoucher(v: Pick<Voucher, 'type' | 'createdBy'>, opts: { username: string; canDelete: boolean; isAdmin: boolean }): boolean {
  return opts.canDelete && (opts.isAdmin || v.createdBy === opts.username || v.type === 'onaccount');
}
