/**
 * Voucher printing. Reproduces the legacy pre-printed voucher layout (148mm wide, A5),
 * placed on the page according to the saved paper setting, and printed from a hidden iframe.
 * All user-entered text goes through esc() - nothing is inserted raw.
 */
import type { College, Voucher } from '@/api/types';
import { collegeLogo } from '@/lib/colleges';
import { dmy } from '@/lib/format';
import { ensureLogo, inlineLogo } from '@/lib/logoCache';
import { getPrintSettings, type PaperSize, type PrintSettings } from './printSettings';
import { buildEscPosVoucher, isSerialConnected, sendToSerial } from './serial';

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Letterhead text per campus (exactly as on the physical vouchers). Values are trusted constants. */
const LETTERHEAD: Record<string, { title: string; sub: string[] }> = {
  smgg: {
    title: "ST. MARY'S GROUP OF INSTITUTIONS GUNTUR",
    sub: [
      "( Formerly St. Mary Engineering College, St. Mary's PG Centre, St. Mary's College of Pharmacy)",
      '(Joseph Sriharsha &amp; Mary Indraja Educational Society)',
      'CHEBROLU (Vill &amp; Mdl), Guntur Dist – 522 212',
    ],
  },
  smwec: {
    title: "ST. MARY'S WOMEN'S ENGINEERING COLLEGE",
    sub: [
      '(Approved by AICTE, Permitted by Govt. of A.P. &amp; Affiliated to JNTU KAKINADA)',
      '(Joseph Sriharsha &amp; Mary Indraja Educational Society)',
      'BUDAMPADU VILLAGE, Guntur Rural, Guntur (Dt) - 522 017, A.P., INDIA',
    ],
  },
  smhyd: {
    title: "ST. MARY'S ENGINEERING COLLEGE",
    sub: [
      "(Approved by AICTE, Affiliated to JNTU HYDERABAD &amp; Accredited by NAAC with 'A' Grade)",
      '(Joseph Sriharsha &amp; Mary Indraja Educational Society)',
      'Deshmukhi (V), Near Ramoji Film City, Greater HYDERABAD – 508 284',
    ],
  },
};

const TYPE_TEXT = { credit: 'CREDIT VOUCHER', debit: 'DEBIT VOUCHER', onaccount: 'ON ACCOUNT VOUCHER' } as const;

/** Splits "towards" across exactly 3 dotted lines, filling each before the next (legacy ROWT). */
export function towardsLines(text: string, perLine = 52): [string, string, string] {
  const lines: [string, string, string] = ['', '', ''];
  let i = 0;
  for (const w of (text || '').split(' ').filter(Boolean)) {
    if (i >= 3) break;
    const candidate = lines[i] ? `${lines[i]} ${w}` : w;
    if (candidate.length <= perLine || !lines[i]) lines[i] = candidate;
    else if (++i < 3) lines[i] = w;
  }
  return lines;
}

