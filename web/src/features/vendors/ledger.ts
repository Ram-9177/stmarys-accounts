/**
 * Vendor ledger engine (pure functions, ported from legacy/vendor.js).
 *
 * Rules carried over from the legacy system:
 *  - Only DEBIT vouchers count as payments to a vendor.
 *  - A voucher is linked to a vendor ONLY through its vendorId (never by party name).
 *  - Payments dated before the agreement start date (or, if none, the vendor
 *    creation date) are excluded from the ledger.
 *  - Payments are listed oldest first (date, then voucher id).
 */
import type { Vendor, Voucher } from '@/api/types';
import { todayISO, toISO } from '@/lib/format';

/** Lower-cases and strips punctuation, as the legacy matcher did ("V-00001" == "v00001"). */
export function normVendorId(id: unknown): string {
  return String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Next sequential permanent vendor ID: V00001, V00002, ... (max existing + 1). */
export function nextVendorId(vendors: Pick<Vendor, 'vendorId'>[]): string {
  let max = 0;
  for (const v of vendors) {
    const m = /V(\d+)/i.exec(String(v.vendorId ?? ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'V' + String(max + 1).padStart(5, '0');
}

/** ISO date (YYYY-MM-DD) from any of the formats the legacy data used. */
export function isoDate(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, '-');
  return toISO(s);
}

export function vendorPeriodStart(v: Partial<Vendor>): string {
  return isoDate(v.periodStart || v.agreement?.periodStart || v.agreementDate || '');
}

export function vendorPeriodEnd(v: Partial<Vendor>): string {
  return isoDate(v.periodEnd || v.agreement?.periodEnd || '');
}

/** Payments before this date are not part of the vendor's ledger. */
export function vendorCutoffDate(v: Partial<Vendor>): string {
  return vendorPeriodStart(v) || isoDate(v.createdAt ? String(v.createdAt).slice(0, 10) : '');
}

export function agreementNumber(v: Partial<Vendor>): string {
  const stored = v.agreement?.agreementNo;
  if (stored) return String(stored);
  return `AGR-${v.vendorId ?? ''}`;
}

/** Agreement number generated on save (legacy: AGR-<vendorId>-<start year>). */
export function newAgreementNumber(vendorId: string, periodStart: string): string {
  const year = (periodStart || '').slice(0, 4) || String(new Date().getFullYear());
  return `AGR-${vendorId}-${year}`;
}

export function linkedPayments(vendor: Partial<Vendor>, vouchers: Voucher[]): Voucher[] {
  const vid = normVendorId(vendor.vendorId);
  if (!vid) return [];
  const cutoff = vendorCutoffDate(vendor);
  return vouchers
    .filter((v) => v.type === 'debit' && normVendorId(v.vendorId) === vid && !(cutoff && v.date && v.date < cutoff))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

export interface VendorFinancials {
  vendor: Vendor;
  agreedAmount: number;
  totalPaid: number;
  balance: number;
  /** 0-100, capped at 100 */
  paidPercent: number;
  vouchersCount: number;
  status: PaymentStatus;
  payments: Voucher[];
}

export function vendorFinancials(vendor: Vendor, vouchers: Voucher[]): VendorFinancials {
  const agreed = Number(vendor.agreedAmount) || 0;
  const payments = linkedPayments(vendor, vouchers);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const status: PaymentStatus = agreed > 0 && totalPaid >= agreed ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
  return {
    vendor,
    agreedAmount: agreed,
    totalPaid,
    balance: agreed - totalPaid,
    paidPercent: agreed > 0 ? Math.min(100, Math.round((totalPaid / agreed) * 100)) : 0,
    vouchersCount: payments.length,
    status,
    payments,
  };
}

/** Builds financials for many vendors with one pass over the vouchers. */
export function allVendorFinancials(vendors: Vendor[], vouchers: Voucher[]): VendorFinancials[] {
  const byId = new Map<string, Voucher[]>();
  for (const v of vouchers) {
    if (v.type !== 'debit') continue;
    const id = normVendorId(v.vendorId);
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(v);
    else byId.set(id, [v]);
  }
  return vendors.map((vendor) => vendorFinancials(vendor, byId.get(normVendorId(vendor.vendorId)) ?? []));
}

export type AgreementStatusKey = 'active' | 'expiring_soon' | 'expired' | 'not_started' | 'completed' | 'terminated';

export interface AgreementStatus {
  key: AgreementStatusKey;
  label: string;
  detail: string;
}

export const AGREEMENT_STATUS_OPTIONS: { key: AgreementStatusKey; label: string }[] = [
  { key: 'active', label: '🟢 Active' },
  { key: 'expiring_soon', label: '🟡 Expiring Soon (≤30d)' },
  { key: 'expired', label: '🔴 Expired' },
  { key: 'not_started', label: '⏳ Not Started' },
  { key: 'completed', label: '🔵 Completed' },
  { key: 'terminated', label: '⛔ Terminated' },
];

const DAY = 86_400_000;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);

/** Active / Expiring soon (≤30 days) / Expired / Not started, unless explicitly Completed or Terminated. */
export function agreementStatus(v: Partial<Vendor>, today = todayISO()): AgreementStatus {
  const explicit = String(v.status ?? '').toLowerCase();
  if (explicit === 'terminated') return { key: 'terminated', label: 'Terminated', detail: '' };
  if (explicit === 'completed') return { key: 'completed', label: 'Completed', detail: '' };
  const start = vendorPeriodStart(v);
  const end = vendorPeriodEnd(v);
  if (start && start > today) return { key: 'not_started', label: 'Not Started', detail: `Starts in ${dayDiff(today, start)}d` };
  if (end && end < today) return { key: 'expired', label: 'Expired', detail: `${dayDiff(end, today)}d ago` };
  if (end) {
    const left = dayDiff(today, end);
    if (left <= 30) return { key: 'expiring_soon', label: 'Expiring Soon', detail: `${left}d left` };
  }
  return { key: 'active', label: 'Active', detail: '' };
}

/** Shows only the last 4 digits of an Aadhaar number. */
export function maskAadhaar(aadhaar: string | null | undefined): string {
  const digits = String(aadhaar ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return '•'.repeat(digits.length);
  return 'XXXX XXXX ' + digits.slice(-4);
}

/** Search across ID, company, contact, phone, PAN, Aadhaar, GST, address and work description. */
export function matchesVendorSearch(v: Partial<Vendor>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [v.vendorId, v.companyName, v.vendorName, v.phone, v.pan, v.aadhaar, v.gstNumber, v.address, v.workDescription];
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

export type PaymentFilter = '' | 'pending' | 'partial' | 'paid' | 'unpaid';

export function matchesPaymentFilter(f: VendorFinancials, filter: PaymentFilter): boolean {
  switch (filter) {
    case 'pending':
      return f.balance > 0;
    case 'partial':
      return f.totalPaid > 0 && f.balance > 0;
    case 'paid':
      return f.balance <= 0 && f.agreedAmount > 0;
    case 'unpaid':
      return f.totalPaid <= 0;
    default:
      return true;
  }
}

/** Agreement period overlaps [from, to] (either bound optional) - same rule as the legacy filter. */
export function matchesPeriod(v: Partial<Vendor>, from: string, to: string): boolean {
  const start = vendorPeriodStart(v);
  const end = vendorPeriodEnd(v);
  if (from && start && start < from && (!end || end < from)) return false;
  if (to && start && start > to) return false;
  return true;
}

// ---------------- Form validation ----------------

export interface VendorFormValues {
  vendorId: string;
  companyName: string;
  vendorName: string;
  phone: string;
  pan: string;
  aadhaar: string;
  email: string;
  address: string;
  workDescription: string;
  agreedAmount: string;
  amountInWords: string;
  periodStart: string;
  periodEnd: string;
  gstNumber: string;
  bankAccountDetails: string;
  remarks: string;
  authBy: string;
  authRole: string;
  authPlace: string;
  status: string;
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Hard errors block saving; warnings ask the user to confirm (legacy used confirm() for PAN/Aadhaar format). */
export function validateVendorForm(f: VendorFormValues): { errors: Partial<Record<keyof VendorFormValues, string>>; warnings: string[] } {
  const errors: Partial<Record<keyof VendorFormValues, string>> = {};
  const warnings: string[] = [];
  if (!f.vendorId.trim()) errors.vendorId = 'Vendor ID is required';
  if (!f.companyName.trim()) errors.companyName = 'Enter the vendor company name';
  if (!f.vendorName.trim()) errors.vendorName = 'Enter the vendor name';
  if (!f.phone.trim()) errors.phone = 'Enter the vendor phone number';
  const pan = f.pan.trim().toUpperCase();
  if (!pan) errors.pan = 'Enter the vendor PAN number';
  else if (!PAN_RE.test(pan)) warnings.push(`PAN "${pan}" does not match the standard format (e.g. ABCDE1234F).`);
  const aadhaar = f.aadhaar.replace(/\s+/g, '');
  if (aadhaar && !/^\d{12}$/.test(aadhaar)) warnings.push(`Aadhaar "${f.aadhaar}" is not a 12-digit number.`);
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.email = 'Invalid email address';
  if (!f.workDescription.trim()) errors.workDescription = 'Enter the work description / scope of work';
  const amount = parseFloat(f.agreedAmount);
  if (!amount || amount <= 0) errors.agreedAmount = 'Enter the agreed amount';
  else if (amount > 10_000_000_000) errors.agreedAmount = 'Amount is too large';
  if (!f.periodStart) errors.periodStart = 'Select the agreement start date';
  if (f.periodStart && f.periodEnd && f.periodEnd < f.periodStart) errors.periodEnd = 'End date cannot be before the start date';
  return { errors, warnings };
}
