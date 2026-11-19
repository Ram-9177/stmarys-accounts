/**
 * Excel exports (SheetJS, loaded on demand so it is not in the main bundle).
 * Layouts follow the legacy doExcel / exportLedger / doCashBook / doExcelMine.
 * Note: the free SheetJS build ignores cell styling, so (as before) only column
 * widths, merges and number formats are applied.
 */
import type { WorkBook, WorkSheet } from 'xlsx';
import type { College, Voucher } from '@/api/types';
import { collegeShort } from '@/lib/colleges';
import { dateTime, dmy } from '@/lib/format';
import { amountOf, fileDate, ledgerByHead, periodLabel, type CashBook, type DateRange } from './calc';

type XLSXModule = typeof import('xlsx');
const loadXLSX = (): Promise<XLSXModule> => import('xlsx');

const typeLabel = (t: string) => (t === 'credit' ? 'Credit' : t === 'debit' ? 'Debit' : 'On- Account');
const oaStatus = (v: Voucher) => (v.type === 'onaccount' ? (v.reversalDate ? 'Cleared' : 'Pending') : '');
const collegeTitle = (c: College | undefined) => (c?.name || "St. Mary's Group of Institutions").toUpperCase();

/** One row per voucher, legacy "Vouchers" sheet columns. */
export function voucherSheetRows(vouchers: Voucher[]) {
  return vouchers.map((v, i) => ({
    'S.No': i + 1,
    Date: dmy(v.date),
    'Voucher Type': typeLabel(v.type),
    'Account Name / Credit A/c': v.acName || '',
    'Account Head / Debit A/c': v.head || '',
    'Received From': v.receivedFrom || '',
    'Paid To': v.paidTo || '',
    'Receiver Phone': v.recipientPhone || '',
    'On Account Status': oaStatus(v),
    'Reverse / Cleared Date': dmy(v.reversalDate),
    'Towards (Purpose)': v.towards || '',
    Block: v.block || '',
    'Amount (Rs.)': amountOf(v),
    'Amount in Words': v.amtWords || '',
    'Payment Mode': v.mode || '',
    'Cheque / Ref No.': v.cheque || '',
    'Checked By': v.checkedBy || '',
    Remarks: v.remarks || '',
    'Created By': v.createdByLabel || v.createdBy || '',
    'Created At': v.createdAt ? dateTime(v.createdAt) : '',
  }));
}

const VOUCHER_COLS = [5, 12, 13, 22, 28, 22, 22, 18, 18, 20, 42, 14, 14, 40, 13, 18, 18, 28, 13, 22].map((wch) => ({ wch }));

