import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useColleges, useVendors, useVouchers } from '@/api/hooks';
import type { Voucher } from '@/api/types';
import { isVoucherAdmin, useSession } from '@/auth/AuthProvider';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Spinner, StatCard, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { printVoucher } from '@/features/vouchers';
import { dateTime, dmy, formatINR, voucherParty } from '@/lib/format';
import { dashboardStats, filterByDate, isCashMode, isOwnVoucher, recentVouchers, type DateRange } from './calc';
import { exportMyVouchersExcel } from './excel';
import { DateRangeFilter, TypeBadge, VendorBadge } from './shared';

/** Admin dashboard: every voucher of the current college. */
export function DashboardPage() {
  return <DashboardView scope="all" />;
}

/** User dashboard: own vouchers plus the shared on-account ones (legacy _isOwnVoucher). */
export function MyDashboardPage() {
  return <DashboardView scope="mine" />;
}

function DashboardView({ scope }: { scope: 'all' | 'mine' }) {
  const { user, college, can } = useSession();
  const toast = useToast();
  const vouchers = useVouchers(college);
  const colleges = useColleges();
  const canVendors = isVoucherAdmin(user) || can('view_vendor_ledger') || can('manage_vendors');
  const vendors = useVendors(college, canVendors);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const collegeObj = colleges.data?.find((c) => c.code === college);
  const mine = scope === 'mine';

  const base = useMemo(() => {
    const list = vouchers.data ?? [];
    return mine ? list.filter((v) => isOwnVoucher(v, user.username)) : list;
  }, [vouchers.data, mine, user.username]);
  const filtered = useMemo(() => filterByDate(base, range), [base, range]);
  const stats = useMemo(() => dashboardStats(filtered), [filtered]);
  const recent = useMemo(() => recentVouchers(filtered), [filtered]);
  const filteredLabel = range.from || range.to ? 'Filtered' : 'All time';

  async function print(v: Voucher) {
    try {
      await printVoucher(v, collegeObj);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function exportMine() {
    try {
      await exportMyVouchersExcel(filtered, user.displayName);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const title = mine ? `${user.fullName || user.displayName} — Dashboard` : 'Dashboard';

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`Today: ${dateTime(new Date(), true)}`}
        actions={
          <>
            <DateRangeFilter value={range} onChange={setRange} idPrefix={`dash-${scope}`} />
            {canVendors && (
              <Link
                to="/vendor-ledger"
                className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-[13px] font-semibold text-accent-fg shadow-card hover:brightness-110"
              >
                📒 Vendor Ledger
              </Link>
            )}
            {mine && can('export_excel') && (
              <Button size="sm" variant="secondary" onClick={exportMine} disabled={!filtered.length}>
                ⇩ Export my vouchers
              </Button>
            )}
          </>
        }
      />

      {vouchers.error && <ErrorBox>{(vouchers.error as Error).message}</ErrorBox>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <StatCard label={mine ? 'My Vouchers' : 'Total Vouchers'} value={stats.count} hint={filteredLabel} />
        <StatCard label={mine ? 'My Total Amount' : 'Total Amount'} value={formatINR(stats.amount)} hint={filteredLabel} tone="gold" />
        <StatCard label="Today" value={stats.today} hint={mine ? 'My vouchers today' : 'Vouchers today'} />
        <StatCard label="Debit" value={stats.debit.count} hint={`Payments · ${formatINR(stats.debit.amount)}`} tone="debit" />
        <StatCard
          label="On- Account"
          value={stats.onaccount.count}
          hint={`${stats.onaccount.open} open · ${stats.onaccount.cleared} cleared`}
          tone="onaccount"
        />
        <StatCard label="Credit" value={stats.credit.count} hint={`Received · ${formatINR(stats.credit.amount)}`} tone="credit" />
        {canVendors && (
          <Link to="/vendor-ledger" className="block rounded-xl focus-visible:outline-2" title="View Vendor Ledger">
            <StatCard label="📒 Vendors" value={vendors.data?.length ?? '–'} hint="Vendor Ledger" />
          </Link>
        )}
      </div>

      <Card
        title={mine ? 'My Recent Vouchers' : 'Recent Vouchers'}
        actions={
          <Link to={mine ? '/my-vouchers' : '/vouchers'} className="text-sm font-medium text-maroon-700 hover:underline">
            View All →
          </Link>
        }
      >
        {vouchers.isLoading ? (
          <div className="flex justify-center py-8 text-maroon-700">
            <Spinner />
          </div>
        ) : !recent.length ? (
          <EmptyState title="No vouchers yet">{range.from || range.to ? 'Nothing in this date range.' : 'Vouchers you save will appear here.'}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Account</th>
                <th>Head</th>
                <th>Payment Mode</th>
                {mine ? (
                  <>
                    <th className="text-right">Cash Amount</th>
                    <th className="text-right">Cheque Amount</th>
                    <th className="text-right">Credit</th>
                  </>
                ) : (
                  <th className="text-right">Amount</th>
                )}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((v) => {
                const isCredit = v.type === 'credit';
                const cash = !isCredit && isCashMode(v);
                return (
                  <tr key={v.id}>
                    <td className="font-semibold">{dmy(v.date)}</td>
                    <td>
                      <TypeBadge type={v.type} />
                    </td>
                    <td>
                      {voucherParty(v) || '–'}
                      <VendorBadge vendorId={v.vendorId} />
                    </td>
                    <td className="max-w-40 truncate text-xs" title={v.head}>
                      {v.head || '–'}
                    </td>
                    <td>{v.mode || 'Cash'}</td>
                    {mine ? (
                      <>
                        <td className="text-right font-semibold tabular">{cash ? formatINR(v.amount) : '–'}</td>
                        <td className="text-right font-semibold tabular">{!isCredit && !cash ? formatINR(v.amount) : '–'}</td>
                        <td className="text-right font-semibold tabular">{isCredit ? formatINR(v.amount) : '–'}</td>
                      </>
                    ) : (
                      <td className="text-right font-semibold tabular">{formatINR(v.amount)}</td>
                    )}
                    <td>
                      {can('print_voucher') && (
                        <Button size="sm" variant="secondary" onClick={() => print(v)} title="Print" aria-label={`Print voucher ${v.voucherNo}`}>
                          🖨
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
