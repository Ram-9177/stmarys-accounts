/**
 * Excel import/export mapping for vendors (pure - no SheetJS here so it is easy to test).
 * The export layout doubles as the import template.
 */
import type { Vendor, VendorInput } from '@/api/types';
import { amountInWords } from '@/lib/format';
import { isoDate, newAgreementNumber, nextVendorId, normVendorId, PAN_RE, vendorPeriodEnd, vendorPeriodStart, type VendorFinancials } from './ledger';

type Field = keyof Pick<
  VendorInput,
  | 'vendorId'
  | 'companyName'
  | 'vendorName'
  | 'phone'
  | 'pan'
  | 'aadhaar'
  | 'email'
  | 'address'
  | 'workDescription'
  | 'agreedAmount'
  | 'amountInWords'
  | 'periodStart'
  | 'periodEnd'
  | 'gstNumber'
  | 'bankAccountDetails'
  | 'authBy'
  | 'authRole'
  | 'authPlace'
  | 'remarks'
  | 'status'
>;

/** Column header -> field. First header is what we export; the rest are accepted aliases on import. */
export const VENDOR_COLUMNS: { field: Field; headers: string[] }[] = [
  { field: 'vendorId', headers: ['Vendor ID', 'VendorId', 'ID'] },
  { field: 'companyName', headers: ['Vendor Company Name', 'Company Name', 'Company'] },
  { field: 'vendorName', headers: ['Contact Person', 'Vendor Name', 'Name'] },
  { field: 'phone', headers: ['Phone Number', 'Phone', 'Mobile'] },
  { field: 'pan', headers: ['PAN Number', 'PAN'] },
  { field: 'aadhaar', headers: ['Aadhaar Number', 'Aadhaar'] },
  { field: 'email', headers: ['Email', 'Email Address'] },
  { field: 'address', headers: ['Address', 'Vendor Address'] },
  { field: 'workDescription', headers: ['Work Description', 'Scope of Work'] },
  { field: 'agreedAmount', headers: ['Agreed Amount (Rs)', 'Agreed Amount', 'Amount'] },
  { field: 'amountInWords', headers: ['Amount in Words'] },
  { field: 'periodStart', headers: ['Agreement Start Date', 'Start Date', 'Period Start'] },
  { field: 'periodEnd', headers: ['Agreement End Date', 'End Date', 'Period End'] },
  { field: 'gstNumber', headers: ['GST Number', 'GST'] },
  { field: 'bankAccountDetails', headers: ['Bank Account Details', 'Bank Details'] },
  { field: 'authBy', headers: ['Authorized By'] },
  { field: 'authRole', headers: ['Designation', 'Authorized Role'] },
  { field: 'authPlace', headers: ['Place', 'Authorized Place'] },
  { field: 'remarks', headers: ['Remarks'] },
  { field: 'status', headers: ['Agreement Status (Active/Completed/Terminated)', 'Status'] },
];

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_TO_FIELD = new Map<string, Field>();
for (const c of VENDOR_COLUMNS) for (const h of c.headers) HEADER_TO_FIELD.set(headerKey(h), c.field);

