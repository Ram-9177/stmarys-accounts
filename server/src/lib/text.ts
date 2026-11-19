/** Trim, collapse whitespace and cap length (same rules as the legacy API). */
export function clean(v: unknown, max = 2000): string {
  return String(v == null ? '' : v)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

export function norm(v: unknown): string {
  return clean(v, 250).toLowerCase();
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY or DD/MM/YYYY and returns YYYY-MM-DD ('' if blank). */
export function isoFromAny(input: unknown): string {
  const s = clean(input, 20).replace(/\//g, '-');
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const p = s.split('-');
  if (p.length === 3) {
    if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
  }
  return s;
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function dmyFromIso(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

export function csvList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => clean(x, 80)).filter(Boolean);
  return clean(v ?? '', 2000)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Old D1 rows used 'smg' for the Guntur campus. */
export function normalizeCollegeCode(code: unknown): string {
  const c = clean(code, 20).toLowerCase();
  return c === 'smg' ? 'smgg' : c;
}
