import { useMemo, useState } from 'react';
import { useVouchers } from '@/api/hooks';
import { useSession } from '@/auth/AuthProvider';
import { Card, ErrorBox, PageHeader, Spinner } from '@/components/ui';
import { formatINR } from '@/lib/format';
import { filterByDate, monthLabel, monthlyVolume, topHeads, typeSplit, type DateRange } from './calc';
import { ColumnChart, DonutChart, HBarChart } from './charts';
import { DateRangeFilter } from './shared';

const TYPE_COLORS = { debit: '#7a3800', onaccount: '#880e4f', credit: '#1b4f9e' } as const;

export function AnalyticsPage() {
  const { college } = useSession();
  const vouchers = useVouchers(college);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const list = useMemo(() => filterByDate(vouchers.data ?? [], range), [vouchers.data, range]);
  const heads = useMemo(() => topHeads(list), [list]);
  const split = useMemo(() => typeSplit(list), [list]);
  const months = useMemo(() => monthlyVolume(list).map((m) => ({ ...m, label: monthLabel(m.month) })), [list]);

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Expenditure insights & voucher trends"
        actions={<DateRangeFilter value={range} onChange={setRange} idPrefix="analytics" />}
      />
      {vouchers.error && <ErrorBox>{(vouchers.error as Error).message}</ErrorBox>}
      {vouchers.isLoading ? (
        <div className="flex justify-center py-12 text-maroon-700">
          <Spinner className="size-8" />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Top Heads by Amount" className="xl:col-span-2">
            <HBarChart title="Top account heads by amount" data={heads} format={formatINR} />
          </Card>
          <Card title="Voucher Type Split">
            <DonutChart
              title="Voucher type split"
              centerLabel={String(list.length)}
              data={split.map((s) => ({ label: s.label, value: s.count, color: TYPE_COLORS[s.type], hint: formatINR(s.amount) }))}
            />
          </Card>
          <Card title="Monthly Volume">
            <ColumnChart title="Vouchers per month" data={months} formatAmount={formatINR} />
          </Card>
        </div>
      )}
    </div>
  );
}
