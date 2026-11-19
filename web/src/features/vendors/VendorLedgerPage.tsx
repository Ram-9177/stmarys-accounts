import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '@/api/client';
import { useColleges, useDeleteVendor, useVendors, useVouchers } from '@/api/hooks';
import type { Vendor, Voucher } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Button, Card, ConfirmDialog, cx, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, StatCard, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { printVoucher } from '@/features/vouchers';
import { dateTime, dmy, formatINR } from '@/lib/format';
import { AgreementBadge, CollegeBadge, FileLinks, PaymentBadge, ProgressBar, useCollegeName } from './components';
import { agreementHtml, ledgerStatementHtml, printHtml } from './documents';
import { exportVendorRegister, exportVendorStatement } from './excel';
import {
  AGREEMENT_STATUS_OPTIONS,
  agreementNumber,
  agreementStatus,
  allVendorFinancials,
  maskAadhaar,
  matchesPaymentFilter,
  matchesPeriod,
  matchesVendorSearch,
  vendorPeriodEnd,
  vendorPeriodStart,
  type AgreementStatusKey,
  type PaymentFilter,
  type VendorFinancials,
} from './ledger';

export function VendorLedgerPage() {
  const { college, can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const vendorsQ = useVendors(college);
  const vouchersQ = useVouchers(college);
  const del = useDeleteVendor();

  const [query, setQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [agFilter, setAgFilter] = useState<AgreementStatusKey | ''>('');
  const [payFilter, setPayFilter] = useState<PaymentFilter>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [toDelete, setToDelete] = useState<Vendor | null>(null);

  const all = useMemo(() => allVendorFinancials(vendorsQ.data ?? [], vouchersQ.data ?? []), [vendorsQ.data, vouchersQ.data]);
  const totals = useMemo(() => {
    const agreed = all.reduce((s, f) => s + f.agreedAmount, 0);
    const paid = all.reduce((s, f) => s + f.totalPaid, 0);
    return {
      count: all.length,
      active: all.filter((f) => ['active', 'expiring_soon'].includes(agreementStatus(f.vendor).key)).length,
      agreed,
      paid,
      vouchers: all.reduce((s, f) => s + f.vouchersCount, 0),
      balance: agreed - paid,
      pct: agreed > 0 ? Math.round((paid / agreed) * 100) : 0,
    };
  }, [all]);

  const rows = useMemo(
    () =>
      all.filter(
        (f) =>
          (!vendorFilter || f.vendor.vendorId === vendorFilter) &&
          matchesPeriod(f.vendor, from, to) &&
          (!agFilter || agreementStatus(f.vendor).key === agFilter) &&
          matchesPaymentFilter(f, payFilter) &&
          matchesVendorSearch(f.vendor, query),
      ),
    [all, vendorFilter, from, to, agFilter, payFilter, query],
  );
  const filtersActive = !!(query || vendorFilter || agFilter || payFilter || from || to);

  const openId = params.get('vendor');
  const open = openId ? all.find((f) => f.vendor.vendorId === openId) ?? null : null;
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('vendor', id);
        else n.delete('vendor');
        return n;
      },
      { replace: true },
    );

  function clearFilters() {
    setQuery('');
    setVendorFilter('');
    setAgFilter('');
    setPayFilter('');
    setFrom('');
    setTo('');
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await del.mutateAsync({ college, vendorId: toDelete.vendorId });
      toast(`Vendor ${toDelete.vendorId} deleted.`);
      if (openId === toDelete.vendorId) setOpen(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setToDelete(null);
    }
  }

  const loading = vendorsQ.isLoading || vouchersQ.isLoading;
  const error = vendorsQ.error ?? vouchersQ.error;

  return (
    <div>
      <PageHeader
        title="Vendor Ledger"
        subtitle="Agreed contract value, payments through linked debit vouchers, and outstanding balance per vendor."
        actions={
          <>
            {can('manage_vendors') && (
              <Button variant="secondary" onClick={() => navigate('/vendors')}>
                ＋ New Vendor
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={!all.length}
              onClick={() => exportVendorRegister(rows.length ? rows : all, college).catch((e) => toast(errorMessage(e), 'error'))}
            >
              ⇩ Export Register
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Vendors" value={totals.count} hint={`${totals.active} active agreements`} />
        <StatCard label="Total Agreed" value={formatINR(totals.agreed)} tone="debit" />
        <StatCard label="Total Paid" value={formatINR(totals.paid)} hint={`${totals.vouchers} linked debit vouchers`} tone="credit" />
        <StatCard label="Outstanding" value={formatINR(totals.balance)} hint={`${totals.pct}% disbursed`} tone="onaccount" />
      </div>

      <Card className="mb-5">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Field label="Search" className="md:col-span-3 lg:col-span-2">
            <Input type="search" placeholder="ID, company, name, phone, PAN, GST, address, work…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label="Vendor">
            <Select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="">All Vendors</option>
              {(vendorsQ.data ?? []).map((v) => (
                <option key={v.vendorId} value={v.vendorId}>
                  {v.vendorId} - {v.companyName || v.vendorName || 'Vendor'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agreement status">
            <Select value={agFilter} onChange={(e) => setAgFilter(e.target.value as AgreementStatusKey | '')}>
              <option value="">All Agreement Statuses</option>
              {AGREEMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment status">
            <Select value={payFilter} onChange={(e) => setPayFilter(e.target.value as PaymentFilter)}>
              <option value="">All Payment Statuses</option>
              <option value="pending">Balance pending</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Fully paid</option>
              <option value="unpaid">Not paid yet</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-sand-600">
          <span>{filtersActive ? `Found ${rows.length} matching vendors` : `Showing all ${rows.length} registered vendors`}</span>
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {loading ? (
        <Spinner className="mx-auto my-10 size-8 text-maroon-700" />
      ) : error ? (
        <ErrorBox>{errorMessage(error)}</ErrorBox>
      ) : !rows.length ? (
        <EmptyState title={all.length ? 'No vendors match these filters' : 'No vendors registered yet'}>
          {all.length ? 'Clear the filters to see every vendor.' : can('manage_vendors') ? 'Add one under Vendors & Agreements.' : null}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Contact</th>
              <th>Agreed</th>
              <th>Paid</th>
              <th>Balance</th>
              <th className="w-48">Progress</th>
              <th>Agreement</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const v = f.vendor;
              return (
                <tr key={v.vendorId} className="cursor-pointer" onClick={() => setOpen(v.vendorId)}>
                  <td>
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                      {v.vendorId} <CollegeBadge code={v.college} />
                    </div>
                    <div className="font-semibold text-maroon-700">{v.companyName || '—'}</div>
                    <div className="text-xs text-sand-600">{v.vendorName || '—'}</div>
                  </td>
                  <td className="text-xs">
                    <div>📞 {v.phone || '—'}</div>
                    <div className="font-mono text-sand-600">PAN: {v.pan || '—'}</div>
                    {v.aadhaar && <div className="font-mono text-sand-600">Aadhaar: {maskAadhaar(v.aadhaar)}</div>}
                  </td>
                  <td className="font-semibold tabular text-debit">{formatINR(f.agreedAmount)}</td>
                  <td>
                    <div className="font-semibold tabular text-credit">{formatINR(f.totalPaid)}</div>
                    <div className="text-xs text-sand-600">
                      {f.vouchersCount} debit {f.vouchersCount === 1 ? 'voucher' : 'vouchers'}
                    </div>
                  </td>
                  <td>
                    <div className={cx('font-semibold tabular', f.balance <= 0 ? 'text-credit' : 'text-onaccount')}>{formatINR(f.balance)}</div>
                    <PaymentBadge fin={f} />
                  </td>
                  <td>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-semibold">{f.paidPercent}%</span>
                    </div>
                    <ProgressBar percent={f.paidPercent} />
                  </td>
                  <td className="text-xs">
                    <div className="font-medium">{dmy(vendorPeriodStart(v)) || '—'}</div>
                    <div className="text-sand-600">to {dmy(vendorPeriodEnd(v)) || '—'}</div>
                    <div className="mt-1">
                      <AgreementBadge vendor={v} />
                    </div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="grid min-w-44 grid-cols-2 gap-1">
                      <Button size="sm" onClick={() => setOpen(v.vendorId)}>
                        📂 Ledger
                      </Button>
                      {can('create_voucher') && (
                        <Button size="sm" variant="gold" onClick={() => navigate(`/vouchers/new?vendorId=${encodeURIComponent(v.vendorId)}`)}>
                          ＋ Voucher
                        </Button>
                      )}
                      {can('manage_vendors') && (
                        <Button size="sm" variant="danger" onClick={() => setToDelete(v)}>
                          🗑 Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <LedgerModal fin={open} onClose={() => setOpen(null)} canSeeIds={can('manage_vendors')} canCreateVoucher={can('create_voucher')} canPrintVoucher={can('print_voucher')} />

      <ConfirmDialog
        open={!!toDelete}
        danger
        title="Delete vendor?"
        message={
          <>
            Delete vendor <b>{toDelete?.vendorId}</b> ({toDelete?.companyName || toDelete?.vendorName}) and its ledger? Linked vouchers are kept.
          </>
        }
        confirmLabel="Delete vendor"
        loading={del.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

type Tab = 'vouchers' | 'agreement' | 'profile';

function LedgerModal({
  fin,
  onClose,
  canSeeIds,
  canCreateVoucher,
  canPrintVoucher,
}: {
  fin: VendorFinancials | null;
  onClose: () => void;
  canSeeIds: boolean;
  canCreateVoucher: boolean;
  canPrintVoucher: boolean;
}) {
  const [tab, setTab] = useState<Tab>('vouchers');
  const navigate = useNavigate();
  const toast = useToast();
  const colleges = useColleges();
  const v = fin?.vendor;
  const collegeName = useCollegeName(v?.college ?? 'smgg');

  async function printOne(p: Voucher) {
    try {
      await printVoucher(p, colleges.data?.find((c) => c.code === p.college));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <Modal
      open={!!fin}
      onClose={() => {
        setTab('vouchers');
        onClose();
      }}
      size="xl"
      title={v ? `${v.companyName || v.vendorName || 'Vendor'} — Ledger Statement` : 'Ledger'}
      footer={
        fin && v ? (
          <>
            {canCreateVoucher && (
              <Button variant="gold" onClick={() => navigate(`/vouchers/new?vendorId=${encodeURIComponent(v.vendorId)}`)}>
                ＋ Debit Voucher
              </Button>
            )}
            <Button variant="secondary" onClick={() => printHtml(agreementHtml(v, collegeName), `Agreement ${v.vendorId}`)}>
              🖨 Agreement
            </Button>
            <Button variant="secondary" onClick={() => exportVendorStatement(fin).catch((e) => toast(errorMessage(e), 'error'))}>
              ⇩ Excel
            </Button>
            <Button onClick={() => printHtml(ledgerStatementHtml(fin, collegeName), `Ledger ${v.vendorId}`)}>🖨 Print Statement</Button>
          </>
        ) : null
      }
    >
      {fin && v && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sand-800">
            <span className="rounded bg-maroon-50 px-2 py-0.5 font-mono font-semibold text-maroon-700">{v.vendorId}</span>
            <span>
              Contact: <b>{v.vendorName || '—'}</b>
            </span>
            <span>
              Phone: <b>{v.phone || '—'}</b>
            </span>
            <span>
              PAN: <b className="font-mono">{v.pan || '—'}</b>
            </span>
            <CollegeBadge code={v.college} />
            <AgreementBadge vendor={v} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Agreed Contract" value={formatINR(fin.agreedAmount)} hint={v.amountInWords || 'Rupees Only'} tone="debit" />
            <StatCard label="Total Paid" value={formatINR(fin.totalPaid)} hint={`${fin.vouchersCount} linked debit ${fin.vouchersCount === 1 ? 'voucher' : 'vouchers'}`} tone="credit" />
            <StatCard label="Balance" value={formatINR(fin.balance)} hint={`${fin.paidPercent}% disbursed of total contract`} tone="onaccount" />
          </div>

          <div role="tablist" className="flex gap-1 border-b border-sand-100">
            {(
              [
                ['vouchers', `Debit Vouchers (${fin.vouchersCount})`],
                ['agreement', 'Agreement'],
                ['profile', 'Vendor Profile'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-maroon-700 font-semibold text-maroon-700' : 'border-transparent text-sand-600 hover:text-ink')}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'vouchers' &&
            (fin.payments.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher No</th>
                    <th>Head</th>
                    <th>Towards</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                    <th>By</th>
                    {canPrintVoucher && <th />}
                  </tr>
                </thead>
                <tbody>
                  {fin.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{dmy(p.date)}</td>
                      <td className="font-mono text-xs">{p.voucherNo}</td>
                      <td>{p.head || 'Debit'}</td>
                      <td className="max-w-64 truncate" title={p.towards}>
                        {p.towards || '—'}
                      </td>
                      <td>
                        {p.mode || 'Cash'}
                        {p.cheque && <span className="text-xs text-sand-600"> (Ref: {p.cheque})</span>}
                      </td>
                      <td className="text-right font-semibold tabular text-credit">{formatINR(p.amount)}</td>
                      <td className="text-xs text-sand-600">{p.createdByLabel}</td>
                      {canPrintVoucher && (
                        <td>
                          <Button size="sm" variant="secondary" onClick={() => void printOne(p)}>
                            🖨 View
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm [&_td]:px-3 [&_td]:py-2">
                  <tr className="border-t border-sand-200">
                    <td colSpan={5} className="text-right font-semibold">
                      Total paid via debit vouchers
                    </td>
                    <td className="text-right font-semibold tabular text-credit">{formatINR(fin.totalPaid)}</td>
                    <td colSpan={canPrintVoucher ? 2 : 1} />
                  </tr>
                  <tr>
                    <td colSpan={5} className="text-right font-semibold">
                      Agreed contract value
                    </td>
                    <td className="text-right font-semibold tabular text-debit">{formatINR(fin.agreedAmount)}</td>
                    <td colSpan={canPrintVoucher ? 2 : 1} />
                  </tr>
                  <tr className="bg-maroon-50">
                    <td colSpan={5} className="text-right font-bold text-maroon-800">
                      Outstanding balance pending
                    </td>
                    <td className={cx('text-right font-bold tabular', fin.balance <= 0 ? 'text-credit' : 'text-onaccount')}>{formatINR(fin.balance)}</td>
                    <td colSpan={canPrintVoucher ? 2 : 1}>
                      <PaymentBadge fin={fin} />
                    </td>
                  </tr>
                </tfoot>
              </Table>
            ) : (
              <EmptyState title="No debit vouchers linked yet">
                Payments appear here when a debit voucher is saved with this vendor's agreement selected (dated on/after{' '}
                {dmy(vendorPeriodStart(v)) || 'the agreement start'}).
              </EmptyState>
            ))}

          {tab === 'agreement' && (
            // agreementHtml escapes every interpolated value
            <div className="overflow-x-auto bg-sand-100 p-3" dangerouslySetInnerHTML={{ __html: agreementHtml(v, collegeName) }} />
          )}

          {tab === 'profile' && (
            <div className="grid gap-4 md:grid-cols-2">
              <ProfileBlock
                title="Vendor & company"
                rows={[
                  ['Vendor ID', v.vendorId],
                  ['Company name', v.companyName],
                  ['Contact person', v.vendorName],
                  ['Phone', v.phone],
                  ['PAN', v.pan],
                  ['Aadhaar', canSeeIds ? v.aadhaar : maskAadhaar(v.aadhaar)],
                  ['Email', v.email],
                  ['Address', String(v.address ?? '')],
                ]}
              />
              <ProfileBlock
                title="Authorization & banking"
                rows={[
                  ['Agreement no', agreementNumber(v)],
                  ['GST number', v.gstNumber],
                  ['Bank details', canSeeIds ? v.bankAccountDetails : v.bankAccountDetails ? '•••• (hidden)' : ''],
                  ['Authorized by', v.authBy],
                  ['Designation', v.authRole],
                  ['Place', v.authPlace],
                  ['Remarks', v.remarks],
                  ['Created', `${dateTime(v.createdAt)}${v.createdBy ? ` by ${v.createdBy}` : ''}`],
                ]}
              />
              <div className="md:col-span-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-600">Agreement documents</p>
                <FileLinks vendor={v} college={v.college} />
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ProfileBlock({ title, rows }: { title: string; rows: [string, string | undefined][] }) {
  return (
    <div className="rounded-lg border border-sand-100 bg-sand-50 p-4">
      <h3 className="mb-2 text-base font-semibold text-maroon-800">{title}</h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-sand-600">{k}</dt>
            <dd className="break-words">{val || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
