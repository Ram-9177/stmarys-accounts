import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { errorMessage } from '@/api/client';
import { useAddBlock, useAddHead, useBlocks, useHeads, useSaveVoucher, useVendorPayments, useVendors, useVouchers } from '@/api/hooks';
import type { AccountHead, Vendor, Voucher, VoucherType } from '@/api/types';
import { isVoucherAdmin, useSession } from '@/auth/AuthProvider';
import { Button, Card, cx, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dmy, formatINR, todayISO, VOUCHER_TYPE_LABEL } from '@/lib/format';
import { useUnsavedWork } from '@/uos/unsaved';
import {
  canEditVoucher,
  changeType,
  draftFromVoucher,
  draftToInput,
  emptyDraft,
  PAYMENT_MODES,
  validateDraft,
  withAmount,
  type DraftErrors,
  type VoucherDraft,
} from './draft';
import { phoneSuggestions } from './filters';
import { usePrintAction } from './usePrintAction';

const TYPE_CARDS: { type: VoucherType; title: string; desc: string; tone: string }[] = [
  { type: 'debit', title: 'Debit Voucher', desc: 'Money paid out', tone: 'border-debit text-debit' },
  { type: 'credit', title: 'Credit Voucher', desc: 'Money received', tone: 'border-credit text-credit' },
  { type: 'onaccount', title: 'On Account Voucher', desc: 'Advance to be cleared later', tone: 'border-onaccount text-onaccount' },
];

export function VoucherFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const { college } = useSession();
  const vouchers = useVouchers(college);

  if (editId === null) return <VoucherForm key="new" existing={null} />;
  if (vouchers.isLoading) return <Spinner className="mx-auto mt-16 size-8 text-maroon-700" />;
  const existing = vouchers.data?.find((v) => v.id === editId);
  if (!existing) {
    return (
      <EmptyState title="Voucher not found">
        It may have been deleted, or it belongs to another college. <Link className="text-maroon-700 underline" to="/my-vouchers">Back to vouchers</Link>
      </EmptyState>
    );
  }
  return <VoucherForm key={existing.id} existing={existing} />;
}