/** Workbook with "Vouchers" + "Summary" sheets. */
export function buildVouchersWorkbook(
  X: XLSXModule,
  vouchers: Voucher[],
  opts: { college: College | undefined; title?: string; range?: DateRange },
): WorkBook {
  const ws = X.utils.json_to_sheet(voucherSheetRows(vouchers));
  ws['!cols'] = VOUCHER_COLS;
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Vouchers');

  const total = vouchers.reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const counts: Record<string, number> = { Debit: 0, 'On- Account': 0, Credit: 0 };
  const amounts: Record<string, number> = { Debit: 0, 'On- Account': 0, Credit: 0 };
  for (const v of vouchers) {
    const k = typeLabel(v.type);
    counts[k] += 1;
    amounts[k] += Number(v.amount) || 0;
  }
  const r = opts.range;
  const rangeLine = r && (r.from || r.to) ? `Date Range: ${r.from ? dmy(r.from) : '…'} to ${r.to ? dmy(r.to) : '…'}` : 'Date Range: All';
  const summary = [
    [collegeTitle(opts.college), '', ''],
    [`${opts.title || 'Voucher Export'} — ${dmy(new Date().toISOString().slice(0, 10))}`, '', ''],
    [rangeLine, '', ''],
    ['', '', ''],
    ['SUMMARY', '', ''],
    ['Total Vouchers', vouchers.length, ''],
    ['Total Amount (Rs.)', total, ''],
    ['', '', ''],
    ['Voucher Type', 'Count', 'Total Amount (Rs.)'],
    ['Debit', counts.Debit, amounts.Debit],
    ['On- Account', counts['On- Account'], amounts['On- Account']],
    ['Credit', counts.Credit, amounts.Credit],
    ['', '', ''],
    ['Grand Total', vouchers.length, total],
  ];
  const ws2 = X.utils.aoa_to_sheet(summary);
  ws2['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 20 }];
  X.utils.book_append_sheet(wb, ws2, 'Summary');
  return wb;
}

/** Downloads the given vouchers as an .xlsx file (legacy "Export Excel" layout). CONTRACT - keep this signature. */
export async function exportVouchersExcel(
  vouchers: Voucher[],
  opts: { college: College | undefined; title?: string; fileName?: string; range?: DateRange },
): Promise<void> {
  if (!vouchers.length) throw new Error('No vouchers to export.');
  const X = await loadXLSX();
  const wb = buildVouchersWorkbook(X, vouchers, opts);
  X.writeFile(wb, opts.fileName || `StMarys_Vouchers_${fileDate()}.xlsx`, { bookType: 'xlsx' });
}

/** Bytes of the vouchers workbook - used by "Link Excel" to overwrite the linked file. */
export async function vouchersWorkbookBytes(vouchers: Voucher[], college: College | undefined): Promise<ArrayBuffer> {
  const X = await loadXLSX();
  return X.write(buildVouchersWorkbook(X, vouchers, { college }), { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

/** Legacy doExcelMine: the user's own vouchers, compact columns. */
export async function exportMyVouchersExcel(vouchers: Voucher[], label: string): Promise<void> {
  if (!vouchers.length) throw new Error('No vouchers to export.');
  const X = await loadXLSX();
  const rows = vouchers.map((v) => ({
    Date: dmy(v.date),
    Type: v.type,
    'Party/Account': v.paidTo || v.receivedFrom || v.acName || '',
    'Receiver Phone': v.recipientPhone || '',
    'On Account Status': oaStatus(v),
    'Reverse / Cleared Date': dmy(v.reversalDate),
    Head: v.head || '',
    Towards: v.towards || '',
    Block: v.block || '',
    Amount: amountOf(v),
    Mode: v.mode || '',
    'Prepared By': v.prepBy || '',
    'Checked By': v.checkedBy || '',
  }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), 'My Vouchers');
  X.writeFile(wb, `${label || 'My'}_Vouchers_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function safeSheetName(name: string, taken: string[]): string {
  let n = name.substring(0, 31).replace(/[\\/?*[\]:]/g, ' ').trim() || 'Unknown';
  if (taken.includes(n)) {
    let i = 1;
    while (taken.includes(`${n.substring(0, 28)}_${i}`)) i++;
    n = `${n.substring(0, 28)}_${i}`;
  }
  return n;
}

/** Legacy exportLedger: "All Heads" summary sheet first, then one sheet per head (cash vs cheque). */
export async function exportLedgerExcel(vouchers: Voucher[], opts: { college: College | undefined; collegeCode: string }): Promise<void> {
  if (!vouchers.length) throw new Error('No vouchers match the current filter to export.');
  const X = await loadXLSX();
  const ledger = ledgerByHead(vouchers);
  const collName = `${collegeShort(opts.collegeCode)} Ledger`;
  const dateRangeStr = `Date ${dmy(ledger.minDate)} to ${dmy(ledger.maxDate)}`;
  const wb = X.utils.book_new();

  const all: unknown[][] = [[], [], [], []];
  const r5: unknown[] = [];
  r5[6] = `${collName}                            ${dateRangeStr}`;
  all.push(r5, []);
  const r7: unknown[] = [];
  r7[6] = 'All Heads';
  r7[7] = 'Cash Amount';
  r7[8] = 'Cheque Amount';
  all.push(r7);

  const headSheets: [string, WorkSheet][] = [];
  for (const h of ledger.heads) {
    const data: unknown[][] = [[], [], [], []];
    const t: unknown[] = [];
    t[1] = `${collName} - ${h.head}`;
    t[2] = dateRangeStr;
    data.push(t, ['Date', 'Head', 'Particulars', 'Cash Amount', 'Cheque Amount']);
    for (const e of h.entries) data.push([dmy(e.date), h.head, e.particulars, e.cash ?? '', e.bank ?? '']);
    const tot: unknown[] = [];
    tot[2] = 'Total';
    tot[3] = h.cash;
    tot[4] = h.bank;
    data.push([], [], tot);
    const ws = X.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 14 }, { wch: 25 }, { wch: 60 }, { wch: 14 }, { wch: 14 }];
    headSheets.push([h.head, ws]);

    const row: unknown[] = [];
    row[6] = h.head;
    row[7] = h.cash;
    row[8] = h.bank;
    all.push(row);
  }
  const gt: unknown[] = [];
  gt[6] = 'Grand Total';
  gt[7] = ledger.cash;
  gt[8] = ledger.bank;
  all.push([], [], [], gt);
  const wsAll = X.utils.aoa_to_sheet(all);
  wsAll['!cols'] = [5, 5, 5, 5, 5, 5, 30, 12, 12].map((wch) => ({ wch }));
  X.utils.book_append_sheet(wb, wsAll, 'All Heads');
  for (const [name, ws] of headSheets) X.utils.book_append_sheet(wb, ws, safeSheetName(name, wb.SheetNames));

  X.writeFile(wb, `Ledger_Report_${fileDate()}.xlsx`);
}

/** Legacy 9-column date-wise cash book: receipts (left) vs payments (right). */
export async function exportCashBookExcel(cb: CashBook, opts: { college: College | undefined; range: DateRange }): Promise<void> {
  if (!cb.count) throw new Error('No vouchers match the selected period.');
  const X = await loadXLSX();
  const label = opts.college?.name || "St. Mary's Group";
  const aoa: unknown[][] = [
    [`${label} Cash Book`, '', '', '', '', '', '', '', ''],
    [periodLabel(opts.range, dmy), '', '', '', '', '', '', '', ''],
    ['Date', 'Particulars', 'Cash Amount', 'Cheque Amount', 'Date', 'Head Account', 'Particulars', 'Cash Amount', 'Cheque Amount'],
  ];
  if (opts.range.from) {
    aoa.push(['', 'Opening balance (b/f)', cb.opening.cash, cb.opening.bank, '', '', '', '', '']);
  }
  for (const { receipt: r, payment: p } of cb.rows) {
    aoa.push([
      r ? dmy(r.date) : '',
      r?.particulars ?? '',
      r?.cash ?? '',
      r?.bank ?? '',
      p ? dmy(p.date) : '',
      p?.voucher.head ?? '',
      p?.particulars ?? '',
      p?.cash ?? '',
      p?.bank ?? '',
    ]);
  }
  const t = cb.totals;
  aoa.push(['Total', '', t.rcvCash, t.rcvBank, 'Total', '', '', t.payCash, t.payBank]);
  aoa.push(['', 'Closing balance (c/f)', cb.closing.cash, cb.closing.bank, '', '', '', '', '']);

  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [13, 42, 14, 14, 13, 22, 46, 14, 14].map((wch) => ({ wch }));
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
  ];
  // Thousands separators on amount columns.
  const range = X.utils.decode_range(ws['!ref'] as string);
  for (let R = 3; R <= range.e.r; R++) {
    for (const C of [2, 3, 7, 8]) {
      const cell = ws[X.utils.encode_cell({ r: R, c: C })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0';
    }
  }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, safeSheetName(label, []));
  X.writeFile(wb, `CashBook_${collegeShort(opts.college?.code ?? '')}_${fileDate()}.xlsx`);
}
