/** SheetJS helpers for vendors. SheetJS is loaded on demand so it stays out of the main bundle. */
import type { Vendor } from '@/api/types';
import { todayISO } from '@/lib/format';
import { importTemplateHeaders, vendorToSheetRow } from './importRows';
import type { VendorFinancials } from './ledger';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Vendor';

async function writeBook(sheets: { name: string; rows: Record<string, unknown>[]; header?: string[] }[], fileName: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows, s.header ? { header: s.header } : undefined);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

/** Master register: one row per vendor with ledger totals (legacy "Export All Vendor Ledgers"). */
export async function exportVendorRegister(list: VendorFinancials[], collegeCode: string) {
  const rows = list.map((f, i) => vendorToSheetRow(f.vendor, f, i));
  await writeBook([{ name: 'Vendor Ledger Register', rows }], `StMarys_${collegeCode.toUpperCase()}_Master_Vendor_Ledger_${todayISO()}.xlsx`);
}

/** Vendor master list in the import layout (can be edited and re-imported). */
export async function exportVendorsForImport(vendors: Vendor[], collegeCode: string) {
  const rows = vendors.map((v) => vendorToSheetRow(v));
  await writeBook([{ name: 'Vendors', rows }], `StMarys_${collegeCode.toUpperCase()}_Vendors_${todayISO()}.xlsx`);
}

export async function downloadImportTemplate() {
  await writeBook([{ name: 'Vendors', rows: [], header: importTemplateHeaders() }], 'Vendor_Import_Template.xlsx');
}

/** One vendor's statement (legacy "Export Ledger to Excel"). */
export async function exportVendorStatement(fin: VendorFinancials) {
  const v = fin.vendor;
  const rows: Record<string, unknown>[] = fin.payments.map((p, i) => ({
    'S.No': i + 1,
    'Voucher No': p.voucherNo,
    Date: p.date,
    'Debit Head': p.head,
    'Towards / Purpose': p.towards,
    'Payment Mode': p.mode,
    'Cheque / Ref No': p.cheque,
    'Amount Paid (Rs)': Number(p.amount) || 0,
    'Entered By': p.createdByLabel,
  }));
  rows.push({});
  rows.push({ 'Towards / Purpose': 'TOTAL AMOUNT PAID:', 'Amount Paid (Rs)': fin.totalPaid });
  rows.push({ 'Towards / Purpose': 'AGREED CONTRACT VALUE:', 'Amount Paid (Rs)': fin.agreedAmount });
  rows.push({ 'Towards / Purpose': 'OUTSTANDING BALANCE REMAINING:', 'Amount Paid (Rs)': fin.balance });
  await writeBook([{ name: 'Vendor Ledger', rows }], `${safeName(v.vendorId)}_${safeName(v.companyName || 'Ledger')}_Statement.xlsx`);
}

/** Reads the first sheet of an .xlsx/.xls/.csv file into header-keyed rows (dates as yyyy-mm-dd text). */
export async function readVendorSheet(file: File): Promise<Record<string, unknown>[]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('The file is larger than 5 MB.');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Choose an Excel (.xlsx / .xls) or CSV file.');
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[first], { raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
}
