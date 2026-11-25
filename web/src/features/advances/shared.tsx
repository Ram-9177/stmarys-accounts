import type { ReactNode } from 'react';
import type { Advance, AdvanceSettings, AdvanceState, PaymentForm } from '@/api/types';
import { PAYMENT_FORMS } from '@/api/types';
import { Badge, cx, Field, Input, Select } from '@/components/ui';
import { dmy, formatINR } from '@/lib/format';

/** How an advance stands, in the words the flow maps use. */
export function stateLabel(state: AdvanceState, kind: Advance['payee']['kind']): string {
  switch (state) {
    case 'planned':
      return 'Planned';
    case 'prepared':
      return 'Waiting for approval';
    case 'with_payee':
      return kind === 'vendor' ? 'Advance with vendor' : 'With employee';
    case 'to_recover':
      return 'To recover';
    case 'closed':
      return 'Settled';
    case 'cancelled':
      return 'Cancelled';
  }
}

const TONE: Record<AdvanceState, Parameters<typeof Badge>[0]['tone']> = {
  planned: 'neutral',
  prepared: 'gold',
  with_payee: 'maroon',
  to_recover: 'danger',
  closed: 'success',
  cancelled: 'neutral',
};

export function StatePill({ advance }: { advance: Pick<Advance, 'state' | 'payee'> }) {
  return <Badge tone={TONE[advance.state]}>{stateLabel(advance.state, advance.payee.kind)}</Badge>;
}

export function PayeeKindBadge({ kind }: { kind: Advance['payee']['kind'] }) {
  return <Badge tone="neutral">{kind === 'vendor' ? 'Vendor' : 'Employee'}</Badge>;
}

/** The four figures MRF reads, as the strip on the flow maps (`.pos`). */
export function FiguresStrip({ advance }: { advance: Advance }) {
  const f = advance.figures;
  const paid = advance.status === 'paid';
  const cell = (label: string, value: ReactNode, hint?: ReactNode, tone?: 'danger' | 'success' | 'hi') => (
    <div
      className={cx(
        'flex flex-col gap-1 rounded-2xl px-5 py-[18px] shadow-card',
        tone === 'hi' ? 'bg-accent-block text-accent-block-fg' : 'bg-surface-1',
      )}
    >
      <p className={cx('text-xs font-semibold', tone === 'hi' ? 'opacity-80' : 'text-ink-50')}>{label}</p>
      <p
        className={cx(
          'font-mono text-[26px] leading-none font-medium tracking-[-0.02em] tabular',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {hint && <p className={cx('text-xs', tone === 'hi' ? 'opacity-80' : 'text-ink-50')}>{hint}</p>}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cell('Given', paid ? formatINR(f.given) : '—', paid ? `Paid ${dmy(advance.payment?.datePaid)}` : `${formatINR(advance.amount)} planned`)}
      {cell('Settled', formatINR(f.settled), `Bills ${formatINR(f.setOff)} · returned ${formatINR(f.returned)}`, f.settled && f.outstanding === 0 && paid ? 'success' : undefined)}
      {cell('Still out', formatINR(f.outstanding), paid ? (f.outstanding ? 'With the payee' : 'Nothing left') : 'Not paid yet', 'hi')}
      {cell('To recover', formatINR(f.toRecover), f.toRecover ? (f.overdue ? 'Past the settle-by date' : 'All bills are in') : 'Nothing to recover', f.toRecover ? 'danger' : undefined)}
      {cell('Due date', f.dueDate ? dmy(f.dueDate) : '—', f.overdue ? 'Overdue' : 'Settle by', f.overdue ? 'danger' : undefined)}
    </div>
  );
}

export interface PaymentDraft {
  form: PaymentForm | '';
  reference: string;
  bank: string;
  receivedBy: string;
}

export const emptyPayment = (form: PaymentForm | '' = ''): PaymentDraft => ({ form, reference: '', bank: '', receivedBy: '' });

/** Form of payment and its reference: each form records what its track needs (the forms table on the maps). */
export function PaymentFields({
  value,
  onChange,
  amount,
  settings,
  idPrefix,
}: {
  value: PaymentDraft;
  onChange: (p: PaymentDraft) => void;
  amount: number;
  settings?: AdvanceSettings;
  idPrefix: string;
}) {
  const set = (k: keyof PaymentDraft, v: string) => onChange({ ...value, [k]: v });
  const limit = value.form && settings ? (settings.limits as Record<string, number>)[value.form] : undefined;
  const over = limit !== undefined && amount > limit;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Form of payment" required htmlFor={`${idPrefix}-form`} error={over ? `${value.form} can pay at most ${formatINR(limit!)}` : undefined}>
        <Select id={`${idPrefix}-form`} value={value.form} onChange={(e) => onChange({ ...emptyPayment(e.target.value as PaymentForm), form: e.target.value as PaymentForm })}>
          <option value="">Choose…</option>
          {PAYMENT_FORMS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
      </Field>
      {value.form === 'Cash' && (
        <Field label="Received by" required htmlFor={`${idPrefix}-recv`} hint="Who takes the cash. Keep the signed receipt.">
          <Input id={`${idPrefix}-recv`} value={value.receivedBy} onChange={(e) => set('receivedBy', e.target.value)} maxLength={120} />
        </Field>
      )}
      {(value.form === 'Cheque' || value.form === 'DD') && (
        <>
          <Field label={`${value.form} number`} required htmlFor={`${idPrefix}-ref`}>
            <Input id={`${idPrefix}-ref`} value={value.reference} onChange={(e) => set('reference', e.target.value)} maxLength={120} />
          </Field>
          <Field label="Bank" required htmlFor={`${idPrefix}-bank`}>
            <Input id={`${idPrefix}-bank`} value={value.bank} onChange={(e) => set('bank', e.target.value)} maxLength={120} />
          </Field>
        </>
      )}
      {value.form && value.form !== 'Cash' && value.form !== 'Cheque' && value.form !== 'DD' && (
        <Field label={value.form === 'Card' ? 'Transaction reference' : 'Reference (UTR)'} required htmlFor={`${idPrefix}-ref`}>
          <Input id={`${idPrefix}-ref`} value={value.reference} onChange={(e) => set('reference', e.target.value)} maxLength={120} />
        </Field>
      )}
    </div>
  );
}

/** Missing payment details, in the same words the server uses. */
export function paymentProblem(p: PaymentDraft, amount: number, settings?: AdvanceSettings): string {
  if (!p.form) return 'Choose the form of payment.';
  const limit = settings ? (settings.limits as Record<string, number>)[p.form] : undefined;
  if (limit !== undefined && amount > limit) return `${p.form} can pay at most ${formatINR(limit)} at a time.`;
  if (p.form === 'Cash' && !p.receivedBy.trim()) return 'Cash: enter who receives the money.';
  if ((p.form === 'Cheque' || p.form === 'DD') && (!p.reference.trim() || !p.bank.trim())) return `${p.form}: enter its number and the bank.`;
  if (p.form !== 'Cash' && p.form !== 'Cheque' && p.form !== 'DD' && !p.reference.trim()) return `${p.form}: enter the reference.`;
  return '';
}
