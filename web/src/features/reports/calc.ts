/**
 * Pure report calculations (no React, no DOM) - ported from the legacy app.old.js
 * renderDash / renderMyDash / renderAnalytics / renderCashBookModal / exportLedger.
 */
import type { Voucher, VoucherType } from '@/api/types';
import { todayISO } from '@/lib/format';

export interface DateRange {
  /** ISO YYYY-MM-DD, '' = open */
  from: string;
  to: string;
}

/** Inclusive ISO date-range filter (string compare works on YYYY-MM-DD). */
export function filterByDate<T extends { date: string }>(vouchers: T[], { from, to }: DateRange): T[] {
  if (!from && !to) return vouchers;
  return vouchers.filter((v) => (!from || v.date >= from) && (!to || v.date <= to));
}

/** Legacy _isOwnVoucher: on-account vouchers are shared with everyone; others only for their creator. */
export function isOwnVoucher(v: Pick<Voucher, 'type' | 'createdBy'>, username: string): boolean {
  if (v.type === 'onaccount') return true;
  return String(v.createdBy || '').toLowerCase() === String(username || '').toLowerCase();
}

export const isCashMode = (v: Pick<Voucher, 'mode'>) => String(v.mode || 'Cash').trim().toLowerCase() === 'cash';
export const isCleared = (v: Pick<Voucher, 'type' | 'reversalDate'>) => v.type === 'onaccount' && !!v.reversalDate;
export const amountOf = (v: Pick<Voucher, 'amount'>) => Math.round(Number(v.amount) || 0);

export interface DashboardStats {
  count: number;
  amount: number;
  today: number;
  debit: { count: number; amount: number };
  credit: { count: number; amount: number };
  onaccount: { count: number; amount: number; open: number; cleared: number; openAmount: number };
}

export function dashboardStats(vouchers: Voucher[], today = todayISO()): DashboardStats {
  const s: DashboardStats = {
    count: vouchers.length,
    amount: 0,
    today: 0,
    debit: { count: 0, amount: 0 },
    credit: { count: 0, amount: 0 },
    onaccount: { count: 0, amount: 0, open: 0, cleared: 0, openAmount: 0 },
  };
  for (const v of vouchers) {
    const a = Number(v.amount) || 0;
    s.amount += a;
    if (v.date === today) s.today++;
    const bucket = s[v.type as VoucherType];
    if (!bucket) continue;
    bucket.count++;
    bucket.amount += a;
    if (v.type === 'onaccount') {
      if (v.reversalDate) s.onaccount.cleared++;
      else {
        s.onaccount.open++;
        s.onaccount.openAmount += a;
      }
    }
  }
  return s;
}

/** Latest 10 by creation time (falls back to id), as on the legacy dashboard. */
export function recentVouchers(vouchers: Voucher[], n = 10): Voucher[] {
  const key = (v: Voucher) => Date.parse(v.createdAt || '') || Number(v.id) || 0;
  return [...vouchers].sort((a, b) => key(b) - key(a) || b.id - a.id).slice(0, n);
}

// ---------------- Analytics ----------------

export interface LabelValue {
  label: string;
  value: number;
}