/** The voucher itself (148mm wide). Safe to embed: every dynamic value is escaped. */
export function buildVoucherHtml(v: Voucher, college: College | undefined, settings: Pick<PrintSettings, 'color'> = getPrintSettings()): string {
  const code = v.college || college?.code || 'smgg';
  const head = LETTERHEAD[code] ?? { title: esc((college?.name ?? "St. Mary's").toUpperCase()), sub: [esc(college?.location ?? '')] };
  const logo = esc(inlineLogo(collegeLogo(college ?? code)));
  const bar = settings.color ? '#7B1D2E' : '#2b2b2b';
  const S = 'font-family:Arial,sans-serif;font-size:9.5pt;font-weight:700;white-space:nowrap';
  const LINE = 'border-bottom:1.5px dotted #555;flex:1;min-height:16px;padding-left:4px;font-size:9pt;font-family:Arial,sans-serif;line-height:1.5';

  const row = (label: string, value: string) =>
    `<div style="display:flex;align-items:flex-end;margin-bottom:5px"><span style="${S};min-width:90px;flex-shrink:0">${label}</span><span style="${LINE}">${esc(value)}</span></div>`;
  const towards = (value: string) =>
    `<div style="display:flex;align-items:flex-start;margin-bottom:5px"><span style="${S};min-width:90px;flex-shrink:0;padding-top:2px">Towards</span><div style="flex:1;display:flex;flex-direction:column;gap:4px">${towardsLines(value)
      .map((l) => `<div style="${LINE}">${l ? esc(l) : '&nbsp;'}</div>`)
      .join('')}</div></div>`;

  let fields = '';
  if (v.type === 'credit') {
    fields += row('Credit A/c', [v.acName, v.head].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' — '));
    fields += row('Received from', v.receivedFrom);
  } else {
    fields += row(v.type === 'onaccount' ? 'On Account' : 'Debit A/c', v.type === 'onaccount' ? '' : v.head);
    fields += row('Paid to', v.paidTo);
  }
  fields += row('Rupees', v.amtWords);
  fields += towards(v.towards);
  fields += row('Block', v.block);
  if (v.type === 'onaccount') {
    const status = v.reversalDate ? `CLEAR — ${dmy(v.reversalDate)}` : 'PENDING';
    fields += row('Status', status + (v.recipientPhone ? ` / Ph: ${v.recipientPhone}` : ''));
  }
  if (v.remarks) fields += row('Remarks', v.remarks);

  const sig = v.type === 'credit' ? 'Deposited by' : 'Signature of the Receiver';
  return `<div class="smv-voucher" style="width:148mm;background:#fff;border:2px solid #111;font-family:Arial,sans-serif;box-sizing:border-box;color:#111">
  <div style="display:flex;border-bottom:2px solid #111">
    <div style="width:52px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:3px"><img src="${logo}" width="46" height="46" alt="" style="object-fit:contain;display:block;mix-blend-mode:multiply"></div>
    <div style="flex:1;padding:3px 6px 3px 5px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
      <div style="font-size:12pt;font-weight:900;line-height:1.2;font-family:'Arial Black',Arial,sans-serif;letter-spacing:.3px">${head.title}</div>
      <div style="font-size:6.5pt;line-height:1.5">${head.sub.join('<br>')}</div>
    </div>
  </div>
  <div style="display:flex;border-bottom:1px solid #888;align-items:stretch">
    <div style="flex:1;background:${bar};color:#fff;font-size:13.5pt;font-weight:900;letter-spacing:3px;text-align:center;padding:4px 6px;font-family:'Arial Black',Arial,sans-serif;display:flex;align-items:center;justify-content:center">${TYPE_TEXT[v.type]}</div>
    <div style="width:200px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;padding:3px 8px;border-left:2px solid #111;gap:2px">
      <div style="display:flex;align-items:center"><span style="font-size:10pt;font-weight:700;margin-right:8px">Date :</span><span style="font-size:10pt;border-bottom:1.5px dotted #555;flex:1;text-align:center">${esc(dmy(v.date))}</span></div>
      ${v.voucherNo ? `<div style="font-size:7.5pt;text-align:right;color:#333">No: ${esc(v.voucherNo)}</div>` : ''}
    </div>
  </div>
  <div style="padding:7px 8px 3px 8px">${fields}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;border-top:2px solid #111">
    <div style="padding:5px 8px;display:flex;flex-direction:column;justify-content:flex-end;min-height:55px"><div style="font-size:8.5pt;font-weight:700;border-top:1px solid #444;padding-top:3px;margin-top:32px">Checked by${v.checkedBy ? ' : ' + esc(v.checkedBy) : ''}</div></div>
    <div style="padding:6px 8px;min-height:55px"><div style="display:flex;align-items:center;gap:6px;margin-top:4px"><span style="font-size:12.5pt;font-weight:900;letter-spacing:2px;font-family:'Arial Black',Arial,sans-serif">RS.</span><div style="border:2px solid #111;flex:1;min-height:34px;display:flex;align-items:center;justify-content:center;font-size:11pt;font-weight:900;padding:2px 6px">${v.amount ? esc(Math.round(v.amount)) : ''}</div></div></div>
    <div style="padding:5px 8px;display:flex;flex-direction:column;justify-content:flex-end;min-height:55px"><div style="font-size:8.5pt;font-weight:700;border-top:1px solid #444;padding-top:3px;margin-top:32px">${sig}</div></div>
  </div>
  <div style="border-top:1px solid #aaa;padding:2px 8px;font-size:7.5pt;color:#444;display:flex;justify-content:space-between">
    <span>${v.prepBy ? 'Prepared by: ' + esc(v.prepBy) : ''}</span>
    <span>Mode: ${esc(v.mode || 'Cash')}${v.cheque ? ' | Ref: ' + esc(v.cheque) : ''}</span>
  </div>
</div>`;
}

