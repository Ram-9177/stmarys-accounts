import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { errorMessage } from '@/api/client';
import {
  useAdvance,
  useAdvanceSettings,
  useApproveAdvance,
  useBillsFinal,
  useCancelAdvance,
  usePrepareAdvance,
  useRecordReturn,
  useSendBackAdvance,
  useSetOffBill,
  useVouchers,
} from '@/api/hooks';
import type { AdvanceDetail, PaymentForm } from '@/api/types';
import { PAYMENT_FORMS } from '@/api/types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Table, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dateTime, dmy, formatINR, todayISO } from '@/lib/format';
import { emptyPayment, FiguresStrip, PayeeKindBadge, PaymentFields, paymentProblem, StatePill, type PaymentDraft } from './shared';

type Dialog = null | 'prepare' | 'approve' | 'sendBack' | 'cancel' | 'setOff' | 'return' | 'billsFinal';

export function AdvanceDetailPage() {
  const id = Number(useParams().id);
  const advance = useAdvance(id);
  const [dialog, setDialog] = useState<Dialog>(null);

  if (advance.isLoading) return <Spinner className="mx-auto my-10 size-8 text-accent" />;
  if (advance.error || !advance.data) {
    return <ErrorBox>{advance.error ? errorMessage(advance.error) : 'Advance not found'}</ErrorBox>;
  }
  const a = advance.data;
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link to="/advances" className="text-[13px] font-semibold text-accent hover:underline">
          ← On Account
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[22px] font-medium tracking-[-0.01em]">{a.advanceNo}</span>
            <StatePill advance={a} />
            {a.source === 'mrf' && <Badge tone="maroon">From MRF</Badge>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-fg">{a.payee.name}</b>
            <PayeeKindBadge kind={a.payee.kind} />
            {a.purpose && <span>· {a.purpose}</span>}
          </span>
        }
        actions={<Actions a={a} open={setDialog} />}
      />

      <Notices a={a} />
      <FiguresStrip advance={a} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <Card title="The plan and the payment">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Payee">
                {a.payee.name}
                {a.payee.phone && <span className="text-ink-50"> · {a.payee.phone}</span>}
              </Item>
              {a.payee.kind === 'vendor' && <Item label="Vendor code (MRF)">{a.payee.vendorCode || '—'}</Item>}
              <Item label="Amount">{formatINR(a.amount)}</Item>
              <Item label="Settle by">{a.settleBy ? dmy(a.settleBy) : '—'}</Item>
              <Item label="Who recovers">{a.recoveredBy || '—'}</Item>
              <Item label="MRF case · PO">{[a.caseNo, a.poNo].filter(Boolean).join(' · ') || '—'}</Item>
              <Item label="Planned form">{a.plannedForm || '—'}</Item>
              <Item label="Payment">
                {a.payment?.form ? (
                  <>
                    {a.payment.form}
                    {a.payment.reference && <span className="font-mono"> · {a.payment.reference}</span>}
                    {a.payment.bank && <span> · {a.payment.bank}</span>}
                    {a.payment.receivedBy && <span> · received by {a.payment.receivedBy}</span>}
                  </>
                ) : (
                  '—'
                )}
              </Item>
              <Item label="Paid on">{a.payment?.datePaid ? dmy(a.payment.datePaid) : '—'}</Item>
              <Item label="Voucher">
                <VoucherNo college={a.college} id={a.voucherId} />
              </Item>
              <Item label="Prepared by">{a.preparedBy ? `${a.preparedBy} · ${dateTime(a.preparedAt)}` : '—'}</Item>
              <Item label="Approved by">{a.approvedBy ? `${a.approvedBy} · ${dateTime(a.approvedAt)}` : '—'}</Item>
            </dl>
          </Card>

          <Card title="Settled against bills, or returned">
            {a.settlements.length ? (
              <Table className="shadow-none">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th className="text-right">Bill total</th>
                    <th className="text-right">Amount</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {a.settlements.map((s) => (
                    <tr key={s.id}>
                      <td>{dmy(s.date)}</td>
                      <td>
                        {s.kind === 'bill' ? (
                          <>
                            Bill <b className="font-mono">{s.billNo}</b>
                            {s.billDate && <span className="text-ink-50"> of {dmy(s.billDate)}</span>}
                          </>
                        ) : s.kind === 'returned' ? (
                          <>Money returned{s.form && ` · ${s.form}`}</>
                        ) : (
                          'Cleared before settlements were tracked'
                        )}
                        {s.reference && <div className="font-mono text-xs text-ink-50">{s.reference}</div>}
                        {s.notes && <div className="text-xs text-ink-50">{s.notes}</div>}
                      </td>
                      <td className="text-right font-mono tabular">{s.billTotal ? formatINR(s.billTotal) : '—'}</td>
                      <td className="text-right font-mono font-semibold tabular">{formatINR(s.amount)}</td>
                      <td>{s.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="Nothing settled yet">
                {a.status === 'paid' ? 'Set it against the bills as they come, or record the money returned.' : 'Settling starts once the advance is paid.'}
              </EmptyState>
            )}
          </Card>
        </div>

        <Card title="Track">
          <ol className="flex flex-col">
            {a.track.map((t, i) => (
              <li key={i} className="relative border-l-2 border-hair pb-4 pl-5 last:pb-0">
                <span className="absolute top-1 -left-[7px] size-3 rounded-full bg-accent ring-4 ring-surface-1" aria-hidden />
                <p className="text-sm font-semibold text-fg">{trackLabel(t.action, t.details)}</p>
                <p className="text-xs text-ink-50">
                  {t.actor} · {dateTime(t.at)}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <PrepareDialog a={a} open={dialog === 'prepare'} onClose={close} />
      <ApproveDialog a={a} open={dialog === 'approve'} onClose={close} />
      <ReasonDialog a={a} kind="sendBack" open={dialog === 'sendBack'} onClose={close} />
      <ReasonDialog a={a} kind="cancel" open={dialog === 'cancel'} onClose={close} />
      <SetOffDialog a={a} open={dialog === 'setOff'} onClose={close} />
      <ReturnDialog a={a} open={dialog === 'return'} onClose={close} />
      <BillsFinalDialog a={a} open={dialog === 'billsFinal'} onClose={close} />
    </div>
  );
}

function Actions({ a, open }: { a: AdvanceDetail; open: (d: Dialog) => void }) {
  const out = a.figures.outstanding > 0;
  return (
    <>
      {a.can.prepare && <Button onClick={() => open('prepare')}>Prepare the payment</Button>}
      {a.can.approve && <Button onClick={() => open('approve')}>Approve and pay</Button>}
      {a.can.sendBack && (
        <Button variant="secondary" onClick={() => open('sendBack')}>
          Send back
        </Button>
      )}
      {a.can.settle && out && <Button onClick={() => open('setOff')}>Set against a bill</Button>}
      {a.can.settle && out && (
        <Button variant="secondary" onClick={() => open('return')}>
          Money returned
        </Button>
      )}
      {a.can.settle && out && !a.billsFinal && (
        <Button variant="secondary" onClick={() => open('billsFinal')}>
          All bills in
        </Button>
      )}
      {a.can.cancel && (
        <Button variant="danger" onClick={() => open('cancel')}>
          Cancel
        </Button>
      )}
    </>
  );
}

function Notices({ a }: { a: AdvanceDetail }) {
  const items: ReactNode[] = [];
  if (a.vendorMark) {
    items.push(
      <div key="mark" role="alert" className="rounded-lg bg-danger-tint px-4 py-3.5 text-sm text-danger ring-1 ring-current/15 ring-inset">
        <b className="mr-2 rounded-md bg-danger px-2 py-0.5 text-xs font-bold tracking-[0.12em] text-danger-fg uppercase">{a.vendorMark.mark}</b>
        {a.payee.name} is {a.vendorMark.mark}
        {a.vendorMark.reason && `: ${a.vendorMark.reason}`}
        {a.vendorMark.until && ` (till ${dmy(a.vendorMark.until)})`}. No new advance can be paid to this vendor.
      </div>,
    );
  }
  if (a.state === 'planned' && a.returnReason) {
    items.push(
      <div key="back" className="rounded-lg bg-warning-tint px-4 py-3.5 text-sm text-warning ring-1 ring-current/15 ring-inset">
        Sent back by the approver: <b>{a.returnReason}</b>. Prepare it again.
      </div>,
    );
  }
  if (a.state === 'to_recover') {
    items.push(
      <div key="recover" className="rounded-lg bg-danger-tint px-4 py-3.5 text-sm text-danger ring-1 ring-current/15 ring-inset">
        <b>Recover {formatINR(a.figures.toRecover)}</b>
        {a.figures.overdue ? ' — the settle-by date has passed.' : ' — all the bills are in.'} It blocks the case from closing and {a.payee.name}
        ’s next advance until it is returned or set off.
      </div>,
    );
  }
  if (a.state === 'cancelled' && a.cancelReason) {
    items.push(
      <div key="cancel" className="rounded-lg bg-surface-2 px-4 py-3.5 text-sm text-muted ring-1 ring-current/15 ring-inset">
        Cancelled: {a.cancelReason}
      </div>,
    );
  }
  return items.length ? <div className="flex flex-col gap-2">{items}</div> : null;
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] font-bold tracking-[0.14em] text-ink-40 uppercase">{label}</dt>
      <dd className="mt-1 text-fg">{children}</dd>
    </div>
  );
}

function VoucherNo({ college, id }: { college: string; id: number | null }) {
  const vouchers = useVouchers(id ? college : undefined);
  if (!id) return <>—</>;
  const v = vouchers.data?.find((x) => x.id === id);
  return <span className="font-mono">{v?.voucherNo ?? `#${id}`}</span>;
}

const ACTIONS: Record<string, string> = {
  planned: 'Planned',
  prepared: 'Payment prepared',
  returned_for_changes: 'Sent back for changes',
  paid: 'Approved and paid',
  set_off: 'Set against a bill',
  returned: 'Money returned',
  bills_final: 'All bills in',
  overdue: 'Settle-by date passed: to recover',
  closed: 'Settled in full',
  cancelled: 'Cancelled',
  po_linked: 'PO linked from MRF',
};

function trackLabel(action: string, d: Record<string, unknown>): string {
  const label = ACTIONS[action] ?? action;
  const money = (k: string) => (typeof d[k] === 'number' ? formatINR(d[k] as number) : '');
  switch (action) {
    case 'planned':
      return `${label}: ${money('amount')}${d.source === 'mrf' ? ' (from MRF)' : ''}`;
    case 'prepared':
      return `${label}: ${String(d.form ?? '')}${d.reference ? ` · ${String(d.reference)}` : ''}`;
    case 'set_off':
      return `${label}: ${String(d.billNo ?? '')} · ${money('amount')}`;
    case 'returned':
      return `${label}: ${money('amount')} · ${String(d.form ?? '')}`;
    case 'returned_for_changes':
    case 'cancelled':
      return d.reason ? `${label}: ${String(d.reason)}` : label;
    case 'bills_final':
      // The default reason only repeats the label; a cancelled order says why.
      return d.reason && d.reason !== 'all bills are in' ? `${label}: ${String(d.reason)}` : label;
    case 'overdue':
      return `${label} ${money('toRecover')}`;
    case 'po_linked':
      return `${label}: ${String(d.po ?? '')}`;
    default:
      return label;
  }
}

// ---------------------------------------------------------------- dialogs

function useAct() {
  const toast = useToast();
  const [error, setError] = useState('');
  return {
    error,
    setError,
    run: async (fn: () => Promise<unknown>, done: string, onClose: () => void) => {
      setError('');
      try {
        await fn();
        toast(done);
        onClose();
      } catch (err) {
        setError(errorMessage(err));
      }
    },
  };
}

function PrepareDialog({ a, open, onClose }: { a: AdvanceDetail; open: boolean; onClose: () => void }) {
  const settings = useAdvanceSettings();
  const prepare = usePrepareAdvance();
  const act = useAct();
  const [payment, setPayment] = useState<PaymentDraft>(() => emptyPayment((PAYMENT_FORMS as readonly string[]).includes(a.plannedForm) ? (a.plannedForm as PaymentForm) : ''));
  const [amount, setAmount] = useState(String(a.amount));
  const amt = Math.round(Number(amount) || 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Prepare the payment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={prepare.isPending}
            onClick={() => {
              const problem = paymentProblem(payment, amt, settings.data);
              if (problem) return act.setError(problem);
              void act.run(() => prepare.mutateAsync({ id: a.id, ...payment, amount: amt }), `${a.advanceNo} sent for approval`, onClose);
            }}
          >
            Send for approval
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount (₹)" htmlFor="p-amount" hint={a.source === 'mrf' ? `Up to ${formatINR(a.amount)}, as cleared.` : undefined}>
          <Input id="p-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <PaymentFields value={payment} onChange={setPayment} amount={amt} settings={settings.data} idPrefix="p" />
        {a.plannedForm && payment.form && payment.form !== a.plannedForm && (
          <p className="text-xs text-warning">The plan said {a.plannedForm}. The change is kept on the track.</p>
        )}
        <ErrorBox>{act.error}</ErrorBox>
      </div>
    </Modal>
  );
}

function ApproveDialog({ a, open, onClose }: { a: AdvanceDetail; open: boolean; onClose: () => void }) {
  const approve = useApproveAdvance();
  const settings = useAdvanceSettings();
  const act = useAct();
  const [paidDate, setPaidDate] = useState(todayISO());
  const high = settings.data && a.amount > settings.data.highLimit;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approve and pay"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={approve.isPending} onClick={() => act.run(() => approve.mutateAsync({ id: a.id, paidDate }), `${a.advanceNo} paid`, onClose)}>
            Approve and pay {formatINR(a.amount)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Pay <b>{formatINR(a.amount)}</b> to <b>{a.payee.name}</b> by <b>{a.payment?.form}</b>
          {a.payment?.reference && <span className="font-mono"> · {a.payment.reference}</span>}. Prepared by {a.preparedBy}.
        </p>
        {high && <p className="text-xs text-warning">Above {formatINR(settings.data!.highLimit)}: a main administrator or a Head approves it.</p>}
        <Field label="Paid on" htmlFor="ap-date">
          <Input id="ap-date" type="date" max={todayISO()} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
        <p className="text-xs text-ink-50">Approving writes the On Account voucher in the cash book and tells MRF the advance is paid.</p>
        <ErrorBox>{act.error}</ErrorBox>
      </div>
    </Modal>
  );
}

function ReasonDialog({ a, kind, open, onClose }: { a: AdvanceDetail; kind: 'sendBack' | 'cancel'; open: boolean; onClose: () => void }) {
  const sendBack = useSendBackAdvance();
  const cancel = useCancelAdvance();
  const act = useAct();
  const [reason, setReason] = useState('');
  const m = kind === 'sendBack' ? sendBack : cancel;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={kind === 'sendBack' ? 'Send back for changes' : 'Cancel the advance'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={kind === 'cancel' ? 'danger' : 'primary'}
            loading={m.isPending}
            onClick={() => {
              if (!reason.trim()) return act.setError('Give a reason.');
              void act.run(() => m.mutateAsync({ id: a.id, reason }), kind === 'sendBack' ? 'Sent back' : 'Advance cancelled', onClose);
            }}
          >
            {kind === 'sendBack' ? 'Send back' : 'Cancel the advance'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Reason" required htmlFor="r-reason">
          <Textarea id="r-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} />
        </Field>
        <ErrorBox>{act.error}</ErrorBox>
      </div>
    </Modal>
  );
}

function SetOffDialog({ a, open, onClose }: { a: AdvanceDetail; open: boolean; onClose: () => void }) {
  const setOff = useSetOffBill();
  const act = useAct();
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState('');
  const [billTotal, setBillTotal] = useState('');
  const [amount, setAmount] = useState('');
  const total = Math.round(Number(billTotal) || 0);
  const suggested = Math.min(total || a.figures.outstanding, a.figures.outstanding);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set against a bill"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={setOff.isPending}
            onClick={() =>
              act.run(
                () => setOff.mutateAsync({ id: a.id, billNo, billDate, billTotal: total, amount: Math.round(Number(amount || suggested) || 0) }),
                `Bill ${billNo} set off`,
                onClose,
              )
            }
          >
            Set off
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-60">
          {formatINR(a.figures.outstanding)} is still out. A bill is set off once, and never for more than the bill or the advance
          {a.payee.kind === 'vendor' ? ', and only against this vendor’s own bills' : ''}.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bill number" required htmlFor="s-no">
            <Input id="s-no" value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Bill date" htmlFor="s-date">
            <Input id="s-date" type="date" max={todayISO()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <Field label="Bill total (₹)" required htmlFor="s-total">
            <Input id="s-total" type="number" min={1} value={billTotal} onChange={(e) => setBillTotal(e.target.value)} />
          </Field>
          <Field label="Set off (₹)" htmlFor="s-amt" hint={total ? `Up to ${formatINR(suggested)}` : undefined}>
            <Input id="s-amt" type="number" min={1} value={amount} placeholder={total ? String(suggested) : ''} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <ErrorBox>{act.error}</ErrorBox>
      </div>
    </Modal>
  );
}

function ReturnDialog({ a, open, onClose }: { a: AdvanceDetail; open: boolean; onClose: () => void }) {
  const ret = useRecordReturn();
  const act = useAct();
  const [amount, setAmount] = useState(String(a.figures.outstanding));
  const [form, setForm] = useState<PaymentForm>('Cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayISO());
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Money returned"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={ret.isPending}
            onClick={() => act.run(() => ret.mutateAsync({ id: a.id, amount: Math.round(Number(amount) || 0), form, reference, date }), 'Return recorded', onClose)}
          >
            Record {formatINR(Math.round(Number(amount) || 0))}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-60">Unspent money given back, or refunded by the vendor. It is written to the cash book as a receipt.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" required htmlFor="rt-amt" hint={`${formatINR(a.figures.outstanding)} is still out`}>
            <Input id="rt-amt" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Returned on" htmlFor="rt-date">
            <Input id="rt-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="How" htmlFor="rt-form">
            <Select id="rt-form" value={form} onChange={(e) => setForm(e.target.value as PaymentForm)}>
              {PAYMENT_FORMS.filter((f) => f !== 'Card').map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={form === 'Cash' ? 'Receipt number' : 'Reference'} required={form !== 'Cash'} htmlFor="rt-ref">
            <Input id="rt-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          </Field>
        </div>
        <ErrorBox>{act.error}</ErrorBox>
      </div>
    </Modal>
  );
}

function BillsFinalDialog({ a, open, onClose }: { a: AdvanceDetail; open: boolean; onClose: () => void }) {
  const final = useBillsFinal();
  const toast = useToast();
  return (
    <ConfirmDialog
      open={open}
      title="All the bills are in?"
      message={
        <>
          The {formatINR(a.figures.outstanding)} still out becomes <b>to recover</b> now. It blocks the case from closing and {a.payee.name}’s next advance
          until it is returned.
        </>
      }
      confirmLabel="All bills in"
      danger
      loading={final.isPending}
      onConfirm={() =>
        final.mutateAsync({ id: a.id }).then(
          () => {
            toast('Marked: all bills in');
            onClose();
          },
          (err) => toast(errorMessage(err), 'error'),
        )
      }
      onCancel={onClose}
    />
  );
}
