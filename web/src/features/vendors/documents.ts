/**
 * Printable vendor documents (agreement + ledger statement), ported from legacy/vendor.js.
 * Every value is HTML-escaped; documents are printed from a hidden iframe that only
 * ever receives static markup (no scripts).
 */
import type { Vendor } from '@/api/types';
import { dateTime, dmy, formatINR } from '@/lib/format';
import { agreementNumber, vendorPeriodEnd, vendorPeriodStart, type VendorFinancials } from './ledger';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const e = escapeHtml;

export function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const DEFAULT_PLACE = 'Chebrolu / Guntur';

const td = 'padding:4px 8px;border:1px solid #cbd5e1;';
const sep = 'padding:4px 3px;border:1px solid #cbd5e1;text-align:center;font-weight:bold;width:3%;';
const sectionTag = (t: string) =>
  `<div style="display:inline-block;background:#5a1220;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px;">${e(t)}</div>`;
const row = (label: string, value: string, valueStyle = '') =>
  `<tr><td style="${td}font-weight:600;width:28%;">${e(label)}</td><td style="${sep}">:</td><td style="${td}${valueStyle}">${value}</td></tr>`;

/** The one-page "VENDOR AGREEMENT" sheet (same sections and wording as the legacy print). */
export function agreementHtml(v: Partial<Vendor>, collegeName: string, files: { name: string; size: number }[] = v.files ?? []): string {
  const start = dmy(vendorPeriodStart(v)) || '—';
  const end = dmy(vendorPeriodEnd(v)) || '—';
  const company = String(v.companyName || '').toUpperCase() || '—';
  const name = v.vendorName || '—';
  let words = String(v.amountInWords || '');
  if (words && !words.includes('(')) words = `(${words})`;
  const place = v.authPlace || DEFAULT_PLACE;
  const filesHtml = files.length
    ? `<div style="margin-top:8px;font-size:11px;color:#475569;background:#f8fafc;padding:5px 8px;border-radius:4px;border:1px solid #e2e8f0;"><b>Attached Agreement Documents (${files.length} files):</b> ${files
        .map((f, i) => `${i + 1}. ${e(f.name)} (${formatFileSize(f.size)})`)
        .join(' &bull; ')}</div>`
    : '';
  const line = (label: string, value: string, w = 85) =>
    `<div style="margin-bottom:5px;display:flex;align-items:center;"><span style="width:${w}px;color:#475569;">${label}</span><span style="border-bottom:1px solid #94a3b8;flex:1;min-height:16px;padding-bottom:1px;">${value || '&nbsp;'}</span></div>`;

  return `<div style="background:#fff;padding:18px 24px;color:#111;font-family:Inter,Arial,sans-serif;line-height:1.35;max-width:760px;margin:0 auto;border:1.5px solid #cbd5e1;box-sizing:border-box;">
  <div style="text-align:center;margin-bottom:12px;">
    <div style="font-size:14.5px;font-weight:800;color:#5a1220;letter-spacing:.5px;text-transform:uppercase;margin:0 0 3px;">${e(collegeName)}</div>
    <h1 style="font-size:17px;font-weight:800;color:#b91c1c;text-decoration:underline;letter-spacing:.8px;margin:0 0 4px;">VENDOR AGREEMENT</h1>
    <p style="font-size:11px;color:#333;margin:0;">This Vendor Agreement is made between the concerned party/organization and the following vendor:</p>
    <p style="font-size:10.5px;color:#475569;margin:4px 0 0;font-family:monospace;">Agreement No: ${e(agreementNumber(v))} &nbsp;·&nbsp; Vendor ID: ${e(v.vendorId)}</p>
  </div>
  <div style="margin-bottom:10px;">
    ${sectionTag('1. Vendor Details')}
    <table style="width:100%;border-collapse:collapse;border:1.5px solid #94a3b8;font-size:11px;">
      ${row('Vendor Company Name', e(company), 'font-weight:700;color:#b91c1c;')}
      ${row('Vendor Name', e(name), 'font-weight:600;color:#b91c1c;')}
      ${row('Vendor Phone Number', e(v.phone || '—'))}
      ${row('Vendor PAN Number', e(v.pan || '—'), 'font-family:monospace;font-weight:700;')}
      ${v.aadhaar ? row('Vendor Aadhaar Number', e(v.aadhaar), 'font-family:monospace;font-weight:700;') : ''}
      ${v.gstNumber ? row('GST Number', e(v.gstNumber), 'font-family:monospace;') : ''}
      ${row('Vendor Address', e(v.address || '—'))}
      ${row('Work Description', e(v.workDescription || '—'), 'white-space:pre-wrap;')}
      <tr style="background:#fdf2f4;"><td style="${td}font-weight:600;">Vendor Amount (Agreed)</td><td style="${sep}">:</td><td style="${td}"><span style="font-weight:700;color:#b91c1c;font-size:12px;margin-right:6px;">${e(
        formatINR(Number(v.agreedAmount) || 0),
      )}</span><span style="font-size:10.5px;color:#334155;">${e(words)}</span></td></tr>
    </table>
    ${filesHtml}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-bottom:10px;align-items:start;">
    <div>
      ${sectionTag('2. Agreement Period')}
      <table style="width:100%;border-collapse:collapse;border:1px solid #94a3b8;font-size:11px;">
        <tr><td style="${td}font-weight:600;width:35%;">Start Date</td><td style="${sep}">:</td><td style="${td}">${e(start)}</td></tr>
        <tr><td style="${td}font-weight:600;">End Date</td><td style="${sep}">:</td><td style="${td}">${e(end)}</td></tr>
      </table>
    </div>
    <div>
      ${sectionTag('3. Authorization')}
      <p style="font-size:10.5px;color:#222;margin:0;">By signing below, both parties acknowledge and agree to the terms and conditions stated in this Vendor Agreement.</p>
    </div>
  </div>
  <div style="border:1.5px solid #94a3b8;border-radius:4px;overflow:hidden;margin-bottom:8px;font-size:11px;display:grid;grid-template-columns:1fr 1fr;">
    <div style="padding:8px 12px;border-right:1px solid #cbd5e1;">
      <div style="font-weight:700;color:#5a1220;text-align:center;margin-bottom:6px;letter-spacing:.5px;">FOR THE ORGANIZATION</div>
      <div style="margin-bottom:5px;"><b>Authorized Signatory</b></div>
      ${line('Name:', e(v.authBy))}${line('Designation:', e(v.authRole))}${line('Signature:', '')}${line('Date:', e(start))}
    </div>
    <div style="padding:8px 12px;">
      <div style="font-weight:700;color:#b91c1c;text-align:center;margin-bottom:6px;letter-spacing:.5px;">FOR ${e(company)}</div>
      ${line('Vendor:', `<b style="color:#b91c1c">${e(name)}</b>`, 75)}${line('Signature:', '', 75)}${line('Date:', e(start), 75)}${line('Seal:', '', 75)}
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:11px;color:#334155;padding:2px 4px 0;">
    <div>Date: <span style="border-bottom:1px solid #94a3b8;display:inline-block;min-width:140px;padding:0 4px;">${e(start)}</span></div>
    <div>Place: <span style="border-bottom:1px solid #94a3b8;display:inline-block;min-width:140px;padding:0 4px;">${e(place)}</span></div>
  </div>
</div>`;
}

