import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '@/api/client';
import { useColleges, useDeleteVoucher, useSaveVoucher, useVouchers } from '@/api/hooks';
import type { Voucher } from '@/api/types';
import { isVoucherAdmin, useSession } from '@/auth/AuthProvider';
import { Badge, Button, ConfirmDialog, cx, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { exportVouchersExcel } from '@/features/reports';
import { dateTime, dmy, formatINR, todayISO, voucherParty } from '@/lib/format';
import { canDeleteVoucher, canEditVoucher, PAYMENT_MODES, voucherToInput } from './draft';
import {
  defaultFilters,
  emptyFilters,
  filterVouchers,
  isCashMode,
  isOwnVoucher,
  sortVouchers,
  voucherSummaryText,
  voucherTotals,
  voucherUsers,
  type VoucherFilters,
} from './filters';
import { usePrintAction } from './usePrintAction';

const TYPE_TONE = { debit: 'debit', credit: 'credit', onaccount: 'onaccount' } as const;

export function VoucherListPage({ scope }: { scope: 'all' | 'mine' }) {
  const { user, college, can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const colleges = useColleges();
  const vouchers = useVouchers(college);
  const save = useSaveVoucher();
  const remove = useDeleteVoucher();
  const printer = usePrintAction();
  const [filters, setFilters] = useState<VoucherFilters>(() => defaultFilters(todayISO()));
  const [toDelete, setToDelete] = useState<Voucher | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const admin = isVoucherAdmin(user);
  const perms = { username: user.username, canEdit: can('edit_voucher'), canDelete: can('delete_voucher'), isAdmin: admin };

  const base = useMemo(
    () => (scope === 'mine' ? (vouchers.data ?? []).filter((v) => isOwnVoucher(v, user.username)) : (vouchers.data ?? [])),
    [vouchers.data, scope, user.username],
  );
  const rows = useMemo(() => sortVouchers(filterVouchers(base, filters)), [base, filters]);
  const totals = useMemo(() => voucherTotals(rows), [rows]);
  const heads = useMemo(() => [...new Set(base.map((v) => v.head).filter(Boolean))].sort(), [base]);
  const users = useMemo(() => voucherUsers(base), [base]);

  const set = <K extends keyof VoucherFilters>(k: K, v: VoucherFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  /** Legacy: choosing an on-account status switches to On Account and clears the dates. */
  const setOaStatus = (v: VoucherFilters['oaStatus']) =>
    setFilters((f) => (v ? { ...f, oaStatus: v, type: 'onaccount', from: '', to: '' } : { ...f, oaStatus: '' }));

  async function setReversal(v: Voucher, date: string) {
    if (date && date < v.date) {
      toast('Reverse / cleared date cannot be before the voucher date', 'error');
      return;
    }
    setSavingId(v.id);
    try {
      await save.mutateAsync({ ...voucherToInput(v, { reversalDate: date }), id: v.id });
      toast(date ? `Marked cleared on ${dmy(date)}` : 'Marked pending again');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function doDelete() {
    if (!toDelete) return;
    try {
      await remove.mutateAsync({ id: toDelete.id, college: toDelete.college });
      toast('Voucher deleted');
      setToDelete(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function copy(v: Voucher) {
    try {
      await navigator.clipboard.writeText(voucherSummaryText(v));
      toast('Voucher details copied');
    } catch {
      toast('Copy is not available in this browser', 'error');
    }
  }

  async function doExport() {
    setExporting(true);
    try {
      await exportVouchersExcel(rows, {
        college: colleges.data?.find((c) => c.code === college),
        title: scope === 'mine' ? 'My Vouchers' : 'Vouchers',
        fileName: `${scope === 'mine' ? user.displayName + '_' : ''}Vouchers_${todayISO()}.xlsx`,
      });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  }

  const title = scope === 'mine' ? `${user.fullName || user.displayName} — My Vouchers` : 'All Vouchers';
  const showUserCol = scope === 'all';

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={vouchers.data ? `Showing ${rows.length} of ${base.length} vouchers · live sync every 30s` : undefined}
        actions={
          <>
            {can('export_excel') && (
              <Button variant="secondary" onClick={doExport} loading={exporting} disabled={!rows.length}>
                ⇩ Export Excel
              </Button>
            )}
            {can('create_voucher') && <Button onClick={() => navigate('/vouchers/new')}>＋ New Voucher</Button>}
          </>
        }
      />

      <div className="no-print mb-4 grid gap-2 rounded-xl border border-sand-100 bg-surface-1 p-3 shadow-card sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search party, head, towards, no…"
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          className="sm:col-span-2"
        />
        <Input type="date" aria-label="From date" title="From date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        <Input type="date" aria-label="To date" title="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
        <Select aria-label="Voucher type" value={filters.type} onChange={(e) => set('type', e.target.value as VoucherFilters['type'])}>
          <option value="">All types</option>
          <option value="debit">Debit</option>
          <option value="credit">Credit</option>
          <option value="onaccount">On Account</option>
        </Select>
        <Select aria-label="On account status" value={filters.oaStatus} onChange={(e) => setOaStatus(e.target.value as VoucherFilters['oaStatus'])}>
          <option value="">OA status: any</option>
          <option value="pending">OA pending</option>
          <option value="cleared">OA cleared</option>
        </Select>
        <Select aria-label="Account head" value={filters.head} onChange={(e) => set('head', e.target.value)}>
          <option value="">All heads</option>
          {heads.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </Select>
        <Select aria-label="Payment mode" value={filters.mode} onChange={(e) => set('mode', e.target.value)}>
          <option value="">All modes</option>
          {PAYMENT_MODES.map((m) => (
            <option key={m} value={m.toLowerCase()}>
              {m}
            </option>
          ))}
        </Select>
        {showUserCol && (
          <Select aria-label="Created by" value={filters.user} onChange={(e) => set('user', e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.username} value={u.username}>
                {u.label}
              </option>
            ))}
          </Select>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setFilters(defaultFilters(todayISO()))}>
            Today
          </Button>
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setFilters(emptyFilters)}>
            Clear
          </Button>
        </div>
      </div>

      {vouchers.isLoading ? (
        <Spinner className="mx-auto mt-16 size-8 text-maroon-700" />
      ) : vouchers.error ? (
        <ErrorBox>{errorMessage(vouchers.error)}</ErrorBox>
      ) : !rows.length ? (
        <EmptyState title="No vouchers found">
          {base.length ? (
            <>
              Try another date range or{' '}
              <button type="button" className="text-maroon-700 underline" onClick={() => setFilters(emptyFilters)}>
                clear the filters
              </button>
              .
            </>
          ) : can('create_voucher') ? (
            <Link to="/vouchers/new" className="text-maroon-700 underline">
              Create the first voucher
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Status</th>
              <th>Party / Account</th>
              <th>Head</th>
              <th>Mode</th>
              <th className="text-right">Cash</th>
              <th className="text-right">Cheque/Bank</th>
              <th className="text-right">Credit</th>
              {showUserCol && <th>Created by</th>}
              <th className="no-print">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const amount = Math.round(v.amount);
              const cleared = v.type === 'onaccount' && !!v.reversalDate;
              const editable = canEditVoucher(v, perms);
              return (
                <tr key={v.id} className={cx(cleared && 'bg-success-tint/50')}>
                  <td className="whitespace-nowrap">
                    <div className="font-semibold">{dmy(v.date)}</div>
                    <div className="text-[11px] text-sand-600">{v.voucherNo}</div>
                  </td>
                  <td>
                    <Badge tone={TYPE_TONE[v.type]}>{v.type === 'onaccount' ? 'ON ACCOUNT' : v.type.toUpperCase()}</Badge>
                  </td>
                  <td>
                    {v.type !== 'onaccount' ? (
                      <span className="text-sand-400">–</span>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={cleared ? 'success' : 'onaccount'}>{cleared ? 'CLEAR' : 'PENDING'}</Badge>
                        <input
                          type="date"
                          aria-label={`Reverse / cleared date for ${v.voucherNo}`}
                          title="Set the reverse / cleared date to mark this advance as clear"
                          value={v.reversalDate}
                          min={v.date}
                          disabled={!editable || savingId === v.id}
                          onChange={(e) => setReversal(v, e.target.value)}
                          className="h-7 rounded border border-sand-200 px-1 text-[11px] disabled:opacity-50"
                        />
                      </div>
                    )}
                  </td>
                  <td className="max-w-56">
                    <div className="truncate" title={voucherParty(v)}>
                      {voucherParty(v) || '–'}
                    </div>
                    {v.recipientPhone && <div className="text-[11px] text-sand-600">☎ {v.recipientPhone}</div>}
                    {v.vendorId && <Badge tone="maroon" className="mt-0.5">📒 {v.vendorId}</Badge>}
                    <div className="truncate text-[11px] text-sand-600" title={v.towards}>
                      {v.towards}
                    </div>
                  </td>
                  <td className="max-w-36 truncate text-xs" title={v.head}>
                    {v.head || '–'}
                  </td>
                  <td className="text-xs">
                    {v.mode || 'Cash'}
                    {v.cheque && <div className="text-[11px] text-sand-600">{v.cheque}</div>}
                  </td>
                  <td className="tabular text-right font-semibold">{v.type !== 'credit' && isCashMode(v) ? formatINR(amount) : '–'}</td>
                  <td className="tabular text-right font-semibold">{v.type !== 'credit' && !isCashMode(v) ? formatINR(amount) : '–'}</td>
                  <td className="tabular text-right font-semibold">{v.type === 'credit' ? formatINR(amount) : '–'}</td>
                  {showUserCol && (
                    <td className="text-xs">
                      <div>{v.createdByLabel}</div>
                      <div className="text-[10px] text-sand-600">{dateTime(v.createdAt)}</div>
                    </td>
                  )}
                  <td className="no-print">
                    <div className="flex gap-1">
                      {can('print_voucher') && (
                        <IconButton label="Print" onClick={() => printer.print(v)}>
                          🖨
                        </IconButton>
                      )}
                      <IconButton label="View" onClick={() => printer.view(v)}>
                        👁
                      </IconButton>
                      <IconButton label="Copy details" onClick={() => copy(v)}>
                        📋
                      </IconButton>
                      {editable && (
                        <IconButton label="Edit" onClick={() => navigate(`/vouchers/${v.id}/edit`)}>
                          ✏️
                        </IconButton>
                      )}
                      {canDeleteVoucher(v, perms) && (
                        <IconButton label="Delete" danger onClick={() => setToDelete(v)}>
                          🗑
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-sand-200 bg-sand-50 font-bold text-maroon-800 [&_td]:px-3 [&_td]:py-2">
            <tr>
              <td colSpan={6} className="text-right text-ink">
                MODE TOTALS:
              </td>
              <td className="tabular text-right">
                <small className="block text-[10px] text-sand-600">CASH</small>
                {formatINR(totals.cash)}
              </td>
              <td className="tabular text-right">
                <small className="block text-[10px] text-sand-600">CHEQUE / BANK</small>
                {formatINR(totals.cheque)}
              </td>
              <td className="tabular text-right">
                <small className="block text-[10px] text-sand-600">CREDIT</small>
                {formatINR(totals.credit)}
              </td>
              <td colSpan={showUserCol ? 2 : 1} />
            </tr>
            <tr className="text-base">
              <td colSpan={6} className="text-right text-ink">
                GRAND TOTAL:
              </td>
              <td colSpan={2} className="tabular text-right">
                DEBIT: {formatINR(totals.debit)}
              </td>
              <td className="tabular text-right">CREDIT: {formatINR(totals.credit)}</td>
              <td colSpan={showUserCol ? 2 : 1} className="text-xs font-normal text-sand-600">
                {totals.onAccountPending ? `OA pending ${formatINR(totals.onAccountPending)}` : ''}
              </td>
            </tr>
          </tfoot>
        </Table>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this voucher?"
        message={
          toDelete && (
            <>
              <b>{toDelete.voucherNo}</b> — {voucherParty(toDelete)} — {formatINR(toDelete.amount)} on {dmy(toDelete.date)}.
              <br />
              It will disappear from all lists and reports (kept in the audit log).
            </>
          )
        }
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
      {printer.modal}
    </div>
  );
}

function IconButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx('rounded-md border px-2 py-1 text-sm', danger ? 'border-danger/30 text-danger hover:bg-danger-tint' : 'border-line hover:bg-surface-2')}
    >
      {children}
    </button>
  );
}