/** Excel serial day number (1900 system) -> ISO date. */
function excelSerialToIso(n: number): string {
  const ms = Math.round((n - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Accepts ISO, DD/MM/YYYY, DD-MM-YYYY, Excel serials and Date objects. Returns '' if not a valid date. */
export function parseSheetDate(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const s = String(value).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const iso = isoDate(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : '';
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value ?? '').replace(/[₹,\s]|rs\.?/gi, ''));
  return Number.isFinite(n) ? n : NaN;
}

const text = (v: unknown, max = 1000) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export interface ImportedRow {
  /** 1-based spreadsheet row number (header is row 1). */
  rowNumber: number;
  vendor?: VendorInput;
  /** true if the row updates an existing vendor */
  isUpdate?: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Converts sheet rows (objects keyed by header text) into vendor inputs.
 * - Rows without a Vendor ID get the next free ID.
 * - Rows whose Vendor ID already exists update that vendor; blank cells keep the existing value.
 * - Duplicate Vendor IDs inside the sheet are rejected.
 */
export function mapImportRows(rows: Record<string, unknown>[], existing: Vendor[]): ImportedRow[] {
  const byId = new Map(existing.map((v) => [normVendorId(v.vendorId), v]));
  const usedIds = existing.map((v) => ({ vendorId: v.vendorId }));
  const seen = new Set<string>();
  const out: ImportedRow[] = [];

  rows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const cells: Partial<Record<Field, unknown>> = {};
    for (const [h, val] of Object.entries(raw)) {
      const f = HEADER_TO_FIELD.get(headerKey(h));
      if (f && val !== '' && val != null) cells[f] = val;
    }
    if (!Object.keys(cells).length) return; // blank line

    const errors: string[] = [];
    const warnings: string[] = [];
    let vendorId = text(cells.vendorId, 50).toUpperCase();
    if (!vendorId) {
      vendorId = nextVendorId(usedIds);
    }
    const key = normVendorId(vendorId);
    if (seen.has(key)) errors.push(`Vendor ID ${vendorId} appears more than once in the sheet`);
    seen.add(key);
    usedIds.push({ vendorId });

    const prev = byId.get(key);
    const pick = (f: Field, max = 1000) => (cells[f] !== undefined ? text(cells[f], max) : prev ? text(prev[f], max) : '');

    const companyName = pick('companyName', 250);
    const vendorName = pick('vendorName', 250);
    if (!companyName && !vendorName) errors.push('Company name or contact person is required');

    let agreedAmount = prev ? Number(prev.agreedAmount) || 0 : 0;
    if (cells.agreedAmount !== undefined) {
      agreedAmount = parseAmount(cells.agreedAmount);
      if (!Number.isFinite(agreedAmount) || agreedAmount < 0) {
        errors.push(`Agreed amount "${String(cells.agreedAmount)}" is not a valid number`);
        agreedAmount = 0;
      }
    }

    const dateField = (f: 'periodStart' | 'periodEnd', label: string, fallback: string) => {
      if (cells[f] === undefined) return fallback;
      const d = parseSheetDate(cells[f]);
      if (!d) errors.push(`${label} "${String(cells[f])}" is not a valid date (use DD/MM/YYYY)`);
      return d;
    };
    const periodStart = dateField('periodStart', 'Start date', prev ? vendorPeriodStart(prev) : '');
    const periodEnd = dateField('periodEnd', 'End date', prev ? vendorPeriodEnd(prev) : '');
    if (periodStart && periodEnd && periodEnd < periodStart) errors.push('End date is before start date');

    const pan = pick('pan', 50).toUpperCase();
    if (pan && !PAN_RE.test(pan)) warnings.push(`PAN "${pan}" is not in the standard format`);
    const aadhaar = pick('aadhaar', 50);
    if (aadhaar && !/^\d{12}$/.test(aadhaar.replace(/\s+/g, ''))) warnings.push('Aadhaar is not a 12-digit number');

    const statusRaw = pick('status', 30);
    const status = /^term/i.test(statusRaw) ? 'Terminated' : /^comp/i.test(statusRaw) ? 'Completed' : 'Active';

    const vendor: VendorInput = {
      vendorId,
      companyName,
      vendorName,
      phone: pick('phone', 50),
      pan,
      aadhaar,
      email: pick('email', 120),
      address: pick('address', 500),
      workDescription: pick('workDescription', 1000),
      agreedAmount,
      amountInWords: cells.amountInWords !== undefined ? text(cells.amountInWords, 500) : cells.agreedAmount !== undefined || !prev ? amountInWords(agreedAmount) : prev.amountInWords,
      periodStart,
      periodEnd,
      agreementDate: periodStart,
      gstNumber: pick('gstNumber', 50).toUpperCase(),
      bankAccountDetails: pick('bankAccountDetails', 500),
      authBy: pick('authBy', 120),
      authRole: pick('authRole', 120),
      authPlace: pick('authPlace', 120) || 'Chebrolu / Guntur',
      remarks: pick('remarks', 1000),
      status,
      agreement: {
        ...(prev?.agreement ?? {}),
        agreementNo: prev?.agreement?.agreementNo || newAgreementNumber(vendorId, periodStart),
        agreementDate: periodStart,
        periodStart,
        periodEnd,
      },
    };
    out.push({ rowNumber, vendor: errors.length ? undefined : vendor, isUpdate: !!prev, errors, warnings });
  });
  return out;
}

/** One spreadsheet row per vendor, with ledger totals when available (master register export). */
export function vendorToSheetRow(v: Vendor, fin?: VendorFinancials, index?: number): Record<string, string | number> {
  const row: Record<string, string | number> = {};
  if (index !== undefined) row['S.No'] = index + 1;
  row['Vendor ID'] = v.vendorId;
  row['College'] = (v.college || '').toUpperCase();
  row['Vendor Company Name'] = v.companyName;
  row['Contact Person'] = v.vendorName;
  row['Phone Number'] = v.phone;
  row['PAN Number'] = v.pan;
  row['Aadhaar Number'] = v.aadhaar;
  row['Email'] = v.email;
  row['Address'] = String(v.address ?? '');
  row['Work Description'] = v.workDescription;
  row['Agreed Amount (Rs)'] = Number(v.agreedAmount) || 0;
  row['Amount in Words'] = v.amountInWords;
  if (fin) {
    row['Total Paid to Date (Rs)'] = fin.totalPaid;
    row['Outstanding Balance (Rs)'] = fin.balance;
    row['Disbursed %'] = `${fin.paidPercent}%`;
    row['Linked Debit Vouchers Count'] = fin.vouchersCount;
    row['Payment Status'] = fin.status;
  }
  row['Agreement Start Date'] = vendorPeriodStart(v);
  row['Agreement End Date'] = vendorPeriodEnd(v);
  row['GST Number'] = v.gstNumber;
  row['Bank Account Details'] = v.bankAccountDetails;
  row['Authorized By'] = v.authBy;
  row['Designation'] = v.authRole;
  row['Place'] = v.authPlace;
  row['Remarks'] = v.remarks;
  row['Agreement Status (Active/Completed/Terminated)'] = String(v.status || 'Active');
  return row;
}

/** Empty template with just the import headers. */
export function importTemplateHeaders(): string[] {
  return VENDOR_COLUMNS.map((c) => c.headers[0]);
}
