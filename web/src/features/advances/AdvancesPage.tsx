import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '@/api/client';
import { useAdvances } from '@/api/hooks';
import type { AdvanceState } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Icon } from '@/components/icons';
import { Badge, Button, cx, EmptyState, ErrorBox, Input, PageHeader, Spinner, StatCard, Table } from '@/components/ui';
import { dmy, formatINR } from '@/lib/format';
import { PayeeKindBadge, StatePill } from './shared';

type Filter = 'all' | 'prepared' | 'with_payee' | 'to_recover' | 'closed' | 'planned' | 'cancelled';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prepared', label: 'Waiting for approval' },
  { value: 'with_payee', label: 'With payee' },
  { value: 'to_recover', label: 'To recover' },
  { value: 'closed', label: 'Settled' },
  { value: 'planned', label: 'Planned' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** The advance register (F9 "Advances on account": given, settled, to recover, overdue). */
export function AdvancesPage() {
  const { college, can } = useSession();
  const navigate = useNavigate();
  const advances = useAdvances(college);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (advances.data?.advances ?? []).filter((a) => {
      if (filter !== 'all' && a.state !== (filter as AdvanceState)) return false;
      if (!term) return true;
      return [a.advanceNo, a.payee.name, a.caseNo, a.poNo, a.purpose].some((v) => v.toLowerCase().includes(term));
    });
  }, [advances.data, filter, q]);
  const s = advances.data?.summary;
  const count = (f: Filter) => (advances.data?.advances ?? []).filter((a) => f === 'all' || a.state === f).length;

  return (
    <>
      <PageHeader
        title="On Account"
        subtitle="Money first, goods later, then settle. Every advance, what is settled against bills and what is to recover."
        actions={
          can('manage_advances') && (
            <Button icon={<Icon name="plus" className="size-4" />} onClick={() => navigate('/advances/new')}>
              New advance
            </Button>
          )
        }
      />

      {s && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Given" value={formatINR(s.given)} hint="All paid advances" />
          <StatCard label="Settled" value={formatINR(s.settled)} hint="Against bills, or returned" tone="credit" />
          <StatCard label="With payees" value={formatINR(s.outstanding - s.toRecover)} hint="Not yet due" tone="onaccount" />
          <StatCard label="To recover" value={formatINR(s.toRecover)} hint={`${s.overdue} past the settle-by date`} tone="debit" />
          <StatCard label="Waiting for approval" value={s.awaitingApproval} hint={`${s.planned} planned, not prepared`} tone="gold" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* The shell's .segmented */}
        <div role="group" aria-label="Show" className="inline-flex max-w-full flex-wrap gap-0.5 rounded-full bg-surface-1 p-[3px] shadow-card">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cx(
                'h-9 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap',
                filter === f.value ? 'bg-fg text-bg' : 'text-muted hover:text-fg',
              )}
            >
              {f.label}
              {advances.data && <span className="ml-1.5 font-mono text-[11px] opacity-70">{count(f.value)}</span>}
            </button>
          ))}
        </div>
        <Input placeholder="Search payee, advance, case or PO…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72 rounded-full" aria-label="Search advances" />
      </div>

      {advances.isLoading ? (
        <Spinner className="mx-auto my-10 size-8 text-accent" />
      ) : advances.error ? (
        <ErrorBox>{errorMessage(advances.error)}</ErrorBox>
      ) : !rows.length ? (
        <EmptyState title={filter === 'all' && !q ? 'No advances yet' : 'Nothing matches'}>
          {filter === 'all' && !q ? 'Advances planned in Accounts or sent from MRF at clearance show here.' : 'Try another filter.'}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Advance</th>
              <th>Payee</th>
              <th>Where it stands</th>
              <th>For</th>
              <th>Paid on</th>
              <th className="text-right">Given</th>
              <th className="text-right">Settled</th>
              <th className="text-right">To recover</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="cursor-pointer" onClick={() => navigate(`/advances/${a.id}`)}>
                <td>
                  <Link to={`/advances/${a.id}`} className="font-mono text-[12.5px] font-medium text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                    {a.advanceNo}
                  </Link>
                  {a.source === 'mrf' && (
                    <Badge tone="maroon" className="ml-2">
                      MRF
                    </Badge>
                  )}
                </td>
                <td>
                  <div className="font-semibold text-fg">{a.payee.name}</div>
                  <PayeeKindBadge kind={a.payee.kind} />
                </td>
                <td>
                  <StatePill advance={a} />
                </td>
                <td className="max-w-56 whitespace-normal">
                  {(a.caseNo || a.poNo) && <div className="font-mono text-xs text-ink-50">{[a.caseNo, a.poNo].filter(Boolean).join(' · ')}</div>}
                  <div className="truncate">{a.purpose || '—'}</div>
                </td>
                <td>{a.payment?.datePaid ? dmy(a.payment.datePaid) : '—'}</td>
                <td className="text-right font-mono tabular">{a.status === 'paid' ? formatINR(a.figures.given) : <span className="text-ink-40">{formatINR(a.amount)}</span>}</td>
                <td className="text-right font-mono tabular">{formatINR(a.figures.settled)}</td>
                <td className={cx('text-right font-mono tabular', a.figures.toRecover > 0 && 'font-semibold text-danger')}>{formatINR(a.figures.toRecover)}</td>
                <td className={cx(a.figures.overdue && 'font-semibold text-danger')}>{a.figures.dueDate ? dmy(a.figures.dueDate) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