/** "VENDOR LEDGER ACCOUNT STATEMENT" with every linked debit voucher and the totals. */
export function ledgerStatementHtml(fin: VendorFinancials, collegeName: string): string {
  const v = fin.vendor;
  const cell = 'padding:5px 6px;border:1px solid #cbd5e1;';
  const rows = fin.payments
    .map(
      (p, i) => `<tr>
      <td style="${cell}text-align:center;">${i + 1}</td>
      <td style="${cell}">${e(dmy(p.date))}</td>
      <td style="${cell}font-family:monospace;">${e(p.voucherNo)}</td>
      <td style="${cell}">${e(p.head || 'Debit')}</td>
      <td style="${cell}">${e(p.towards || '—')}</td>
      <td style="${cell}">${e(p.mode || 'Cash')}${p.cheque ? ` (Ref: ${e(p.cheque)})` : ''}</td>
      <td style="${cell}text-align:right;font-weight:700;color:#15803d;">${e(formatINR(p.amount))}</td>
    </tr>`,
    )
    .join('');
  const total = (label: string, value: number, color: string, strong = false) =>
    `<tr${strong ? ' style="background:#fdf2f4;"' : ''}><td colspan="6" style="${cell}text-align:right;font-weight:${strong ? 800 : 700};">${label}</td><td style="${cell}text-align:right;font-weight:800;color:${color};">${e(formatINR(value))}</td></tr>`;

  return `<div style="background:#fff;padding:24px 28px;color:#111;font-family:Inter,Arial,sans-serif;line-height:1.4;max-width:800px;margin:0 auto;box-sizing:border-box;">
  <div style="text-align:center;border-bottom:2px solid #5a1220;padding-bottom:10px;margin-bottom:14px;">
    <h2 style="margin:0;font-size:15px;color:#5a1220;font-weight:800;text-transform:uppercase;">${e(collegeName)}</h2>
    <h1 style="margin:4px 0 0;font-size:18px;color:#b91c1c;font-weight:800;letter-spacing:.8px;">VENDOR LEDGER ACCOUNT STATEMENT</h1>
    <p style="margin:2px 0 0;font-size:11.5px;color:#64748b;">Statement of Contract Disbursements &amp; Debit Vouchers · Generated ${e(dateTime(new Date()))}</p>
  </div>
  <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-bottom:14px;font-size:12px;background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0;">
    <div>
      <p style="margin:2px 0;"><b>Vendor ID:</b> <span style="font-family:monospace;font-weight:800;">${e(v.vendorId)}</span></p>
      <p style="margin:2px 0;"><b>Vendor / Company:</b> <span style="font-weight:700;color:#b91c1c;">${e(v.companyName)}</span></p>
      <p style="margin:2px 0;"><b>Contact Person:</b> ${e(v.vendorName)} (${e(v.phone)})</p>
      <p style="margin:2px 0;"><b>PAN Number:</b> <span style="font-family:monospace;font-weight:700;">${e(v.pan)}</span></p>
    </div>
    <div>
      <p style="margin:2px 0;"><b>Agreement No:</b> <span style="font-family:monospace;">${e(agreementNumber(v))}</span></p>
      <p style="margin:2px 0;"><b>Contract Period:</b> ${e(dmy(vendorPeriodStart(v)) || '—')} to ${e(dmy(vendorPeriodEnd(v)) || '—')}</p>
      <p style="margin:2px 0;"><b>Agreed Contract Value:</b> <span style="font-weight:700;color:#b91c1c;">${e(formatINR(fin.agreedAmount))}</span></p>
      <p style="margin:2px 0;"><b>Total Paid to Date:</b> <span style="font-weight:700;color:#15803d;">${e(formatINR(fin.totalPaid))} (${fin.paidPercent}%)</span></p>
    </div>
  </div>
  <h3 style="font-size:12.5px;font-weight:700;color:#5a1220;margin-bottom:6px;text-transform:uppercase;">Itemized Debit Voucher Transactions</h3>
  <table style="width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:16px;">
    <thead><tr style="background:#5a1220;color:#fff;">
      <th style="padding:5px 6px;width:35px;">#</th><th style="padding:5px 6px;text-align:left;">Date</th><th style="padding:5px 6px;text-align:left;">Voucher No</th>
      <th style="padding:5px 6px;text-align:left;">Debit Head</th><th style="padding:5px 6px;text-align:left;">Towards / Purpose</th>
      <th style="padding:5px 6px;text-align:left;">Payment Mode</th><th style="padding:5px 6px;text-align:right;">Amount (Rs.)</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:16px;color:#888;">No debit vouchers recorded yet.</td></tr>'}</tbody>
    <tfoot>
      ${total('TOTAL AMOUNT DISBURSED:', fin.totalPaid, '#15803d')}
      ${total('AGREED CONTRACT AMOUNT:', fin.agreedAmount, '#b91c1c')}
      ${total('OUTSTANDING BALANCE PENDING:', fin.balance, fin.balance <= 0 ? '#15803d' : '#b45309', true)}
    </tfoot>
  </table>
  <div style="display:flex;justify-content:space-between;margin-top:35px;padding:0 20px;font-size:11.5px;">
    <div style="border-top:1px solid #333;width:180px;padding-top:4px;text-align:center;">Authorized Signatory / AO</div>
    <div style="border-top:1px solid #333;width:180px;padding-top:4px;text-align:center;">Principal / Management</div>
  </div>
</div>`;
}

/** Prints static HTML through a hidden iframe (no popup blockers, no scripts). */
export function printHtml(bodyHtml: string, title: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>@page{size:A4;margin:10mm}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();
  const cleanup = () => setTimeout(() => iframe.remove(), 500);
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(cleanup, 60_000); // fallback if afterprint never fires
  }, 150);
}
