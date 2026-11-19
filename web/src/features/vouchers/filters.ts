import type { Voucher, VoucherType } from '@/api/types';
import { voucherParty } from '@/lib/format';

/** Filter state for the voucher lists (legacy SQ/FT2/FH/FU/FM/SDF/SDT/F_OA_STATUS). */
export interface VoucherFilters {
  /** ISO YYYY-MM-DD, '' = open-ended */
  from: string;
  to: string;
  type: '' | VoucherType;
  head: string;
  /** created-by username (lower-case), '' = everyone */
  user: string;
  /** 'cash' | 'cheque' | 'neft' | 'dd' | '' */
  mode: string;
  /** on-account status: '' | 'pending' | 'cleared' */
  oaStatus: '' | 'pending' | 'cleared';
  q: string;
}

/** Legacy behaviour: both date boxes default to today on first visit. */
export function defaultFilters(today: string): VoucherFilters {
  return { from: today, to: today, type: '', head: '', user: '', mode: '', oaStatus: '', q: '' };
}

export const emptyFilters: VoucherFilters = { from: '', to: '', type: '', head: '', user: '', mode: '', oaStatus: '', q: '' };

export function isCleared(v: Pick<Voucher, 'type' | 'reversalDate'>): boolean {
  return v.type === 'onaccount' && !!v.reversalDate;
}

/** "Mine" = created by me, plus every on-account voucher (legacy _isOwnVoucher). */
export function isOwnVoucher(v: Pick<Voucher, 'type' | 'createdBy'>, username: string): boolean {
  return v.type === 'onaccount' || v.createdBy.toLowerCase() === username.toLowerCase();
}

function searchText(v: Voucher): string {
  return [
    voucherParty(v),
    v.paidTo,
    v.receivedFrom,
    v.voucherNo,
    v.vendorId,
    v.recipientPhone,
    v.head,
    v.towards,
    v.block,
    v.cheque,
    v.reversalDate,
    v.type === 'onaccount' ? (v.reversalDate ? 'cleared' : 'pending') : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterVouchers(list: Voucher[], f: VoucherFilters): Voucher[] {
  const q = f.q.trim().toLowerCase();
  const mode = f.mode.toLowerCase();
  const user = f.user.toLowerCase();
  return list.filter((v) => {
    if (f.from && v.date < f.from) return false;
    if (f.to && v.date > f.to) return false;
    if (f.type && v.type !== f.type) return false;
    if (f.head && v.head !== f.head) return false;
    if (user && v.createdBy.toLowerCase() !== user) return false;
    if (mode && (v.mode || 'Cash').trim().toLowerCase() !== mode) return false;
    if (f.oaStatus) {
      if (v.type !== 'onaccount') return false;
      if (f.oaStatus === 'cleared' ? !v.reversalDate : !!v.reversalDate) return false;
    }
    if (q && !searchText(v).includes(q)) return false;
    return true;
  });
}

/**
 * Legacy ordering: pending on-account first, then other vouchers, then cleared on-account;
 * within a group newest entry first, then newest voucher date.
 */
export function sortVouchers(list: Voucher[]): Voucher[] {
  const rank = (v: Voucher) => (v.type === 'onaccount' ? (v.reversalDate ? 2 : 0) : 1);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    const t = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    if (t) return t;
    return b.date.localeCompare(a.date) || b.id - a.id;
  });
}

export interface VoucherTotals {
  /** Debit + on-account paid in cash */
  cash: number;
  /** Debit + on-account paid by cheque / NEFT / DD */
  cheque: number;
  credit: number;
  /** cash + cheque (legacy "DEBIT" grand total) */
  debit: number;
  onAccountPending: number;
  count: number;
}

export function isCashMode(v: Pick<Voucher, 'mode'>): boolean {
  return (v.mode || 'Cash').trim().toLowerCase() === 'cash';
}

export function voucherTotals(list: Voucher[]): VoucherTotals {
  const t: VoucherTotals = { cash: 0, cheque: 0, credit: 0, debit: 0, onAccountPending: 0, count: list.length };
  for (const v of list) {
    const amt = Math.round(Number(v.amount) || 0);
    if (v.type === 'credit') t.credit += amt;
    else if (isCashMode(v)) t.cash += amt;
    else t.cheque += amt;
    if (v.type === 'onaccount' && !v.reversalDate) t.onAccountPending += amt;
  }
  t.debit = t.cash + t.cheque;
  return t;
}

/** Distinct created-by users, for the "user" filter. */
export function voucherUsers(list: Voucher[]): { username: string; label: string }[] {
  const m = new Map<string, string>();
  for (const v of list) if (v.createdBy) m.set(v.createdBy.toLowerCase(), v.createdByLabel || v.createdBy);
  return [...m].map(([username, label]) => ({ username, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Distinct receiver phones from past vouchers (on-account form suggestions). */
export function phoneSuggestions(list: Voucher[]): { phone: string; paidTo: string }[] {
  const m = new Map<string, string>();
  for (const v of list) {
    const p = v.recipientPhone.trim();
    if (p && !m.has(p)) m.set(p, v.paidTo || voucherParty(v));
  }
  return [...m].map(([phone, paidTo]) => ({ phone, paidTo }));
}

/** Plain-text summary for the "copy details" button. */
export function voucherSummaryText(v: Voucher): string {
  const lines = [
    `Voucher: ${v.voucherNo || '-'} (${v.type === 'onaccount' ? 'On Account' : v.type === 'credit' ? 'Credit' : 'Debit'})`,
    `Date: ${v.date.split('-').reverse().join('/')}`,
    v.type === 'credit' ? `Received from: ${v.receivedFrom}` : `Paid to: ${v.paidTo}`,
    `Head: ${v.head}`,
    `Towards: ${v.towards}`,
    `Amount: Rs. ${Math.round(v.amount)} (${v.amtWords})`,
    `Mode: ${v.mode}${v.cheque ? ' | Ref: ' + v.cheque : ''}`,
  ];
  if (v.recipientPhone) lines.push(`Phone: ${v.recipientPhone}`);
  if (v.type === 'onaccount') lines.push(`Status: ${v.reversalDate ? 'Cleared ' + v.reversalDate.split('-').reverse().join('/') : 'Pending'}`);
  return lines.join('\n');
}
