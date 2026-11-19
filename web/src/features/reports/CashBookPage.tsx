import { useMemo, useState } from 'react';
import { useColleges, useVouchers } from '@/api/hooks';
import type { College } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Button, Card, cx, ErrorBox, PageHeader, Spinner, StatCard, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dmy, formatNumber } from '@/lib/format';
import { buildCashBook, periodLabel, presetRange, type CashBook, type DatePreset, type DateRange } from './calc';
import { exportCashBookExcel } from './excel';
import { DateRangeFilter, escapeHtml, printHtml } from './shared';

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'month', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'fy', label: 'This FY' },
  { id: 'all', label: 'All Dates' },
];

const rs = (n: number) => `₹ ${formatNumber(n)}`;
const signed = (n: number) => `${n >= 0 ? '+' : '-'} ₹ ${formatNumber(Math.abs(n))}`;

/**
 * Institutional cash book: receipts (credit vouchers) on the left, payments
 * (debit + on-account) on the right, as in the legacy Date-Wise Ledger modal.
 */
export function CashBookPage() {
  const { college } = useSession();
  const toast = useToast();
  const vouchers = useVouchers(college);
  const colleges = useColleges();
  const collegeObj = colleges.data?.find((c) => c.code === college);
  // Legacy default: 1st of the current month to today.
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const [busy, setBusy] = useState(false);
  const cb = useMemo(() => buildCashBook(vouchers.data ?? [], range), [vouchers.data, range]);
  const t = cb.totals;

  async function exportExcel() {
    setBusy(true);
    try {
      await exportCashBookExcel(cb, { college: collegeObj, range });
      toast('Cash Book exported');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="📒 Institutional Cash Book"
        subtitle="Date-Wise Ledger · receipts vs payments"
        actions={
          <>
            <Button variant="secondary" onClick={() => printHtml(cashBookPrintHtml(cb, collegeObj, range))} disabled={!cb.count}>
              🖨 Print Cash Book
            </Button>
            <Button onClick={exportExcel} loading={busy} disabled={!cb.count}>
              📥 Export to Excel
            </Button>
          </>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} idPrefix="cashbook" />
          <span className="text-xs font-semibold uppercase text-sand-600">Presets:</span>
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant="ghost" onClick={() => setRange(presetRange(p.id))}>
              {p.label}
            </Button>
          ))}
        </div>
      </Card>

      {vouchers.error && <ErrorBox>{(vouchers.error as Error).message}</ErrorBox>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Transactions" value={cb.count} hint={periodLabel(range, dmy)} />
        <StatCard label="Receipts" value={rs(t.receipts)} hint={`Cash: ₹${formatNumber(t.rcvCash)} | Bank: ₹${formatNumber(t.rcvBank)}`} tone="credit" />
        <StatCard label="Payments" value={rs(t.payments)} hint={`Cash: ₹${formatNumber(t.payCash)} | Bank: ₹${formatNumber(t.payBank)}`} tone="debit" />
        <StatCard
          label="Net (period)"
          value={<span className={t.net >= 0 ? 'text-credit' : 'text-debit'}>{signed(t.net)}</span>}
          hint={`Net Cash: ₹${formatNumber(t.netCash)} | Net Bank: ₹${formatNumber(t.netBank)}`}
          tone="gold"
        />
      </div>

      {range.from && (
        <p className="mb-4 text-sm text-sand-600">
          Opening balance before {dmy(range.from)}: <b className="tabular">{signed(cb.opening.total)}</b> (cash {signed(cb.opening.cash)}, bank{' '}
          {signed(cb.opening.bank)}) · Closing balance: <b className="tabular">{signed(cb.closing.total)}</b>
        </p>
      )}

      <Card title="Daily Transaction Summary" className="mb-5">
        {cb.byDate.length ? (
          <div className="flex flex-wrap gap-2">
            {cb.byDate.map((d) => (
              <span key={d.date} className="inline-flex items-center gap-2 rounded-full border border-sand-200 bg-white px-3 py-1 text-xs">
                <b className="text-[#002d72]">📅 {dmy(d.date)}</b>
                <span className="rounded-full bg-sky-50 px-2 font-bold text-sky-700">{d.count} trans.</span>
                <span className="text-credit">
                  ({d.receipts} In / {d.payments} Out)
                </span>
                <b className="tabular">₹ {formatNumber(d.amount)}</b>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-sand-600">No transactions found for the selected period.</p>
        )}
      </Card>

      {vouchers.isLoading ? (
        <div className="flex justify-center py-10 text-maroon-700">
          <Spinner className="size-8" />
        </div>
      ) : (
        <CashBookTable cb={cb} />
      )}
    </div>
  );
}

function CashBookTable({ cb }: { cb: CashBook }) {
  const t = cb.totals;
  const amt = (n: number | null | undefined) => (n == null ? '' : formatNumber(n));
  return (
    <Table>
      <thead>
        <tr>
          <th colSpan={4} className="text-center">
            Receipts
          </th>
          <th colSpan={5} className="border-l-2 border-sand-200 text-center">
            Payments
          </th>
        </tr>
        <tr>
          <th>Date</th>
          <th>Particulars</th>
          <th className="text-right">Cash Amount</th>
          <th className="text-right">Cheque Amount</th>
          <th className="border-l-2 border-sand-200">Date</th>
          <th>Head Account</th>
          <th>Particulars</th>
          <th className="text-right">Cash Amount</th>
          <th className="text-right">Cheque Amount</th>
        </tr>
      </thead>
      <tbody>
        {!cb.rows.length ? (
          <tr>
            <td colSpan={9} className="py-10 text-center text-sand-600">
              No transactions match the selected date range.
            </td>
          </tr>
        ) : (
          cb.rows.map(({ receipt: r, payment: p }, i) => (
            <tr key={i} className="align-top text-xs">
              <td className="whitespace-nowrap text-center font-semibold text-[#002d72]">{r ? dmy(r.date) : ''}</td>
              <td className="max-w-72 whitespace-normal">{r?.particulars}</td>
              <td className="text-right font-semibold text-credit tabular">{amt(r?.cash)}</td>
              <td className="text-right font-semibold text-sky-700 tabular">{amt(r?.bank)}</td>
              <td className="whitespace-nowrap border-l-2 border-sand-200 text-center font-semibold text-[#002d72]">{p ? dmy(p.date) : ''}</td>
              <td className="whitespace-nowrap font-semibold text-maroon-700">{p?.voucher.head}</td>
              <td className="max-w-72 whitespace-normal">{p?.particulars}</td>
              <td className="text-right font-semibold text-debit tabular">{amt(p?.cash)}</td>
              <td className="text-right font-semibold text-sky-700 tabular">{amt(p?.bank)}</td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr className={cx('bg-sand-100 font-bold [&>td]:px-3 [&>td]:py-2')}>
          <td colSpan={2} className="text-center">
            Total Receipts
          </td>
          <td className="text-right text-credit tabular">₹ {formatNumber(t.rcvCash)}</td>
          <td className="text-right text-sky-700 tabular">₹ {formatNumber(t.rcvBank)}</td>
          <td colSpan={3} className="border-l-2 border-sand-200 text-center">
            Total Payments
          </td>
          <td className="text-right text-debit tabular">₹ {formatNumber(t.payCash)}</td>
          <td className="text-right text-sky-700 tabular">₹ {formatNumber(t.payBank)}</td>
        </tr>
      </tfoot>
    </Table>
  );
}

/** A4 landscape print document (legacy printCashBook). Every value is escaped. */
export function cashBookPrintHtml(cb: CashBook, college: College | undefined, range: DateRange): string {
  const e = escapeHtml;
  const n = (x: number | null | undefined) => (x == null ? '' : e(formatNumber(x)));
  const label = college?.name || "St. Mary's Group of Institutions";
  const period = periodLabel(range, dmy).replace(/^Period: /, '');
  const days = cb.byDate
    .map((d) => `<span class="badge"><b>${e(dmy(d.date))}</b> · ${d.count} trans. (${d.receipts} In / ${d.payments} Out) · ₹ ${n(d.amount)}</span>`)
    .join('');
  const rows = cb.rows
    .map(
      ({ receipt: r, payment: p }) => `<tr>
      <td class="c">${r ? e(dmy(r.date)) : ''}</td><td>${e(r?.particulars ?? '')}</td><td class="num">${n(r?.cash)}</td><td class="num">${n(r?.bank)}</td>
      <td class="c sep">${p ? e(dmy(p.date)) : ''}</td><td>${e(p?.voucher.head ?? '')}</td><td>${e(p?.particulars ?? '')}</td><td class="num">${n(p?.cash)}</td><td class="num">${n(p?.bank)}</td></tr>`,
    )
    .join('');
  const t = cb.totals;
  const opening = range.from
    ? `<p class="sub">Opening balance (before ${e(dmy(range.from))}): ₹ ${n(cb.opening.total)} &nbsp;·&nbsp; Closing balance: ₹ ${n(cb.closing.total)}</p>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cash Book - ${e(label)}</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; font-size: 10pt; }
    h1 { text-align: center; margin: 0 0 4px; font-size: 15pt; color: #7B1D2E; }
    .sub { text-align: center; margin: 0 0 8px; font-size: 10pt; color: #333; }
    .days { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
    .badge { border: 1px solid #ccc; padding: 2px 6px; font-size: 8pt; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th, td { border: 1px solid #777; padding: 4px 6px; vertical-align: top; }
    th { background: #f2e8ea; font-weight: bold; text-align: center; }
    .num { text-align: right; white-space: nowrap; } .c { text-align: center; white-space: nowrap; } .sep { border-left: 2px solid #333; }
    tfoot td { font-weight: bold; background: #f2e8ea; }
  </style></head><body>
    <h1>${e(label)}</h1>
    <p class="sub"><strong>CASH BOOK</strong> &bull; Period: ${e(period)}</p>
    ${opening}
    <div style="font-size:8.5pt;margin-bottom:4px"><strong>Daily Transaction Summary:</strong></div>
    <div class="days">${days}</div>
    <table><thead><tr><th>Date</th><th>Particulars</th><th>Cash Amount</th><th>Cheque Amount</th><th class="sep">Date</th><th>Head Account</th><th>Particulars</th><th>Cash Amount</th><th>Cheque Amount</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9" class="c">No transactions</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2" class="c">Total Receipts</td><td class="num">₹ ${n(t.rcvCash)}</td><td class="num">₹ ${n(t.rcvBank)}</td>
    <td colspan="3" class="c sep">Total Payments</td><td class="num">₹ ${n(t.payCash)}</td><td class="num">₹ ${n(t.payBank)}</td></tr></tfoot></table>
  </body></html>`;
}
