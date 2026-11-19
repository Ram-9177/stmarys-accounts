import { describe, expect, it } from 'vitest';
import type { Voucher } from '@/api/types';
import {
  buildCashBook,
  cashBookSort,
  dashboardStats,
  filterByDate,
  isOwnVoucher,
  ledgerByHead,
  monthlyVolume,
  periodLabel,
  presetRange,
  recentVouchers,
  topHeads,
  typeSplit,
} from './calc';

let nextId = 1;
function v(p: Partial<Voucher>): Voucher {
  const id = p.id ?? nextId++;
  return {
    id,
    voucherNo: `SMGG-DV-2026-${String(id).padStart(5, '0')}`,
    college: 'smgg',
    type: 'debit',
    date: '2026-11-10',
    head: 'Electricity',
    acName: '',
    receivedFrom: '',
    paidTo: '',
    vendorId: '',
    recipientPhone: '',
    reversalDate: '',
    towards: '',
    block: '',
    amount: 100,
    amtWords: '',
    mode: 'Cash',
    cheque: '',
    prepBy: '',
    checkedBy: '',
    remarks: '',
    createdBy: 'clerk',
    createdByLabel: 'clerk',
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
    ...p,
  };
}

describe('filters', () => {
  it('filters by inclusive ISO date range', () => {
    const list = [v({ date: '2026-10-31' }), v({ date: '2026-11-01' }), v({ date: '2026-11-30' }), v({ date: '2026-12-01' })];
    expect(filterByDate(list, { from: '2026-11-01', to: '2026-11-30' }).map((x) => x.date)).toEqual(['2026-11-01', '2026-11-30']);
    expect(filterByDate(list, { from: '', to: '' })).toHaveLength(4);
    expect(filterByDate(list, { from: '2026-11-30', to: '' })).toHaveLength(2);
  });

  it('own vouchers = created by me (case-insensitive) or any on-account voucher', () => {
    expect(isOwnVoucher(v({ createdBy: 'Clerk' }), 'clerk')).toBe(true);
    expect(isOwnVoucher(v({ createdBy: 'other' }), 'clerk')).toBe(false);
    expect(isOwnVoucher(v({ createdBy: 'other', type: 'onaccount' }), 'clerk')).toBe(true);
  });
});

describe('dashboard', () => {
  it('totals counts and amounts by type, today, and open/cleared on-account', () => {
    const list = [
      v({ type: 'debit', amount: 500, date: '2026-11-19' }),
      v({ type: 'credit', amount: 2000 }),
      v({ type: 'onaccount', amount: 300 }),
      v({ type: 'onaccount', amount: 700, reversalDate: '2026-11-15' }),
    ];
    const s = dashboardStats(list, '2026-11-19');
    expect(s.count).toBe(4);
    expect(s.amount).toBe(3500);
    expect(s.today).toBe(1);
    expect(s.debit).toEqual({ count: 1, amount: 500 });
    expect(s.credit).toEqual({ count: 1, amount: 2000 });
    expect(s.onaccount).toEqual({ count: 2, amount: 1000, open: 1, cleared: 1, openAmount: 300 });
  });

  it('recent vouchers are newest-created first, max 10', () => {
    const list = Array.from({ length: 12 }, (_, i) => v({ id: 100 + i, createdAt: `2026-11-${String(i + 1).padStart(2, '0')}T08:00:00Z` }));
    const r = recentVouchers(list);
    expect(r).toHaveLength(10);
    expect(r[0].id).toBe(111);
  });
});

describe('analytics', () => {
  it('ranks heads by amount and splits types', () => {
    const list = [v({ head: 'A', amount: 10 }), v({ head: 'B', amount: 50 }), v({ head: 'A', amount: 45, type: 'credit' }), v({ head: '', amount: 999 })];
    expect(topHeads(list)).toEqual([
      { label: 'A', value: 55 },
      { label: 'B', value: 50 },
    ]);
    const split = typeSplit(list);
    expect(split.find((s) => s.type === 'debit')).toMatchObject({ count: 3, amount: 1059 });
    expect(split.find((s) => s.type === 'credit')).toMatchObject({ count: 1, amount: 45 });
  });

  it('groups monthly volume oldest-first and keeps the last n months', () => {
    const list = ['2026-01-05', '2026-01-20', '2026-03-01', '2026-02-11'].map((date) => v({ date, amount: 10 }));
    expect(monthlyVolume(list)).toEqual([
      { month: '2026-01', count: 2, amount: 20 },
      { month: '2026-02', count: 1, amount: 10 },
      { month: '2026-03', count: 1, amount: 10 },
    ]);
    expect(monthlyVolume(list, 2).map((m) => m.month)).toEqual(['2026-02', '2026-03']);
  });
});

