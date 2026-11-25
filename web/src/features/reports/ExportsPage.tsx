import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useColleges, useVouchers } from '@/api/hooks';
import type { VoucherType } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Button, Card, ErrorBox, Field, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { formatINR } from '@/lib/format';
import { filterByDate, type DateRange } from './calc';
import { exportLedgerExcel, exportVouchersExcel } from './excel';
import { DateRangeFilter } from './shared';

export function ExportsPage() {
  const { college, can } = useSession();
  const toast = useToast();
  const vouchers = useVouchers(college);
  const colleges = useColleges();
  const collegeObj = colleges.data?.find((c) => c.code === college);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [type, setType] = useState<'' | VoucherType>('');
  const [busy, setBusy] = useState<'' | 'all' | 'ledger'>('');

  const list = useMemo(() => {
    const byDate = filterByDate(vouchers.data ?? [], range);
    // Export oldest first, like the legacy sheets (S.No 1 = earliest).
    return (type ? byDate.filter((v) => v.type === type) : byDate).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }, [vouchers.data, range, type]);
  const total = list.reduce((s, v) => s + (Number(v.amount) || 0), 0);

  async function run(kind: 'all' | 'ledger') {
    setBusy(kind);
    try {
      if (kind === 'all') await exportVouchersExcel(list, { college: collegeObj, range });
      else await exportLedgerExcel(list, { college: collegeObj, collegeCode: college });
      toast(kind === 'all' ? 'Excel exported' : 'Ledger Report exported');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <PageHeader title="Excel Exports" subtitle="Download vouchers for the current college as Excel workbooks" />
      {vouchers.error && <ErrorBox>{(vouchers.error as Error).message}</ErrorBox>}
      <Card className="mb-5" title="Filter">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Date range">
            <DateRangeFilter value={range} onChange={setRange} idPrefix="exports" />
          </Field>
          <Field label="Voucher type" htmlFor="exports-type">
            <Select id="exports-type" value={type} onChange={(e) => setType(e.target.value as '' | VoucherType)} className="w-44">
              <option value="">All types</option>
              <option value="debit">Debit</option>
              <option value="onaccount">On Account</option>
              <option value="credit">Credit</option>
            </Select>
          </Field>
          <p className="pb-2 text-sm text-sand-600">
            {vouchers.isLoading ? 'Loading…' : `${list.length} vouchers · ${formatINR(total)}`}
          </p>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-3">
        <Card title="All Vouchers">
          <p className="mb-4 text-sm text-sand-600">Every voucher with all fields, plus a Summary sheet with totals by type.</p>
          <Button onClick={() => run('all')} loading={busy === 'all'} disabled={!list.length}>
            ⇩ Export Excel
          </Button>
        </Card>
        <Card title="Ledger Report">
          <p className="mb-4 text-sm text-sand-600">“All Heads” summary plus one sheet per account head, split into cash and cheque.</p>
          <Button onClick={() => run('ledger')} loading={busy === 'ledger'} disabled={!list.length}>
            ⇩ Export Ledger
          </Button>
        </Card>
        {can('cash_book') && (
          <Card title="Cash Book">
            <p className="mb-4 text-sm text-sand-600">Date-wise receipts vs payments with print and Excel export.</p>
            <Link to="/cash-book" className="inline-flex h-12 items-center rounded-lg bg-accent px-5 text-[14.5px] font-semibold text-accent-fg shadow-card hover:brightness-110">
              Open Cash Book →
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