export function topHeads(vouchers: Voucher[], n = 8): LabelValue[] {
  const totals = new Map<string, number>();
  for (const v of vouchers) if (v.head) totals.set(v.head, (totals.get(v.head) ?? 0) + (Number(v.amount) || 0));
  return [...totals.entries()]
    .filter(([, a]) => a > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

export function typeSplit(vouchers: Voucher[]): { type: VoucherType; label: string; count: number; amount: number }[] {
  const base = { debit: { count: 0, amount: 0 }, onaccount: { count: 0, amount: 0 }, credit: { count: 0, amount: 0 } };
  for (const v of vouchers) {
    const b = base[v.type];
    if (!b) continue;
    b.count++;
    b.amount += Number(v.amount) || 0;
  }
  return [
    { type: 'debit', label: 'Debit', ...base.debit },
    { type: 'onaccount', label: 'On- Acct', ...base.onaccount },
    { type: 'credit', label: 'Credit', ...base.credit },
  ];
}

/** Voucher count and amount per month (YYYY-MM), last `n` months that have data, oldest first. */
export function monthlyVolume(vouchers: Voucher[], n = 8): { month: string; count: number; amount: number }[] {
  const m = new Map<string, { count: number; amount: number }>();
  for (const v of vouchers) {
    const key = v.date && v.date.length >= 7 ? v.date.slice(0, 7) : '?';
    const cur = m.get(key) ?? { count: 0, amount: 0 };
    cur.count++;
    cur.amount += Number(v.amount) || 0;
    m.set(key, cur);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-n)
    .map(([month, x]) => ({ month, ...x }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const i = Number(m) - 1;
  return MONTHS[i] ? `${MONTHS[i]} ${y.slice(2)}` : ym;
}

// ---------------- Cash book ----------------

/** Chronological, ties broken by id (legacy getCashBookSortedVouchers). */
export function cashBookSort<T extends Pick<Voucher, 'date' | 'id'>>(vouchers: T[]): T[] {
  return [...vouchers].sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : (Number(a.id) || 0) - (Number(b.id) || 0)));
}

function joinTw(a: string, b: string): string {
  const x = (a || '').trim();
  const y = (b || '').trim();
  return x && y ? `${x} t/w ${y}` : x || y || '';
}
function withBlock(particulars: string, v: Pick<Voucher, 'block'>): string {
  const block = (v.block || '').trim();
  return block ? (particulars ? `${particulars} - ${block}` : block) : particulars;
}
export const receiptParticulars = (v: Voucher) => withBlock(joinTw(v.receivedFrom, v.towards), v);
export const paymentParticulars = (v: Voucher) => withBlock(joinTw(v.paidTo, v.towards), v);

export interface CashBookSide {
  voucher: Voucher;
  date: string;
  particulars: string;
  cash: number | null;
  bank: number | null;
}

export interface CashBookTotals {
  rcvCash: number;
  rcvBank: number;
  payCash: number;
  payBank: number;
  receipts: number;
  payments: number;
  net: number;
  netCash: number;
  netBank: number;
}

export interface CashBookDay {
  date: string;
  count: number;
  receipts: number;
  payments: number;
  amount: number;
}

export interface CashBook {
  /** Receipts (credit vouchers) on the left, payments (debit + on-account) on the right, paired row by row. */
  rows: { receipt?: CashBookSide; payment?: CashBookSide }[];
  totals: CashBookTotals;
  byDate: CashBookDay[];
  /**
   * Balance of all vouchers dated before `from` (receipts - payments), split cash/bank.
   * The legacy cash book showed only period totals; the opening/closing figures are an addition
   * and are zero when no start date is set.
   */
  opening: { cash: number; bank: number; total: number };
  closing: { cash: number; bank: number; total: number };
  count: number;
}

function totalsOf(vouchers: Voucher[]): CashBookTotals {
  const t = { rcvCash: 0, rcvBank: 0, payCash: 0, payBank: 0 };
  for (const v of vouchers) {
    const a = Number(v.amount) || 0;
    if (v.type === 'credit') {
      if (isCashMode(v)) t.rcvCash += a;
      else t.rcvBank += a;
    } else if (isCashMode(v)) t.payCash += a;
    else t.payBank += a;
  }
  const receipts = t.rcvCash + t.rcvBank;
  const payments = t.payCash + t.payBank;
  return { ...t, receipts, payments, net: receipts - payments, netCash: t.rcvCash - t.payCash, netBank: t.rcvBank - t.payBank };
}

export function buildCashBook(all: Voucher[], range: DateRange): CashBook {
  const inPeriod = filterByDate(all, range);
  const before = range.from ? all.filter((v) => v.date && v.date < range.from) : [];
  const totals = totalsOf(inPeriod);
  const prior = totalsOf(before);
  const side = (v: Voucher, particulars: string): CashBookSide => {
    const a = amountOf(v);
    return { voucher: v, date: v.date, particulars, cash: isCashMode(v) ? a : null, bank: isCashMode(v) ? null : a };
  };
  const receipts = cashBookSort(inPeriod.filter((v) => v.type === 'credit')).map((v) => side(v, receiptParticulars(v)));
  const payments = cashBookSort(inPeriod.filter((v) => v.type === 'debit' || v.type === 'onaccount')).map((v) =>
    side(v, paymentParticulars(v)),
  );
  const n = Math.max(receipts.length, payments.length);
  const rows = Array.from({ length: n }, (_, i) => ({ receipt: receipts[i], payment: payments[i] }));

  const days = new Map<string, CashBookDay>();
  for (const v of inPeriod) {
    const d = days.get(v.date) ?? { date: v.date, count: 0, receipts: 0, payments: 0, amount: 0 };
    d.count++;
    d.amount += Number(v.amount) || 0;
    if (v.type === 'credit') d.receipts++;
    else d.payments++;
    days.set(v.date, d);
  }
  const opening = { cash: prior.netCash, bank: prior.netBank, total: prior.net };
  return {
    rows,
    totals,
    byDate: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    opening,
    closing: { cash: opening.cash + totals.netCash, bank: opening.bank + totals.netBank, total: opening.total + totals.net },
    count: inPeriod.length,
  };
}

export type DatePreset = 'today' | 'month' | 'lastMonth' | 'fy' | 'all';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Quick ranges. Indian financial year runs 1 April - 31 March. */
export function presetRange(preset: DatePreset, now = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const today = todayISO(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'month':
      return { from: iso(y, m, 1), to: today };
    case 'lastMonth': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      const last = new Date(ly, lm, 0).getDate();
      return { from: iso(ly, lm, 1), to: iso(ly, lm, last) };
    }
    case 'fy': {
      const fyStart = m >= 4 ? y : y - 1;
      return { from: iso(fyStart, 4, 1), to: today };
    }
    default:
      return { from: '', to: '' };
  }
}

/** "Period: 01/11/2026 – 19/11/2026" etc. (legacy wording). */
export function periodLabel({ from, to }: DateRange, dmy: (s: string) => string): string {
  if (from && to) return `Period: ${dmy(from)} – ${dmy(to)}`;
  if (from) return `Period: From ${dmy(from)}`;
  if (to) return `Period: Up to ${dmy(to)}`;
  return 'Period: All Dates';
}

// ---------------- Ledger (head-wise) ----------------

export interface LedgerHead {
  head: string;
  entries: { date: string; particulars: string; cash: number | null; bank: number | null }[];
  cash: number;
  bank: number;
}

/** Head-wise ledger (legacy exportLedger): heads sorted case-insensitively, entries in list order. */
export function ledgerByHead(vouchers: Voucher[]): { heads: LedgerHead[]; cash: number; bank: number; minDate: string; maxDate: string } {
  const map = new Map<string, LedgerHead>();
  let minDate = '';
  let maxDate = '';
  for (const v of vouchers) {
    if (v.date) {
      if (!minDate || v.date < minDate) minDate = v.date;
      if (!maxDate || v.date > maxDate) maxDate = v.date;
    }
    const head = v.head || 'Uncategorized';
    const h = map.get(head) ?? { head, entries: [], cash: 0, bank: 0 };
    const party = v.type === 'credit' ? v.receivedFrom || '' : v.paidTo || '';
    const tw = v.towards || '';
    const particulars = party ? party + (tw ? ' t/w ' + tw : '') : tw;
    const a = Number(v.amount) || 0;
    if (isCashMode(v)) h.cash += a;
    else h.bank += a;
    h.entries.push({ date: v.date, particulars, cash: isCashMode(v) ? a : null, bank: isCashMode(v) ? null : a });
    map.set(head, h);
  }
  const heads = [...map.values()].sort((a, b) => a.head.toLowerCase().localeCompare(b.head.toLowerCase()));
  return { heads, cash: heads.reduce((s, h) => s + h.cash, 0), bank: heads.reduce((s, h) => s + h.bank, 0), minDate, maxDate };
}

/** Legacy file-name date: DD-MM-YYYY */
export function fileDate(now = new Date()): string {
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
}
