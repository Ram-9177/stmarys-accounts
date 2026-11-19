import { describe, expect, it } from 'vitest';
import type { Vendor, Voucher } from '@/api/types';
import { escapeHtml, agreementHtml, ledgerStatementHtml } from './documents';
import {
  agreementStatus,
  allVendorFinancials,
  linkedPayments,
  maskAadhaar,
  matchesPaymentFilter,
  matchesPeriod,
  matchesVendorSearch,
  nextVendorId,
  validateVendorForm,
  vendorFinancials,
  type VendorFormValues,
} from './ledger';

function vendor(over: Partial<Vendor> = {}): Vendor {
  return {
    vendorId: 'V00001',
    college: 'smgg',
    companyName: 'ACME Works',
    vendorName: 'A. Kumar',
    phone: '9000000000',
    pan: 'ABCDE1234F',
    aadhaar: '',
    email: '',
    gstNumber: '',
    bankAccountDetails: '',
    workDescription: 'Painting',
    agreedAmount: 10000,
    amountInWords: 'Ten Thousand Rupees Only',
    periodStart: '2026-08-01',
    periodEnd: '2026-12-31',
    authBy: '',
    authRole: '',
    authPlace: '',
    remarks: '',
    files: [],
    createdBy: 'baji',
    createdAt: '2026-07-15T10:00:00Z',
    updatedBy: null,
    updatedAt: '2026-07-15T10:00:00Z',
    ...over,
  };
}

