import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '@/api/client';
import { useSaveVendor, vendorFileUrl } from '@/api/hooks';
import type { CollegeCode, Vendor, VendorFile, VendorFileInput, VendorInput } from '@/api/types';
import { Button, Card, ConfirmDialog, ErrorBox, Field, Input, Select, Textarea, cx } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { amountInWords, todayISO } from '@/lib/format';
import { formatFileSize } from './documents';
import { newAgreementNumber, nextVendorId, vendorPeriodEnd, vendorPeriodStart, validateVendorForm, type VendorFormValues } from './ledger';

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'];

type Slot = { kind: 'existing'; file: VendorFile } | { kind: 'new'; name: string; size: number; type: string; dataUrl: string } | null;

function emptyValues(vendorId: string): VendorFormValues {
  return {
    vendorId,
    companyName: '',
    vendorName: '',
    phone: '',
    pan: '',
    aadhaar: '',
    email: '',
    address: '',
    workDescription: '',
    agreedAmount: '',
    amountInWords: '',
    periodStart: todayISO(),
    periodEnd: '',
    gstNumber: '',
    bankAccountDetails: '',
    remarks: '',
    authBy: '',
    authRole: '',
    authPlace: '',
    status: 'Active',
  };
}

function valuesFrom(v: Vendor): VendorFormValues {
  return {
    vendorId: v.vendorId,
    companyName: v.companyName ?? '',
    vendorName: v.vendorName ?? '',
    phone: v.phone ?? '',
    pan: v.pan ?? '',
    aadhaar: v.aadhaar ?? '',
    email: v.email ?? '',
    address: String(v.address ?? ''),
    workDescription: v.workDescription ?? '',
    agreedAmount: v.agreedAmount ? String(v.agreedAmount) : '',
    amountInWords: v.amountInWords ?? '',
    periodStart: vendorPeriodStart(v),
    periodEnd: vendorPeriodEnd(v),
    gstNumber: v.gstNumber ?? '',
    bankAccountDetails: v.bankAccountDetails ?? '',
    remarks: v.remarks ?? '',
    authBy: v.authBy ?? '',
    authRole: v.authRole ?? '',
    authPlace: v.authPlace ?? '',
    status: /^(completed|terminated)$/i.test(String(v.status ?? '')) ? String(v.status) : 'Active',
  };
}

