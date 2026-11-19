/** Formatting helpers - outputs match the legacy app so printed vouchers look identical. */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + words(n % 100) : '');
  if (n < 100000) return words(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + words(n % 1000) : '');
  if (n < 10000000) return words(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + words(n % 100000) : '');
  return words(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + words(n % 10000000) : '');
}

/** Indian numbering: 125000 -> "One Lakh Twenty Five Thousand Rupees Only". */
export function amountInWords(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!n || Number.isNaN(n) || n < 0) return '';
  const [r, p = '00'] = String(n).split('.');
  const rupees = parseInt(r, 10) || 0;
  const paise = parseInt(p.substring(0, 2).padEnd(2, '0'), 10);
  let w = words(rupees) + ' Rupees';
  if (paise > 0) w += ' and ' + words(paise) + ' Paise';
  return w + ' Only';
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** ₹1,25,000 */
export const formatINR = (n: number) => '₹' + inr.format(Number(n) || 0);
export const formatNumber = (n: number) => inr.format(Number(n) || 0);

const pad = (n: number) => String(n).padStart(2, '0');

/** Local (not UTC) today as YYYY-MM-DD. */
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD -> DD/MM/YYYY (also passes DD/MM/YYYY through). */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso).trim().replace(/\//g, '-');
  const p = s.split('-');
  if (p.length !== 3) return String(iso);
  if (p[0].length === 4) return `${p[2].slice(0, 2).padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[0]}`;
  if (p[2].length === 4) return `${p[0].padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[2]}`;
  return String(iso);
}

/** DD/MM/YYYY (or ISO) -> YYYY-MM-DD */
export function toISO(s: string): string {
  const v = String(s || '').trim().replace(/\//g, '-');
  const p = v.split('-');
  if (p.length !== 3) return v;
  if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
  if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  return v;
}

/** Timestamp -> "19/11/2026 01:05 PM" (or date only). */
export function dateTime(ts: string | Date | null | undefined, dateOnly = false): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (dateOnly) return date;
  const h = d.getHours();
  return `${date} ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const VOUCHER_TYPE_LABEL = { debit: 'Debit', credit: 'Credit', onaccount: 'On Account' } as const;

/** Who the money went to / came from, as shown in lists. */
export function voucherParty(v: { paidTo: string; receivedFrom: string; acName: string }): string {
  return v.paidTo || v.receivedFrom || v.acName || '';
}
