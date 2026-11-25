import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '@/api/client';
import { useAdvanceSettings, usePlanAdvance, useVendors } from '@/api/hooks';
import type { PayeeKind } from '@/api/types';
import { PAYMENT_FORMS } from '@/api/types';
import { isVoucherAdmin, useSession } from '@/auth/AuthProvider';
import { Button, Card, Checkbox, cx, ErrorBox, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { formatINR, todayISO } from '@/lib/format';
import { useUnsavedWork } from '@/uos/unsaved';
import { emptyPayment, PaymentFields, paymentProblem, type PaymentDraft } from './shared';

function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/**
 * A new advance, as Finance fixes it at clearance (F1/F2): the payee, the amount,
 * the form, the date to settle by and who recovers. Prepared with its payment
 * details, it goes to a second person for approval.
 */
export function AdvanceFormPage() {
  const { user, college, can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useAdvanceSettings();
  const vendors = useVendors(college, isVoucherAdmin(user) || can('view_vendor_ledger') || can('manage_vendors'));
  const plan = usePlanAdvance();

  const [kind, setKind] = useState<PayeeKind>('employee');
  const [vendorId, setVendorId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeePhone, setPayeePhone] = useState('');
  const [vendorCode, setVendorCode] = useState('');
  const [vendorGst, setVendorGst] = useState('');
  const [amount, setAmount] = useState('');
  const [plannedForm, setPlannedForm] = useState('');
  const [settleBy, setSettleBy] = useState('');
  const [recoveredBy, setRecoveredBy] = useState('');
  const [caseNo, setCaseNo] = useState('');
  const [poNo, setPoNo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [block, setBlock] = useState('');
  const [prepareNow, setPrepareNow] = useState(true);
  const [payment, setPayment] = useState<PaymentDraft>(emptyPayment());
  const [error, setError] = useState('');
  useUnsavedWork('advance-form', !!(payeeName || amount || purpose) && !plan.isSuccess);

  const days = settings.data?.employeeDays ?? 15;
  const defaultSettle = kind === 'employee' ? addDays(todayISO(), days) : '';
  const amt = Math.round(Number(amount) || 0);
  const approvalOff = settings.data?.approval === 'off';
  const vendorList = useMemo(() => (vendors.data ?? []).filter((v) => v.companyName || v.vendorName), [vendors.data]);

  function pickVendor(id: string) {
    setVendorId(id);
    const v = vendorList.find((x) => x.vendorId === id);
    if (v) {
      setPayeeName(v.companyName || v.vendorName);
      setPayeePhone(v.phone || '');
      setVendorGst(v.gstNumber || '');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!payeeName.trim()) return setError(kind === 'vendor' ? 'Enter the vendor.' : 'Enter the employee.');
    if (kind === 'employee' && payeePhone.replace(/\D/g, '').length < 10) return setError("Enter the employee's phone number (10 digits).");
    if (amt <= 0) return setError('Enter the amount of the advance.');
    if (kind === 'vendor' && !settleBy) return setError('Enter the date the advance must be settled by.');
    if (prepareNow) {
      const problem = paymentProblem(payment, amt, settings.data);
      if (problem) return setError(problem);
    }
    try {
      const r = await plan.mutateAsync({
        college,
        payeeKind: kind,
        payeeName: payeeName.trim(),
        payeePhone,
        vendorId: kind === 'vendor' ? vendorId : '',
        vendorCode: kind === 'vendor' ? vendorCode : '',
        vendorGst: kind === 'vendor' ? vendorGst : '',
        amount: amt,
        plannedForm: prepareNow ? payment.form : plannedForm,
        settleBy: settleBy || defaultSettle,
        recoveredBy,
        purpose,
        block,
        caseNo,
        poNo,
        ...(prepareNow ? { form: payment.form, reference: payment.reference, bank: payment.bank, receivedBy: payment.receivedBy } : {}),
      });
      const a = r.advance;
      toast(
        a.state === 'prepared'
          ? `${a.advanceNo} sent for approval`
          : a.state === 'planned'
            ? `${a.advanceNo} planned`
            : `${a.advanceNo} paid: ${formatINR(a.amount)}`,
      );
      navigate(`/advances/${a.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="New advance"
        subtitle={
          approvalOff
            ? 'Money first, goods later, then settle. Paid as soon as it is prepared.'
            : 'Money first, goods later, then settle. A second person approves it before it is paid.'
        }
      />

      <Card title="Who it is for">
        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Payee" className="inline-flex gap-0.5 self-start rounded-full bg-surface-2 p-[3px]">
            {(['employee', 'vendor'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setVendorId('');
                }}
                className={cx('h-9 rounded-full px-4 text-[13px] font-semibold', kind === k ? 'bg-fg text-bg' : 'text-muted hover:text-fg')}
              >
                {k === 'employee' ? 'Employee · local buying' : 'Vendor'}
              </button>
            ))}
          </div>
          {kind === 'vendor' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Vendor in Accounts" htmlFor="a-vendor" hint="Or type a vendor below.">
                <Select id="a-vendor" value={vendorId} onChange={(e) => pickVendor(e.target.value)}>
                  <option value="">— Not in Accounts —</option>
                  {vendorList.map((v) => (
                    <option key={v.vendorId} value={v.vendorId}>
                      {v.vendorId} · {v.companyName || v.vendorName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vendor name" required htmlFor="a-name">
                <Input id="a-name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Vendor code in MRF" htmlFor="a-code" hint="Links the advance to the vendor's account in MRF, and its blacklist mark.">
                <Input id="a-code" value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} maxLength={80} />
              </Field>
              <Field label="GST number" htmlFor="a-gst">
                <Input id="a-gst" value={vendorGst} onChange={(e) => setVendorGst(e.target.value.toUpperCase())} maxLength={20} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Employee" required htmlFor="a-name">
                <Input id="a-name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Phone" required htmlFor="a-phone">
                <Input id="a-phone" inputMode="tel" value={payeePhone} onChange={(e) => setPayeePhone(e.target.value)} maxLength={30} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card title="How much, and when it is settled">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Amount (₹)" required htmlFor="a-amount">
            <Input id="a-amount" type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field
            label="Settle by"
            required={kind === 'vendor'}
            htmlFor="a-settle"
            hint={kind === 'employee' ? `Bills in and unspent cash back. ${days} days if left empty.` : 'Set against the vendor’s bills by this date.'}
          >
            <Input id="a-settle" type="date" min={todayISO()} value={settleBy} placeholder={defaultSettle} onChange={(e) => setSettleBy(e.target.value)} />
          </Field>
          <Field label="Who recovers it" htmlFor="a-recovers" hint="Named at clearance: follows up the bills and any money to return.">
            <Input id="a-recovers" value={recoveredBy} onChange={(e) => setRecoveredBy(e.target.value)} maxLength={120} />
          </Field>
          {!prepareNow && (
            <Field label="Planned form of payment" htmlFor="a-pform">
              <Select id="a-pform" value={plannedForm} onChange={(e) => setPlannedForm(e.target.value)}>
                <option value="">—</option>
                {PAYMENT_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card title="What it is for">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="MRF case" htmlFor="a-case" hint="e.g. MRF-0145, so MRF shows the advance on the case.">
            <Input id="a-case" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} maxLength={80} />
          </Field>
          <Field label="PO or work order" htmlFor="a-po">
            <Input id="a-po" value={poNo} onChange={(e) => setPoNo(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Purpose" htmlFor="a-purpose" className="md:col-span-2">
            <Textarea id="a-purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={400} />
          </Field>
          <Field label="Block" htmlFor="a-block">
            <Input id="a-block" value={block} onChange={(e) => setBlock(e.target.value)} maxLength={250} />
          </Field>
        </div>
      </Card>

      <Card title="Payment">
        <div className="flex flex-col gap-4">
          <Checkbox label="Prepare the payment now (form of payment and its reference)" checked={prepareNow} onChange={(e) => setPrepareNow(e.target.checked)} />
          {prepareNow ? (
            <PaymentFields value={payment} onChange={setPayment} amount={amt} settings={settings.data} idPrefix="a-pay" />
          ) : (
            <p className="text-sm text-ink-50">Saved as a plan. It is prepared later, then approved and paid.</p>
          )}
        </div>
      </Card>

      <ErrorBox>{error}</ErrorBox>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate('/advances')}>
          Cancel
        </Button>
        <Button type="submit" loading={plan.isPending}>
          {prepareNow ? (approvalOff ? 'Pay the advance' : 'Send for approval') : 'Save the plan'}
        </Button>
      </div>
    </form>
  );
}
