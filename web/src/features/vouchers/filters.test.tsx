import type { Voucher } from '@/api/types';
import { defaultFilters, emptyFilters, filterVouchers, isOwnVoucher, phoneSuggestions, sortVouchers, voucherTotals, voucherUsers } from './filters';

let nextId = 1;
function v(p: Partial<Voucher>): Voucher {
  const id = nextId++;
  return {
    id,
    voucherNo: `SMGG-DV-2026-${String(id).padStart(5, '0')}`,
    college: 'smgg',
    type: 'debit',
    date: '2026-11-19',
    head: 'Electricity',
    acName: '',
    receivedFrom: '',
    paidTo: 'APSPDCL',
    vendorId: '',
    recipientPhone: '',
    reversalDate: '',
    towards: 'Bill',
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
    createdAt: `2026-11-19T0${id % 10}:00:00Z`,
    updatedAt: '',
    ...p,
  };
}

const list = [
  v({ amount: 100, mode: 'Cash' }),
  v({ amount: 250, mode: 'Cheque', cheque: '123456', head: 'Diesel', createdBy: 'baji', createdByLabel: 'baji' }),
  v({ type: 'credit', amount: 1000, paidTo: '', receivedFrom: 'Student fees', head: 'Credit' }),
  v({ type: 'onaccount', amount: 500, paidTo: 'Ravi', recipientPhone: '9000000001', createdBy: 'baji', createdByLabel: 'baji' }),
  v({ type: 'onaccount', amount: 300, paidTo: 'Sita', recipientPhone: '9000000002', reversalDate: '2026-11-20', date: '2026-11-18' }),
  v({ date: '2026-11-01', amount: 40, mode: 'NEFT' }),
];

describe('filterVouchers', () => {
  it('defaults to today only, like the legacy list', () => {
    expect(filterVouchers(list, defaultFilters('2026-11-19'))).toHaveLength(4);
    expect(filterVouchers(list, emptyFilters)).toHaveLength(6);
  });

  it('filters by type, head, mode, user and on-account status', () => {
    expect(filterVouchers(list, { ...emptyFilters, type: 'credit' }).map((x) => x.amount)).toEqual([1000]);
    expect(filterVouchers(list, { ...emptyFilters, head: 'Diesel' }).map((x) => x.amount)).toEqual([250]);
    expect(filterVouchers(list, { ...emptyFilters, mode: 'neft' }).map((x) => x.amount)).toEqual([40]);
    expect(filterVouchers(list, { ...emptyFilters, user: 'BAJI' }).map((x) => x.amount).sort()).toEqual([250, 500]);
    expect(filterVouchers(list, { ...emptyFilters, oaStatus: 'pending' }).map((x) => x.amount)).toEqual([500]);
    expect(filterVouchers(list, { ...emptyFilters, oaStatus: 'cleared' }).map((x) => x.amount)).toEqual([300]);
  });

  it('searches party, cheque, phone, voucher no and status words', () => {
    expect(filterVouchers(list, { ...emptyFilters, q: 'student' })).toHaveLength(1);
    expect(filterVouchers(list, { ...emptyFilters, q: '123456' })).toHaveLength(1);
    expect(filterVouchers(list, { ...emptyFilters, q: '9000000002' })).toHaveLength(1);
    expect(filterVouchers(list, { ...emptyFilters, q: 'pending' }).map((x) => x.paidTo)).toEqual(['Ravi']);
    expect(filterVouchers(list, { ...emptyFilters, q: list[0].voucherNo.toLowerCase() })).toHaveLength(1);
  });

  it('respects an inclusive date range', () => {
    expect(filterVouchers(list, { ...emptyFilters, from: '2026-11-18', to: '2026-11-18' })).toHaveLength(1);
    expect(filterVouchers(list, { ...emptyFilters, to: '2026-11-18' })).toHaveLength(2);
  });
});

describe('totals and ordering', () => {
  it('splits debit into cash vs cheque/bank and keeps credit separate (legacy MODE TOTALS)', () => {
    expect(voucherTotals(list)).toEqual({ cash: 900, cheque: 290, credit: 1000, debit: 1190, onAccountPending: 500, count: 6 });
  });

  it('puts pending on-account first and cleared on-account last', () => {
    const sorted = sortVouchers(list);
    expect(sorted[0].paidTo).toBe('Ravi');
    expect(sorted.at(-1)!.paidTo).toBe('Sita');
  });
});

describe('ownership and suggestions', () => {
  it('"mine" includes own vouchers plus every on-account voucher', () => {
    const mine = list.filter((x) => isOwnVoucher(x, 'Clerk'));
    expect(mine).toHaveLength(5);
  });

  it('lists distinct users and receiver phones', () => {
    expect(voucherUsers(list).map((u) => u.username)).toEqual(['baji', 'clerk']);
    expect(phoneSuggestions(list)).toEqual([
      { phone: '9000000001', paidTo: 'Ravi' },
      { phone: '9000000002', paidTo: 'Sita' },
    ]);
  });
});
