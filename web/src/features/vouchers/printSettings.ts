/** Per-browser printer preferences (same localStorage keys as the legacy app, so settings carry over). */

export type PaperSize = 'a4_single' | 'a4_double' | 'a5';
/** 'silent' = print straight away; 'preview' = show the preview first. */
export type PrintBehaviour = 'silent' | 'preview';

export interface PrintSettings {
  paper: PaperSize;
  behaviour: PrintBehaviour;
  /** Maroon title banner instead of black. */
  color: boolean;
}

const KEYS = { paper: 'smv_paperSize', behaviour: 'smv_printBehaviour', color: 'smv_useColor' } as const;

export const PAPER_OPTIONS: { value: PaperSize; label: string; help: string }[] = [
  { value: 'a4_single', label: 'A4 Portrait — Full Width', help: 'Voucher scaled to fill the top half of an A4 sheet. Recommended for all printers.' },
  { value: 'a4_double', label: 'A4 Portrait — 2 Per Page', help: 'Two copies of the voucher stacked on one A4 sheet (office + receiver copy).' },
  { value: 'a5', label: 'A5 Direct', help: 'Voucher prints at exact A5 size. Choose A5 paper in the printer dialog.' },
];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked - settings just won't persist */
  }
}

export function getPrintSettings(): PrintSettings {
  const paper = read(KEYS.paper);
  const behaviour = read(KEYS.behaviour);
  return {
    paper: paper === 'a4_double' || paper === 'a5' ? paper : 'a4_single',
    // Legacy stored 'dialog' for "show print dialog"; treat anything but 'preview' as direct printing.
    behaviour: behaviour === 'preview' ? 'preview' : 'silent',
    color: read(KEYS.color) === '1',
  };
}

export function savePrintSettings(patch: Partial<PrintSettings>): PrintSettings {
  const next = { ...getPrintSettings(), ...patch };
  write(KEYS.paper, next.paper);
  write(KEYS.behaviour, next.behaviour);
  write(KEYS.color, next.color ? '1' : '0');
  return next;
}