describe('cash book', () => {
  const list = [
    // before the period -> opening balance
    v({ id: 1, type: 'credit', amount: 10000, date: '2026-10-25', mode: 'Cash' }),
    v({ id: 2, type: 'debit', amount: 4000, date: '2026-10-28', mode: 'Cash' }),
    v({ id: 3, type: 'credit', amount: 5000, date: '2026-10-29', mode: 'Cheque' }),
    // in period
    v({ id: 12, type: 'debit', amount: 300, date: '2026-11-02', mode: 'Cash', paidTo: 'Shop', towards: 'Diesel', block: 'A Block', head: 'Fuel' }),
    v({ id: 11, type: 'onaccount', amount: 1000, date: '2026-11-02', mode: 'NEFT', paidTo: 'Vendor' }),
    v({ id: 10, type: 'credit', amount: 2500, date: '2026-11-03', mode: 'Cash', receivedFrom: 'Student', towards: 'Fees' }),
    // after the period -> ignored
    v({ id: 20, type: 'credit', amount: 99999, date: '2026-12-01' }),
  ];
  const cb = buildCashBook(list, { from: '2026-11-01', to: '2026-11-30' });

  it('puts credits on the receipts side and debit + on-account on the payments side', () => {
    expect(cb.count).toBe(3);
    expect(cb.rows).toHaveLength(2);
    expect(cb.rows[0].receipt?.particulars).toBe('Student t/w Fees');
    expect(cb.rows[0].payment?.voucher.id).toBe(11); // same date -> lower id first
    expect(cb.rows[1].payment?.particulars).toBe('Shop t/w Diesel - A Block');
    expect(cb.rows[1].receipt).toBeUndefined();
  });

  it('splits cash vs cheque/bank and totals each side', () => {
    expect(cb.totals).toMatchObject({ rcvCash: 2500, rcvBank: 0, payCash: 300, payBank: 1000, receipts: 2500, payments: 1300, net: 1200 });
    expect(cb.rows[0].payment).toMatchObject({ cash: null, bank: 1000 });
  });

  it('opening balance = receipts - payments before the start date; closing = opening + period net', () => {
    expect(cb.opening).toEqual({ cash: 6000, bank: 5000, total: 11000 });
    expect(cb.closing).toEqual({ cash: 8200, bank: 4000, total: 12200 });
  });

  it('has no opening balance when the period has no start date', () => {
    const all = buildCashBook(list, { from: '', to: '' });
    expect(all.opening.total).toBe(0);
    expect(all.count).toBe(list.length);
  });

  it('groups transactions per day', () => {
    expect(cb.byDate).toEqual([
      { date: '2026-11-02', count: 2, receipts: 0, payments: 2, amount: 1300 },
      { date: '2026-11-03', count: 1, receipts: 1, payments: 0, amount: 2500 },
    ]);
  });

  it('sorts by date then id', () => {
    expect(cashBookSort([v({ id: 5, date: '2026-01-02' }), v({ id: 9, date: '2026-01-01' }), v({ id: 3, date: '2026-01-02' })]).map((x) => x.id)).toEqual([
      9, 3, 5,
    ]);
  });
});

describe('presets and labels', () => {
  const now = new Date(2026, 0, 15); // 15 Jan 2026
  it('computes quick ranges including the April-March financial year', () => {
    expect(presetRange('today', now)).toEqual({ from: '2026-01-15', to: '2026-01-15' });
    expect(presetRange('month', now)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    expect(presetRange('lastMonth', now)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('fy', now)).toEqual({ from: '2025-04-01', to: '2026-01-15' });
    expect(presetRange('fy', new Date(2026, 3, 1))).toEqual({ from: '2026-04-01', to: '2026-04-01' });
    expect(presetRange('all', now)).toEqual({ from: '', to: '' });
  });

  it('formats the period line like the legacy cash book', () => {
    const d = (s: string) => s.split('-').reverse().join('/');
    expect(periodLabel({ from: '2026-11-01', to: '2026-11-19' }, d)).toBe('Period: 01/11/2026 – 19/11/2026');
    expect(periodLabel({ from: '', to: '2026-11-19' }, d)).toBe('Period: Up to 19/11/2026');
    expect(periodLabel({ from: '', to: '' }, d)).toBe('Period: All Dates');
  });
});

describe('ledger', () => {
  it('groups by head (case-insensitive order) with cash/cheque totals and particulars', () => {
    const l = ledgerByHead([
      v({ head: 'water', amount: 50, mode: 'Cheque', paidTo: 'Board', towards: 'Oct' }),
      v({ head: 'Electricity', amount: 100, date: '2026-11-01' }),
      v({ head: '', type: 'credit', amount: 30, receivedFrom: 'Canteen', date: '2026-11-20' }),
    ]);
    expect(l.heads.map((h) => h.head)).toEqual(['Electricity', 'Uncategorized', 'water']);
    expect(l.heads[2].entries[0]).toMatchObject({ particulars: 'Board t/w Oct', cash: null, bank: 50 });
    expect(l.heads[1].entries[0].particulars).toBe('Canteen');
    expect([l.cash, l.bank, l.minDate, l.maxDate]).toEqual([130, 50, '2026-11-01', '2026-11-20']);
  });
});
