import { Link } from 'react-router';
import type { Voucher } from '@/api/types';
import { Badge, Button, Input } from '@/components/ui';
import { VOUCHER_TYPE_LABEL } from '@/lib/format';
import type { DateRange } from './calc';

export function TypeBadge({ type }: { type: Voucher['type'] }) {
  return <Badge tone={type}>{VOUCHER_TYPE_LABEL[type] ?? type}</Badge>;
}

/** Small badge showing the linked vendor id; opens the vendor ledger. */
export function VendorBadge({ vendorId }: { vendorId: string }) {
  if (!vendorId) return null;
  return (
    <Link
      to={`/vendor-ledger?vendor=${encodeURIComponent(vendorId)}`}
      title={`View vendor ledger for ${vendorId}`}
      className="ml-1 inline-block rounded bg-[#002d72] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
    >
      🏢 {vendorId}
    </Link>
  );
}

/** From / To date inputs with a Clear button. */
export function DateRangeFilter({ value, onChange, idPrefix = 'range' }: { value: DateRange; onChange: (r: DateRange) => void; idPrefix?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${idPrefix}-from`} className="sr-only">
        From date
      </label>
      <Input
        id={`${idPrefix}-from`}
        type="date"
        value={value.from}
        max={value.to || undefined}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="h-9 w-40"
      />
      <span className="text-xs font-semibold text-sand-600">TO</span>
      <label htmlFor={`${idPrefix}-to`} className="sr-only">
        To date
      </label>
      <Input
        id={`${idPrefix}-to`}
        type="date"
        value={value.to}
        min={value.from || undefined}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="h-9 w-40"
      />
      <Button variant="secondary" size="sm" onClick={() => onChange({ from: '', to: '' })} disabled={!value.from && !value.to}>
        Clear
      </Button>
    </div>
  );
}

export const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Prints a self-contained HTML document from a hidden iframe (no popup needed).
 * All dynamic text in `html` must already be escaped with escapeHtml.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const cleanup = () => {
      setTimeout(() => frame.remove(), 500);
      resolve();
    };
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const go = () => {
      win.addEventListener('afterprint', cleanup, { once: true });
      win.focus();
      win.print();
      // Some browsers never fire afterprint for iframes.
      setTimeout(cleanup, 60_000);
    };
    if (doc.readyState === 'complete') setTimeout(go, 50);
    else frame.addEventListener('load', go, { once: true });
  });
}
