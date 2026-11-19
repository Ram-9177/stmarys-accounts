import type { Voucher } from '@/api/types';
import { canDeleteVoucher, canEditVoucher, changeType, draftToInput, emptyDraft, validateDraft, withAmount } from './draft';
import { buildEscPosVoucher } from './serial';
import { buildPrintDocument, buildVoucherHtml, esc, towardsLines } from './print';

const TODAY = '2026-11-19';

describe('voucher form draft', () => {
  it('fills amount in words as the amount is typed (Indian numbering)', () => {
    const d = withAmount(emptyDraft('debit', TODAY), '125000');
    expect(d.amtWords).toBe('One Lakh Twenty Five Thousand Rupees Only');
    expect(withAmount(d, '').amtWords).toBe('');
    expect(withAmount(d, '12.5').amtWords).toBe('Twelve Rupees and Fifty Paise Only');
  });

  it('requires head, paid to, towards and amount for debit vouchers', () => {
    const e = validateDraft(emptyDraft('debit', TODAY));
    expect(Object.keys(e).sort()).toEqual(['amount', 'head', 'paidTo', 'towards']);
  });

  it('credit vouchers need "received from" but not a head', () => {
    const e = validateDraft(emptyDraft('credit', TODAY));
    expect(e.receivedFrom).toBeTruthy();
    expect(e.head).toBeUndefined();
    expect(e.paidTo).toBeUndefined();
  });

  it('on-account vouchers need a phone and a cleared date not before the voucher date', () => {
    const d = { ...withAmount(emptyDraft('onaccount', TODAY), '500'), paidTo: 'Ravi', towards: 'Advance' };
    expect(validateDraft(d).recipientPhone).toMatch(/required/);
    const early = { ...d, recipientPhone: '9000000001', reversalDate: '2026-11-01' };
    expect(validateDraft(early).reversalDate).toMatch(/cannot be before/);
    expect(validateDraft({ ...early, reversalDate: '2026-11-25' })).toEqual({});
    expect(validateDraft({ ...d, recipientPhone: '9000000001', date: '2026-02-30' }).date).toBe('Invalid date');
  });

  it('switching type swaps the default head but keeps a custom one', () => {
    const d = emptyDraft('debit', TODAY);
    expect(changeType(d, 'onaccount').head).toBe('On Account');
    expect(changeType({ ...d, head: 'Diesel' }, 'onaccount').head).toBe('Diesel');
    expect(changeType(changeType(d, 'onaccount'), 'credit').head).toBe('Credit');
  });

  it('builds the API body, dropping fields that do not belong to the type', () => {
    const d = { ...withAmount(emptyDraft('credit', TODAY), '1000.4'), receivedFrom: ' Fees ', paidTo: 'x', towards: 'Term 1', recipientPhone: '99' };
    const body = draftToInput(d, 'smwec');
    expect(body).toMatchObject({ college: 'smwec', type: 'credit', head: 'Credit', acName: 'Credit', receivedFrom: 'Fees', paidTo: '', recipientPhone: '', amount: 1000 });
  });
});

describe('permissions', () => {
  const mine = { type: 'debit' as const, createdBy: 'clerk' };
  const theirs = { type: 'debit' as const, createdBy: 'other' };
  const oa = { type: 'onaccount' as const, createdBy: 'other' };
  it('mirrors the server edit rules', () => {
    const user = { username: 'clerk', canEdit: false, isAdmin: false };
    expect(canEditVoucher(mine, user)).toBe(false);
    expect(canEditVoucher(oa, user)).toBe(true);
    expect(canEditVoucher(mine, { ...user, canEdit: true })).toBe(true);
    expect(canEditVoucher(theirs, { ...user, canEdit: true })).toBe(false);
    expect(canEditVoucher(theirs, { ...user, canEdit: true, isAdmin: true })).toBe(true);
  });
  it('needs delete_voucher to delete', () => {
    expect(canDeleteVoucher(mine, { username: 'clerk', canDelete: false, isAdmin: true })).toBe(false);
    expect(canDeleteVoucher(theirs, { username: 'clerk', canDelete: true, isAdmin: false })).toBe(false);
    expect(canDeleteVoucher(oa, { username: 'clerk', canDelete: true, isAdmin: false })).toBe(true);
  });
});

const voucher: Voucher = {
  id: 7,
  voucherNo: 'SMGG-DV-2026-00007',
  college: 'smgg',
  type: 'debit',
  date: '2026-11-19',
  head: 'Electricity',
  acName: '',
  receivedFrom: '',
  paidTo: '<img src=x onerror=alert(1)>',
  vendorId: '',
  recipientPhone: '',
  reversalDate: '',
  towards: 'November electricity bill for the main block and hostel buildings including street lights',
  block: 'A',
  amount: 1500,
  amtWords: 'One Thousand Five Hundred Rupees Only',
  mode: 'Cheque',
  cheque: '000123',
  prepBy: 'Clerk',
  checkedBy: 'Accounts Officer',
  remarks: '',
  createdBy: 'clerk',
  createdByLabel: 'clerk',
  createdAt: '',
  updatedAt: '',
};

describe('printing', () => {
  it('escapes every user-entered value', () => {
    const html = buildVoucherHtml(voucher, undefined, { color: false });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(esc(voucher.paidTo));
    expect(html).toContain('DEBIT VOUCHER');
    expect(html).toContain('19/11/2026');
    expect(html).toContain("ST. MARY'S GROUP OF INSTITUTIONS GUNTUR");
    expect(html).toContain('Ref: 000123');
  });

  it('uses the campus letterhead and colour setting', () => {
    const html = buildVoucherHtml({ ...voucher, college: 'smwec', type: 'credit', receivedFrom: 'Fees' }, undefined, { color: true });
    expect(html).toContain("ST. MARY'S WOMEN'S ENGINEERING COLLEGE");
    expect(html).toContain('CREDIT VOUCHER');
    expect(html).toContain('Deposited by');
    expect(html).toContain('#7B1D2E');
  });

  it('spreads "towards" over three dotted lines', () => {
    const lines = towardsLines(voucher.towards);
    expect(lines[0].length).toBeLessThanOrEqual(52);
    expect(lines.filter(Boolean).join(' ')).toBe(voucher.towards);
  });

  it('prints two copies on A4 "2 per page"', () => {
    const doc = buildPrintDocument('<div class="smv-voucher">X</div>', 'a4_double');
    expect(doc.match(/smv-voucher">X/g)).toHaveLength(2);
    expect(buildPrintDocument('X', 'a5')).toContain('148mm 210mm');
    expect(doc).not.toContain('<script');
  });

  it('builds an ESC/POS receipt with init and cut commands and plain ASCII', () => {
    const bytes = buildEscPosVoucher({ ...voucher, paidTo: 'Ravi ₹' }, undefined);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x41, 0x10]);
    expect(bytes.every((b) => b < 0x80)).toBe(true);
    expect(new TextDecoder().decode(bytes)).toContain('Rs. 1500');
  });
});
