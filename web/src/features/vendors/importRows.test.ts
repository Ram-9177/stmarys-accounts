import { describe, expect, it } from 'vitest';
import type { Vendor } from '@/api/types';
import { importTemplateHeaders, mapImportRows, parseSheetDate, vendorToSheetRow } from './importRows';

/** VendorInput's index signature widens `agreement` to unknown; read it explicitly. */
const agreementNo = (v: unknown) => (v as { agreement?: { agreementNo?: string } } | undefined)?.agreement?.agreementNo;

const existing = {
  vendorId: 'V00003',
  college: 'smgg',
  companyName: 'Old Co',
  vendorName: 'Old Name',
  phone: '9111111111',
  pan: 'ABCDE1234F',
  aadhaar: '',
  email: '',
  gstNumber: '',
  bankAccountDetails: 'SBI 123',
  workDescription: 'Old work',
  agreedAmount: 5000,
  amountInWords: 'Five Thousand Rupees Only',
  periodStart: '2026-01-01',
  periodEnd: '',
  authBy: '',
  authRole: '',
  authPlace: '',
  remarks: '',
  files: [],
  createdBy: 'baji',
  createdAt: '',
  updatedBy: null,
  updatedAt: '',
  agreement: { agreementNo: 'AGR-V00003-2026' },
} as Vendor;

describe('parseSheetDate', () => {
  it('understands the date formats people type into Excel', () => {
    expect(parseSheetDate('2026-11-19')).toBe('2026-11-19');
    expect(parseSheetDate('19/11/2026')).toBe('2026-11-19');
    expect(parseSheetDate('5-1-2026')).toBe('2026-01-05');
    expect(parseSheetDate('46345')).toBe('2026-11-19'); // Excel serial
    expect(parseSheetDate('31/02/2026')).toBe('');
    expect(parseSheetDate('soon')).toBe('');
    expect(parseSheetDate('')).toBe('');
  });
});

describe('mapImportRows', () => {
  it('creates new vendors with the next free IDs and amount in words', () => {
    const out = mapImportRows(
      [
        { 'Vendor Company Name': 'New Co', 'Agreed Amount (Rs)': '1,25,000', 'Agreement Start Date': '01/12/2026', 'PAN Number': 'pqrst6789k' },
        { Company: 'Another', Amount: 300 },
      ],
      [existing],
    );
    expect(out.map((r) => r.vendor?.vendorId)).toEqual(['V00004', 'V00005']);
    expect(out[0].vendor).toMatchObject({
      companyName: 'New Co',
      agreedAmount: 125000,
      amountInWords: 'One Lakh Twenty Five Thousand Rupees Only',
      periodStart: '2026-12-01',
      pan: 'PQRST6789K',
      status: 'Active',
    });
    expect(agreementNo(out[0].vendor)).toBe('AGR-V00004-2026');
    expect(out[0].isUpdate).toBe(false);
  });

  it('updates an existing vendor, keeping values for empty cells', () => {
    const [r] = mapImportRows([{ 'Vendor ID': 'v00003', Phone: '9222222222', Status: 'terminated' }], [existing]);
    expect(r.isUpdate).toBe(true);
    expect(r.vendor).toMatchObject({
      vendorId: 'V00003',
      companyName: 'Old Co',
      phone: '9222222222',
      bankAccountDetails: 'SBI 123',
      agreedAmount: 5000,
      amountInWords: 'Five Thousand Rupees Only',
      periodStart: '2026-01-01',
      status: 'Terminated',
    });
    expect(agreementNo(r.vendor)).toBe('AGR-V00003-2026');
  });

  it('reports row-level errors and skips blank lines', () => {
    const out = mapImportRows(
      [
        { 'Vendor ID': 'V00010', Phone: '1' },
        { 'Vendor Company Name': '', Phone: '' },
        { 'Vendor ID': 'V00011', Company: 'X', Amount: 'lots', 'Start Date': '2026-13-01' },
        { 'Vendor ID': 'V00012', Company: 'Y' },
        { 'Vendor ID': 'v-00012', Company: 'Y again' },
      ],
      [],
    );
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ rowNumber: 2, vendor: undefined });
    expect(out[0].errors[0]).toMatch(/Company name/);
    expect(out[1].errors.join(' ')).toMatch(/not a valid number/);
    expect(out[1].errors.join(' ')).toMatch(/not a valid date/);
    expect(out[2].vendor?.vendorId).toBe('V00012');
    expect(out[3].errors[0]).toMatch(/more than once/);
  });

  it('round-trips an exported row', () => {
    const row = vendorToSheetRow(existing);
    for (const h of importTemplateHeaders()) expect(row).toHaveProperty(h);
    const [r] = mapImportRows([row], [existing]);
    expect(r.vendor).toMatchObject({ vendorId: 'V00003', companyName: 'Old Co', agreedAmount: 5000, periodStart: '2026-01-01' });
  });
});