function VoucherForm({ existing }: { existing: Voucher | null }) {
  const { user, college, can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const admin = isVoucherAdmin(user);
  const canEditAny = can('edit_voucher');
  const allowed = !existing || canEditVoucher(existing, { username: user.username, canEdit: canEditAny, isAdmin: admin });
  // Without edit_voucher a user may only work on on-account vouchers, and cannot change the type.
  const typeLocked = !!existing && !canEditAny;

  const [draft, setDraft] = useState<VoucherDraft>(() => (existing ? draftFromVoucher(existing) : emptyDraft('debit', todayISO())));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saved, setSaved] = useState<Voucher | null>(null);
  // Changed since it was opened or last saved: UOS session renewal waits instead of reloading the page.
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  useUnsavedWork('voucher-form', !saved && JSON.stringify(draft) !== baseline);
  const [formError, setFormError] = useState('');
  const save = useSaveVoucher();
  const printer = usePrintAction();

  const vouchers = useVouchers(college);
  const heads = useHeads(college);
  const blocks = useBlocks(college);
  const canSeeVendors = admin || can('view_vendor_ledger') || can('manage_vendors');
  const vendors = useVendors(college, canSeeVendors);
  const vendorPayments = useVendorPayments(college, canSeeVendors);

  const set = <K extends keyof VoucherDraft>(k: K, v: VoucherDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  useEffect(() => {
    if (existing && existing.college !== college) navigate('/my-vouchers', { replace: true });
  }, [college, existing, navigate]);

  // "+ Voucher" from the vendor ledger opens /vouchers/new?vendorId=V00002: pre-select that
  // agreement and fill "paid to" / "towards" once the vendor list has loaded (as the old app did).
  const [searchParams] = useSearchParams();
  const prefillVendorId = existing ? '' : (searchParams.get('vendorId') ?? '');
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefillVendorId || prefilled.current || !vendors.data) return;
    prefilled.current = true;
    const v = vendors.data.find((x) => x.vendorId === prefillVendorId);
    if (!v) return;
    setDraft((d) => ({
      ...changeType(d, 'debit'),
      vendorId: v.vendorId,
      paidTo: d.paidTo.trim() || v.companyName || v.vendorName,
      towards: d.towards.trim() || v.workDescription,
    }));
  }, [prefillVendorId, vendors.data]);

  if (!allowed) {
    return <EmptyState title="You can't edit this voucher">Only authorized users can edit vouchers created by others.</EmptyState>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const errs = validateDraft(draft);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setFormError('Please fix the highlighted fields.');
      return;
    }
    try {
      const r = await save.mutateAsync({ ...draftToInput(draft, college), id: existing?.id });
      setSaved(r.voucher);
      toast(`Voucher ${r.voucher.voucherNo} saved for ${dmy(r.voucher.date)}`);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  function startNew() {
    setSaved(null);
    setErrors({});
    setFormError('');
    if (existing) navigate('/vouchers/new');
    else {
      const next = emptyDraft(draft.type, todayISO());
      setDraft(next);
      setBaseline(JSON.stringify(next));
    }
  }

  if (saved) {
    return (
      <div className="mx-auto max-w-xl">
        <Card title="✅ Voucher saved">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-sand-600">Voucher no.</dt>
            <dd className="font-semibold">{saved.voucherNo}</dd>
            <dt className="text-sand-600">Type</dt>
            <dd>{VOUCHER_TYPE_LABEL[saved.type]}</dd>
            <dt className="text-sand-600">Date</dt>
            <dd>{dmy(saved.date)}</dd>
            <dt className="text-sand-600">Amount</dt>
            <dd className="font-semibold">{formatINR(saved.amount)}</dd>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            {can('print_voucher') && <Button onClick={() => printer.print(saved)}>🖨 Print</Button>}
            <Button variant="secondary" onClick={() => printer.view(saved)}>
              Preview
            </Button>
            {can('create_voucher') && (
              <Button variant="gold" onClick={startNew}>
                ＋ New voucher
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate(admin || can('view_all_vouchers') ? '/vouchers' : '/my-vouchers')}>
              Go to vouchers →
            </Button>
          </div>
        </Card>
        {printer.modal}
      </div>
    );
  }

  const t = draft.type;
  const typeHeads = (heads.data ?? []).filter((h) => h.type === t || h.type === 'common');

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={existing ? `Edit ${VOUCHER_TYPE_LABEL[t]} Voucher` : `${VOUCHER_TYPE_LABEL[t]} Voucher`}
        subtitle={existing ? `${existing.voucherNo} · created by ${existing.createdByLabel}` : 'Fill in the details and save. You can print right after saving.'}
      />

      <div role="radiogroup" aria-label="Voucher type" className="mb-5 grid gap-3 sm:grid-cols-3">
        {TYPE_CARDS.map((c) => {
          const active = t === c.type;
          const disabled = typeLocked && c.type !== t;
          return (
            <button
              key={c.type}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${c.title} voucher`}
              disabled={disabled}
              onClick={() => setDraft((d) => changeType(d, c.type))}
              className={cx(
                'rounded-xl border-2 bg-white p-4 text-left transition',
                active ? c.tone + ' shadow-card' : 'border-sand-100 text-sand-800 hover:border-sand-200',
                disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              <p className="text-base font-semibold">{c.title}</p>
              <p className="text-xs text-sand-600">{c.desc}</p>
            </button>
          );
        })}
      </div>

      <form onSubmit={submit} noValidate>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date" required error={errors.date} htmlFor="v-date">
              <Input id="v-date" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
            </Field>

            <HeadField type={t} value={draft.head} onChange={(v) => set('head', v)} heads={typeHeads} error={errors.head} canAdd={can('account_heads')} />

            {t === 'credit' ? (
              <Field label="Received from" required error={errors.receivedFrom} htmlFor="v-from" className="md:col-span-2">
                <Input id="v-from" value={draft.receivedFrom} onChange={(e) => set('receivedFrom', e.target.value)} maxLength={250} />
              </Field>
            ) : (
              <>
                <Field label="Paid to" required error={errors.paidTo} htmlFor="v-paidto">
                  <Input id="v-paidto" value={draft.paidTo} onChange={(e) => set('paidTo', e.target.value)} maxLength={250} />
                </Field>
                {t === 'debit' && canSeeVendors ? (
                  <VendorField
                    vendors={vendors.data ?? []}
                    vouchers={vendorPayments.data ?? []}
                    value={draft.vendorId}
                    onChange={(vendor) =>
                      setDraft((d) => {
                        const prev = (vendors.data ?? []).find((x) => x.vendorId === d.vendorId);
                        const prevName = prev ? prev.companyName || prev.vendorName : '';
                        const name = vendor ? vendor.companyName || vendor.vendorName : '';
                        const paidTo = !d.paidTo || d.paidTo === prevName ? name : d.paidTo;
                        return { ...d, vendorId: vendor?.vendorId ?? '', paidTo };
                      })
                    }
                    excludeVoucherId={existing?.id}
                  />
                ) : (
                  <div className="hidden md:block" />
                )}
              </>
            )}

            {t === 'onaccount' && (
              <>
                <PhoneField
                  value={draft.recipientPhone}
                  error={errors.recipientPhone}
                  suggestions={phoneSuggestions(vouchers.data ?? [])}
                  onChange={(phone, paidTo) =>
                    setDraft((d) => ({ ...d, recipientPhone: phone, paidTo: paidTo && !d.paidTo.trim() ? paidTo : d.paidTo }))
                  }
                />
                <Field label="Reverse / cleared date" hint="Leave empty while the advance is pending." error={errors.reversalDate} htmlFor="v-rev">
                  <Input id="v-rev" type="date" min={draft.date} value={draft.reversalDate} onChange={(e) => set('reversalDate', e.target.value)} />
                </Field>
              </>
            )}

            <Field label="Towards" required error={errors.towards} htmlFor="v-towards" className="md:col-span-2">
              <Textarea id="v-towards" rows={2} value={draft.towards} onChange={(e) => set('towards', e.target.value)} maxLength={500} />
            </Field>

            <BlockField value={draft.block} onChange={(v) => set('block', v)} blocks={(blocks.data ?? []).map((b) => b.name)} canAdd={can('account_heads')} />

            <Field label="Amount (₹)" required error={errors.amount} htmlFor="v-amt">
              <Input
                id="v-amt"
                type="number"
                inputMode="decimal"
                min="1"
                step="1"
                value={draft.amount}
                onChange={(e) => setDraft((d) => withAmount(d, e.target.value))}
                className="tabular text-base font-semibold"
              />
            </Field>

            <Field label="Amount in words" className="md:col-span-2" htmlFor="v-words">
              <Input id="v-words" value={draft.amtWords} onChange={(e) => set('amtWords', e.target.value)} maxLength={500} />
            </Field>

            <Field label="Payment mode" htmlFor="v-mode">
              <Select id="v-mode" value={draft.mode} onChange={(e) => set('mode', e.target.value)}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label={draft.mode === 'Cash' ? 'Cheque / Ref. no.' : `${draft.mode} no. / reference`} htmlFor="v-ref">
              <Input id="v-ref" value={draft.cheque} onChange={(e) => set('cheque', e.target.value)} maxLength={120} placeholder={draft.mode === 'Cash' ? 'Optional' : ''} />
            </Field>

            <Field label="Prepared by" htmlFor="v-prep">
              <Input id="v-prep" value={draft.prepBy} onChange={(e) => set('prepBy', e.target.value)} maxLength={120} />
            </Field>
            <Field label="Checked by" htmlFor="v-chk">
              <Input id="v-chk" value={draft.checkedBy} onChange={(e) => set('checkedBy', e.target.value)} maxLength={120} />
            </Field>
            <Field label="Remarks" className="md:col-span-2" htmlFor="v-rem">
              <Input id="v-rem" value={draft.remarks} onChange={(e) => set('remarks', e.target.value)} maxLength={500} />
            </Field>
          </div>

          <div className="mt-5">
            <ErrorBox>{formError}</ErrorBox>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                printer.view({
                  ...draftToInput(draft, college),
                  id: existing?.id ?? 0,
                  voucherNo: existing?.voucherNo ?? '',
                  createdBy: existing?.createdBy ?? user.username,
                  createdByLabel: existing?.createdByLabel ?? user.displayName,
                  createdAt: existing?.createdAt ?? new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                })
              }
            >
              Preview
            </Button>
            <Button type="submit" loading={save.isPending}>
              {existing ? 'Save changes' : 'Save voucher'}
            </Button>
          </div>
        </Card>
      </form>
      {printer.modal}
    </div>
  );
}

// ---------------- sub-fields ----------------

function HeadField({
  type,
  value,
  onChange,
  heads,
  error,
  canAdd,
}: {
  type: VoucherType;
  value: string;
  onChange: (v: string) => void;
  heads: AccountHead[];
  error?: string;
  canAdd: boolean;
}) {
  const { college } = useSession();
  const listId = useId();
  const addHead = useAddHead();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  return (
    <Field label={type === 'credit' ? 'Credit A/c head' : 'Account head'} required={type !== 'credit'} error={error} htmlFor="v-head">
      <div className="flex gap-2">
        <Input id="v-head" list={listId} value={value} onChange={(e) => onChange(e.target.value)} maxLength={250} placeholder="Type or pick a head" autoComplete="off" />
        {canAdd && (
          <Button variant="secondary" onClick={() => setAdding(true)} title="Add a new account head" aria-label="Add a new account head">
            ＋
          </Button>
        )}
      </div>
      <datalist id={listId}>
        {heads.map((h) => (
          <option key={h.id} value={h.name} />
        ))}
      </datalist>
      <NameDialog
        open={adding}
        title="New account head"
        label="Head name"
        existing={heads.map((h) => h.name)}
        loading={addHead.isPending}
        onCancel={() => setAdding(false)}
        onSave={async (name) => {
          try {
            await addHead.mutateAsync({ name, type: type, college });
            onChange(name);
            setAdding(false);
            toast('New head added');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        }}
      />
    </Field>
  );
}

function BlockField({ value, onChange, blocks, canAdd }: { value: string; onChange: (v: string) => void; blocks: string[]; canAdd: boolean }) {
  const { college } = useSession();
  const listId = useId();
  const addBlock = useAddBlock();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  return (
    <Field label="Block" htmlFor="v-block">
      <div className="flex gap-2">
        <Input id="v-block" list={listId} value={value} onChange={(e) => onChange(e.target.value)} maxLength={250} autoComplete="off" />
        {canAdd && (
          <Button variant="secondary" onClick={() => setAdding(true)} title="Add a new block" aria-label="Add a new block">
            ＋
          </Button>
        )}
      </div>
      <datalist id={listId}>
        {blocks.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <NameDialog
        open={adding}
        title="New block"
        label="Block name"
        existing={blocks}
        loading={addBlock.isPending}
        onCancel={() => setAdding(false)}
        onSave={async (name) => {
          try {
            await addBlock.mutateAsync({ name, college });
            onChange(name);
            setAdding(false);
            toast('New block added');
          } catch (e) {
            toast(errorMessage(e), 'error');
          }
        }}
      />
    </Field>
  );
}

function NameDialog({
  open,
  title,
  label,
  existing,
  loading,
  onSave,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  existing: string[];
  loading: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setErr('');
    }
  }, [open]);
  const submit = () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return setErr('Enter a name');
    if (existing.some((x) => x.toLowerCase() === n.toLowerCase())) return setErr('This already exists');
    onSave(n);
  };
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading}>
            Add
          </Button>
        </>
      }
    >
      <Field label={label} error={err}>
        <Input
          autoFocus
          value={name}
          maxLength={250}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
    </Modal>
  );
}

function PhoneField({
  value,
  error,
  suggestions,
  onChange,
}: {
  value: string;
  error?: string;
  suggestions: { phone: string; paidTo: string }[];
  onChange: (phone: string, paidTo?: string) => void;
}) {
  const listId = useId();
  return (
    <Field label="Receiver phone number" required error={error} htmlFor="v-phone" hint="Pick a previous receiver to fill “Paid to”.">
      <Input
        id="v-phone"
        type="tel"
        inputMode="tel"
        list={listId}
        value={value}
        maxLength={30}
        autoComplete="off"
        onChange={(e) => {
          const phone = e.target.value;
          const match = suggestions.find((s) => s.phone === phone.trim());
          onChange(phone, match?.paidTo);
        }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.phone} value={s.phone}>
            {s.paidTo}
          </option>
        ))}
      </datalist>
    </Field>
  );
}

function VendorField({
  vendors,
  vouchers,
  value,
  onChange,
  excludeVoucherId,
}: {
  vendors: Vendor[];
  vouchers: Voucher[];
  value: string;
  onChange: (v: Vendor | null) => void;
  excludeVoucherId?: number;
}) {
  const vendor = vendors.find((v) => v.vendorId === value);
  const paid = useMemo(
    () =>
      vendor
        ? vouchers.filter((v) => v.vendorId === vendor.vendorId && v.type !== 'credit' && v.id !== excludeVoucherId).reduce((s, v) => s + v.amount, 0)
        : 0,
    [vendor, vouchers, excludeVoucherId],
  );
  let info: ReactNode = null;
  if (vendor) {
    const agreed = Number(vendor.agreedAmount) || 0;
    const balance = agreed - paid;
    info = (
      <p className="rounded-lg bg-maroon-50 px-3 py-2 text-xs text-maroon-800">
        Agreement {String(vendor.agreement?.agreementNo ?? vendor.vendorId)}
        {vendor.periodStart ? ` · ${dmy(vendor.periodStart)} – ${dmy(vendor.periodEnd)}` : ''} · Agreed {formatINR(agreed)} · Paid {formatINR(paid)} ·{' '}
        <b className={balance < 0 ? 'text-debit' : ''}>Balance {formatINR(balance)}</b>
      </p>
    );
  }
  return (
    <Field label="Vendor / agreement (optional)" htmlFor="v-vendor">
      <Select id="v-vendor" value={value} onChange={(e) => onChange(vendors.find((v) => v.vendorId === e.target.value) ?? null)}>
        <option value="">— Not linked to a vendor —</option>
        {value && !vendor && <option value={value}>{value} (not found)</option>}
        {vendors.map((v) => (
          <option key={v.vendorId} value={v.vendorId}>
            {v.vendorId} — {v.companyName || v.vendorName}
          </option>
        ))}
      </Select>
      {info}
    </Field>
  );
}