let nextId = 1;
function voucher(over: Partial<Voucher> = {}): Voucher {
  const id = nextId++;
  return {
    id,
    voucherNo: `SMGG-DV-2026-${String(id).padStart(5, '0')}`,
    college: 'smgg',
    type: 'debit',
    date: '2026-09-01',
    head: 'Repairs',
    acName: '',
    receivedFrom: '',
    paidTo: 'ACME',
    vendorId: 'V00001',
    recipientPhone: '',
    reversalDate: '',
    towards: 'Advance',
    block: '',
    amount: 1000,
    amtWords: '',
    mode: 'Cash',
    cheque: '',
    prepBy: '',
    checkedBy: '',
    remarks: '',
    createdBy: 'clerk',
    createdByLabel: 'clerk',
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('nextVendorId', () => {
  it('continues from the highest existing number', () => {
    expect(nextVendorId([])).toBe('V00001');
    expect(nextVendorId([{ vendorId: 'V00002' }, { vendorId: 'V00009' }, { vendorId: 'legacy' }])).toBe('V00010');
  });
});

describe('vendor ledger', () => {
  it('counts only debit vouchers linked by vendor ID, on/after the agreement start, oldest first', () => {
    const v = vendor();
    const list = [
      voucher({ date: '2026-10-05', amount: 2000 }),
      voucher({ date: '2026-09-01', amount: 1500 }),
      voucher({ date: '2026-07-31', amount: 999 }), // before agreement start
      voucher({ type: 'credit', amount: 500 }),
      voucher({ vendorId: 'V00002', amount: 700 }),
      voucher({ vendorId: '', paidTo: 'ACME Works', amount: 800 }), // never matched by name
      voucher({ vendorId: 'v-00001', date: '2026-11-01', amount: 500 }), // punctuation/case-insensitive
    ];
    const paid = linkedPayments(v, list);
    expect(paid.map((p) => p.amount)).toEqual([1500, 2000, 500]);
    const fin = vendorFinancials(v, list);
    expect(fin).toMatchObject({ totalPaid: 4000, balance: 6000, paidPercent: 40, status: 'partial', vouchersCount: 3 });
  });

  it('falls back to the vendor creation date when there is no agreement start', () => {
    const v = vendor({ periodStart: '', agreement: undefined, createdAt: '2026-09-15T08:00:00Z' });
    const fin = vendorFinancials(v, [voucher({ date: '2026-09-14' }), voucher({ date: '2026-09-15', amount: 300 })]);
    expect(fin.totalPaid).toBe(300);
  });

  it('marks fully paid and caps the percentage at 100', () => {
    const fin = vendorFinancials(vendor({ agreedAmount: 1000 }), [voucher({ amount: 1500 })]);
    expect(fin).toMatchObject({ status: 'paid', paidPercent: 100, balance: -500 });
    expect(vendorFinancials(vendor(), []).status).toBe('unpaid');
  });

  it('computes many vendors in one pass with the same results', () => {
    const vs = [vendor(), vendor({ vendorId: 'V00002', agreedAmount: 5000 })];
    const list = [voucher({ amount: 100 }), voucher({ vendorId: 'V00002', amount: 200 })];
    const all = allVendorFinancials(vs, list);
    expect(all.map((f) => f.totalPaid)).toEqual([100, 200]);
    expect(all[0].totalPaid).toBe(vendorFinancials(vs[0], list).totalPaid);
  });

  it('payment status filters match the legacy rules', () => {
    const partial = vendorFinancials(vendor(), [voucher({ amount: 100 })]);
    const unpaid = vendorFinancials(vendor(), []);
    expect(matchesPaymentFilter(partial, 'partial')).toBe(true);
    expect(matchesPaymentFilter(partial, 'pending')).toBe(true);
    expect(matchesPaymentFilter(unpaid, 'partial')).toBe(false);
    expect(matchesPaymentFilter(unpaid, 'unpaid')).toBe(true);
    expect(matchesPaymentFilter(partial, 'paid')).toBe(false);
  });
});

describe('agreementStatus', () => {
  const today = '2026-11-19';
  it('derives status from the agreement period', () => {
    expect(agreementStatus(vendor({ periodStart: '2026-12-01', periodEnd: '' }), today)).toMatchObject({ key: 'not_started', detail: 'Starts in 12d' });
    expect(agreementStatus(vendor({ periodEnd: '2026-11-09' }), today)).toMatchObject({ key: 'expired', detail: '10d ago' });
    expect(agreementStatus(vendor({ periodEnd: '2026-12-10' }), today)).toMatchObject({ key: 'expiring_soon', detail: '21d left' });
    expect(agreementStatus(vendor({ periodEnd: '2027-06-30' }), today).key).toBe('active');
    expect(agreementStatus(vendor({ periodStart: '', periodEnd: '' }), today).key).toBe('active');
  });
  it('respects explicit Completed / Terminated', () => {
    expect(agreementStatus(vendor({ status: 'Terminated' }), today).key).toBe('terminated');
    expect(agreementStatus(vendor({ status: 'completed', periodEnd: '2020-01-01' }), today).key).toBe('completed');
  });
});

describe('search, period and masking', () => {
  it('searches across identity fields', () => {
    const v = vendor({ gstNumber: '37ABCDE1234F1Z5', address: 'Chebrolu' });
    expect(matchesVendorSearch(v, 'acme')).toBe(true);
    expect(matchesVendorSearch(v, '1z5')).toBe(true);
    expect(matchesVendorSearch(v, 'chebrolu')).toBe(true);
    expect(matchesVendorSearch(v, 'zzz')).toBe(false);
  });
  it('period filter keeps overlapping agreements', () => {
    const v = vendor({ periodStart: '2026-08-01', periodEnd: '2026-09-30' });
    expect(matchesPeriod(v, '2026-09-01', '')).toBe(true);
    expect(matchesPeriod(v, '2026-10-01', '')).toBe(false);
    expect(matchesPeriod(v, '', '2026-07-01')).toBe(false);
  });
  it('masks Aadhaar to the last four digits', () => {
    expect(maskAadhaar('1234 5678 9012')).toBe('XXXX XXXX 9012');
    expect(maskAadhaar('')).toBe('');
  });
});

describe('validateVendorForm', () => {
  const base: VendorFormValues = {
    vendorId: 'V00001',
    companyName: 'ACME',
    vendorName: 'Kumar',
    phone: '9000000000',
    pan: 'ABCDE1234F',
    aadhaar: '',
    email: '',
    address: '',
    workDescription: 'Paint',
    agreedAmount: '1000',
    amountInWords: '',
    periodStart: '2026-11-01',
    periodEnd: '',
    gstNumber: '',
    bankAccountDetails: '',
    remarks: '',
    authBy: '',
    authRole: '',
    authPlace: '',
    status: 'Active',
  };
  it('accepts a complete form', () => {
    expect(validateVendorForm(base)).toEqual({ errors: {}, warnings: [] });
  });
  it('blocks missing required fields and bad dates', () => {
    const r = validateVendorForm({ ...base, companyName: '', agreedAmount: '0', periodStart: '2026-11-01', periodEnd: '2026-10-01' });
    expect(Object.keys(r.errors).sort()).toEqual(['agreedAmount', 'companyName', 'periodEnd']);
  });
  it('only warns (asks to confirm) for unusual PAN / Aadhaar formats', () => {
    const r = validateVendorForm({ ...base, pan: 'ABC123', aadhaar: '1234' });
    expect(r.errors).toEqual({});
    expect(r.warnings).toHaveLength(2);
  });
});

describe('printable documents', () => {
  it('escape every interpolated value', () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
    const evil = vendor({ companyName: '<script>alert(1)</script>', workDescription: '<b>x</b>' });
    const html = agreementHtml(evil, "St. Mary's <College>");
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('St. Mary&#39;s &lt;College&gt;');
    const stmt = ledgerStatementHtml(vendorFinancials(evil, [voucher({ towards: '<i>t</i>' })]), 'X');
    expect(stmt).not.toContain('<script>');
    expect(stmt).not.toContain('<i>t</i>');
  });
});