const COLOR_EXACT = '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}';

/** Wraps voucher HTML in a full document laid out for the chosen paper (legacy _buildPrintDoc). */
export function buildPrintDocument(voucherHtml: string, paper: PaperSize, title = "St Mary's Voucher"): string {
  let css: string;
  let body: string;
  if (paper === 'a4_double') {
    css = `@page{size:210mm 297mm portrait;margin:6mm}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{width:198mm;background:#fff;font-family:Arial,sans-serif}
      .a4-page{width:198mm;height:285mm;overflow:hidden}
      .slot{width:198mm;height:142.5mm;overflow:hidden}
      .slot > .smv-voucher{zoom:1.3378}
      .slot-top{border-bottom:1px dashed #ccc}`;
    body = `<div class="a4-page"><div class="slot slot-top">${voucherHtml}</div><div class="slot">${voucherHtml}</div></div>`;
  } else if (paper === 'a5') {
    css = `@page{size:148mm 210mm portrait;margin:0}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{width:148mm;background:#fff;font-family:Arial,sans-serif}`;
    body = voucherHtml;
  } else {
    css = `@page{size:210mm 297mm portrait;margin:6mm}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:#fff;font-family:Arial,sans-serif}
      .slot{width:198mm;overflow:hidden}
      .slot > .smv-voucher{zoom:1.3378}`;
    body = `<div class="slot">${voucherHtml}</div>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${css}\n${COLOR_EXACT}</style></head><body>${body}</body></html>`;
}

/**
 * Prints a full HTML document from a hidden, same-origin iframe. No script runs inside the
 * iframe (the app's CSP blocks inline scripts) - the parent triggers print once images load.
 */
export function printDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    document.getElementById('__smvPrintFrame')?.remove();
    const f = document.createElement('iframe');
    f.id = '__smvPrintFrame';
    f.setAttribute('aria-hidden', 'true');
    // Off-screen, not display:none (which blocks printing in some browsers).
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    const win = f.contentWindow;
    if (!doc || !win) {
      f.remove();
      reject(new Error('Printing is not available in this browser'));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      try {
        win.focus();
        win.print();
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Print failed'));
      }
      // Remove later: some browsers return from print() before the job is spooled.
      setTimeout(() => f.remove(), 60_000);
    };
    const imgs = Array.from(doc.images);
    let pending = imgs.filter((i) => !i.complete).length;
    if (!pending) setTimeout(go, 150);
    imgs.forEach((i) => {
      if (i.complete) return;
      const fin = () => --pending <= 0 && setTimeout(go, 100);
      i.addEventListener('load', fin, { once: true });
      i.addEventListener('error', fin, { once: true });
    });
    setTimeout(go, 3000); // never wait forever for a logo
  });
}

/**
 * Prints one voucher with the saved printer settings. CONTRACT - other features call this.
 * Uses the USB thermal printer when one is connected on the Printer Setup page.
 */
export async function printVoucher(v: Voucher, college: College | undefined, paper?: PaperSize): Promise<void> {
  if (isSerialConnected()) {
    await sendToSerial(buildEscPosVoucher(v, college));
    return;
  }
  const settings = getPrintSettings();
  await ensureLogo(collegeLogo(college ?? v.college));
  const html = buildVoucherHtml(v, college, settings);
  await printDocument(buildPrintDocument(html, paper ?? settings.paper, `${v.voucherNo || 'Voucher'} - ${dmy(v.date)}`));
}