function slotsFrom(v?: Vendor | null): Slot[] {
  const s: Slot[] = [null, null, null];
  (v?.files ?? []).slice(0, MAX_FILES).forEach((file, i) => (s[i] = { kind: 'existing', file }));
  return s;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

/** Builds the API payload from form values + attachment slots. */
export function buildVendorPayload(f: VendorFormValues, slots: Slot[], existing?: Vendor | null): VendorInput {
  const amount = parseFloat(f.agreedAmount) || 0;
  const periodStart = f.periodStart;
  const files: VendorFileInput[] = slots.flatMap((s): VendorFileInput[] =>
    !s ? [] : s.kind === 'existing' ? [{ id: s.file.id }] : [{ name: s.name, dataUrl: s.dataUrl }],
  );
  return {
    vendorId: f.vendorId.trim(),
    companyName: f.companyName.trim(),
    vendorName: f.vendorName.trim(),
    phone: f.phone.trim(),
    pan: f.pan.trim().toUpperCase(),
    aadhaar: f.aadhaar.trim(),
    email: f.email.trim(),
    address: f.address.trim(),
    workDescription: f.workDescription.trim(),
    agreedAmount: amount,
    amountInWords: f.amountInWords.trim() || amountInWords(amount),
    periodStart,
    periodEnd: f.periodEnd,
    agreementDate: periodStart,
    gstNumber: f.gstNumber.trim().toUpperCase(),
    bankAccountDetails: f.bankAccountDetails.trim(),
    remarks: f.remarks.trim(),
    authBy: f.authBy.trim(),
    authRole: f.authRole.trim(),
    authPlace: f.authPlace.trim() || 'Chebrolu / Guntur',
    status: f.status || 'Active',
    agreement: {
      ...(existing?.agreement ?? {}),
      agreementNo: newAgreementNumber(f.vendorId.trim(), periodStart),
      agreementDate: periodStart,
      periodStart,
      periodEnd: f.periodEnd,
      createdUnderVendorId: f.vendorId.trim(),
    },
    files,
  };
}

export function VendorForm({
  college,
  vendors,
  editing,
  onSaved,
  onCancelEdit,
  onPreview,
}: {
  college: CollegeCode;
  vendors: Vendor[];
  editing: Vendor | null;
  onSaved: (v: Vendor | undefined, isNew: boolean) => void;
  onCancelEdit: () => void;
  onPreview: (v: Partial<Vendor>) => void;
}) {
  const toast = useToast();
  const save = useSaveVendor();
  const suggestedId = useMemo(() => nextVendorId(vendors), [vendors]);
  const [values, setValues] = useState<VendorFormValues>(() => (editing ? valuesFrom(editing) : emptyValues(suggestedId)));
  const [slots, setSlots] = useState<Slot[]>(() => slotsFrom(editing));
  const [errors, setErrors] = useState<Partial<Record<keyof VendorFormValues, string>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const wordsTouched = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset when switching between "new" and editing another vendor.
  useEffect(() => {
    setValues(editing ? valuesFrom(editing) : emptyValues(nextVendorId(vendors)));
    setSlots(slotsFrom(editing));
    setErrors({});
    setFormError('');
    wordsTouched.current = !!editing;
    if (editing) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    // Only react to a different vendor being opened, not to list refreshes.
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the suggested ID fresh for new vendors (another admin may have added one meanwhile).
  useEffect(() => {
    if (!editing) setValues((v) => (v.vendorId === suggestedId ? v : { ...v, vendorId: suggestedId }));
  }, [suggestedId, editing]);

  const set = <K extends keyof VendorFormValues>(k: K, val: VendorFormValues[K]) => {
    setValues((v) => {
      const next = { ...v, [k]: val };
      if (k === 'agreedAmount' && !wordsTouched.current) next.amountInWords = amountInWords(parseFloat(String(val)) || 0);
      return next;
    });
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function pickFile(i: number, file: File | undefined) {
    if (!file) return;
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return toast('Only PDF, Word (.doc/.docx), PNG and JPEG files can be attached.', 'error');
    if (file.size > MAX_FILE_BYTES) return toast(`"${file.name}" is larger than 5 MB.`, 'error');
    try {
      const dataUrl = await readAsDataUrl(file);
      setSlots((s) => s.map((x, j) => (j === i ? { kind: 'new', name: file.name, size: file.size, type: file.type, dataUrl } : x)));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  function openSlot(s: NonNullable<Slot>) {
    if (s.kind === 'existing') {
      window.open(vendorFileUrl(college, values.vendorId, s.file.id), '_blank', 'noopener');
      return;
    }
    // Unsaved upload: open a blob URL (never the raw data: URL).
    fetch(s.dataUrl)
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
  }

  function validate(): boolean {
    const r = validateVendorForm(values);
    setErrors(r.errors);
    if (Object.keys(r.errors).length) {
      setFormError('Please fix the highlighted fields.');
      return false;
    }
    setFormError('');
    if (r.warnings.length) {
      setWarnings(r.warnings);
      return false;
    }
    return true;
  }

  async function doSave() {
    setWarnings([]);
    const isNew = !editing;
    let payload = buildVendorPayload(values, slots, editing);
    if (isNew && vendors.some((v) => v.vendorId.toLowerCase() === payload.vendorId.toLowerCase())) {
      // Never overwrite an existing vendor from the "new vendor" form.
      payload = buildVendorPayload({ ...values, vendorId: nextVendorId(vendors) }, slots, null);
    }
    try {
      const r = await save.mutateAsync({ college, vendor: payload, create: isNew });
      toast(isNew ? `Vendor ${payload.vendorId} & vendor ledger created.` : `Vendor ${payload.vendorId} updated.`);
      onSaved(r.vendor, isNew);
      if (isNew) {
        setValues(emptyValues(nextVendorId([...vendors, { vendorId: payload.vendorId } as Vendor])));
        setSlots([null, null, null]);
        wordsTouched.current = false;
      }
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (validate()) void doSave();
  }

  const input = (k: keyof VendorFormValues, label: string, opts: { required?: boolean; placeholder?: string; type?: string; maxLength?: number; className?: string; upper?: boolean } = {}) => (
    <Field label={label} required={opts.required} error={errors[k]} className={opts.className} htmlFor={`vf-${k}`}>
      <Input
        id={`vf-${k}`}
        type={opts.type ?? 'text'}
        value={values[k]}
        maxLength={opts.maxLength}
        placeholder={opts.placeholder}
        onChange={(e) => set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
        aria-invalid={!!errors[k]}
      />
    </Field>
  );

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      <Card
        title={editing ? `Edit Vendor ${editing.vendorId}` : 'New Vendor & Agreement'}
        actions={
          <span className="rounded-md bg-maroon-50 px-2 py-1 font-mono text-sm font-semibold text-maroon-700" title="Permanent vendor ID">
            {values.vendorId}
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {input('companyName', 'Vendor Company Name', { required: true, placeholder: 'Enter vendor company name' })}
          {input('vendorName', 'Vendor Name', { required: true, placeholder: 'Enter vendor name' })}
          {input('phone', 'Phone Number', { required: true, type: 'tel', maxLength: 15, placeholder: '10 digit mobile number' })}
          {input('pan', 'PAN Number', { required: true, maxLength: 10, placeholder: 'ABCDE1234F', upper: true })}
          {input('aadhaar', 'Aadhaar Number', { maxLength: 14, placeholder: '12 digit Aadhaar number' })}
          {input('email', 'Email', { type: 'email', placeholder: 'Optional' })}
          {input('gstNumber', 'GST Number', { placeholder: 'If applicable', upper: true })}
          <Field label="Address" className="md:col-span-2" htmlFor="vf-address">
            <Input id="vf-address" value={values.address} placeholder="Complete address" onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Work Description / Scope of Work" required error={errors.workDescription} className="md:col-span-2 lg:col-span-3" htmlFor="vf-work">
            <Textarea id="vf-work" rows={3} value={values.workDescription} onChange={(e) => set('workDescription', e.target.value)} aria-invalid={!!errors.workDescription} />
          </Field>
          <Field label="Agreed Amount (₹)" required error={errors.agreedAmount} htmlFor="vf-amount">
            <Input
              id="vf-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={values.agreedAmount}
              onChange={(e) => set('agreedAmount', e.target.value)}
              aria-invalid={!!errors.agreedAmount}
            />
          </Field>
          <Field label="Amount in Words" className="md:col-span-1 lg:col-span-2" htmlFor="vf-words">
            <Input
              id="vf-words"
              value={values.amountInWords}
              onChange={(e) => {
                wordsTouched.current = true;
                set('amountInWords', e.target.value);
              }}
            />
          </Field>
          {input('periodStart', 'Agreement Start Date', { required: true, type: 'date' })}
          {input('periodEnd', 'Agreement End Date', { type: 'date' })}
          <Field label="Agreement Status" htmlFor="vf-status">
            <Select id="vf-status" value={values.status} onChange={(e) => set('status', e.target.value)}>
              <option value="Active">Active (automatic by dates)</option>
              <option value="Completed">Completed</option>
              <option value="Terminated">Terminated</option>
            </Select>
          </Field>
          {input('bankAccountDetails', 'Bank Account Details', { placeholder: 'Optional', className: 'md:col-span-2' })}
          {input('remarks', 'Remarks', { placeholder: 'Optional' })}
          {input('authBy', 'Authorized By', { placeholder: 'e.g. Principal / Secretary / Director' })}
          {input('authRole', 'Designation', { placeholder: 'e.g. Principal / AO / Finance Head' })}
          {input('authPlace', 'Place', { placeholder: 'Chebrolu / Guntur' })}
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-600">Agreement documents (up to 3 · PDF, Word, PNG, JPEG · max 5 MB each)</p>
          <div className="grid gap-3 md:grid-cols-3">
            {slots.map((s, i) =>
              s ? (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gold-500/50 bg-yellow-50/40 px-3 py-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openSlot(s)} title="Open file">
                    <p className="truncate text-sm font-medium">{s.kind === 'existing' ? s.file.name : s.name}</p>
                    <p className="text-xs text-sand-600">
                      {formatFileSize(s.kind === 'existing' ? s.file.size : s.size)} · {s.kind === 'new' ? 'not saved yet' : 'click to open'}
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove file"
                    className="rounded p-1 text-debit hover:bg-red-50"
                    onClick={() => setSlots((x) => x.map((y, j) => (j === i ? null : y)))}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label
                  key={i}
                  className={cx('flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-sand-200 px-3 py-2 hover:bg-sand-50')}
                >
                  <span aria-hidden>📄</span>
                  <span className="text-sm text-sand-600">Choose file…</span>
                  <input
                    type="file"
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      void pickFile(i, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              ),
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <ErrorBox>{formError}</ErrorBox>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}>
              💾 {editing ? `Update Vendor (${editing.vendorId})` : 'Save Vendor'}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                onPreview({
                  ...buildVendorPayload(values, slots, editing),
                  college,
                  files: slots.flatMap((s) =>
                    !s ? [] : s.kind === 'existing' ? [s.file] : [{ id: '', name: s.name, size: s.size, type: s.type }],
                  ),
                } as Partial<Vendor>)
              }
            >
              🖨 Preview Agreement
            </Button>
            {editing ? (
              <Button variant="ghost" onClick={onCancelEdit}>
                Cancel edit
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setValues(emptyValues(suggestedId));
                  setSlots([null, null, null]);
                  setErrors({});
                  wordsTouched.current = false;
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={warnings.length > 0}
        title="Please confirm"
        message={
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            <li className="list-none pt-2 font-medium">Save anyway?</li>
          </ul>
        }
        confirmLabel="Save anyway"
        loading={save.isPending}
        onConfirm={() => void doSave()}
        onCancel={() => setWarnings([])}
      />
    </form>
  );
}
