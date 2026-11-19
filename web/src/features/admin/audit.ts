import type { AuditLog } from '@/api/types';

export interface AuditFilter {
  actor: string;
  action: string;
  /** ISO YYYY-MM-DD, inclusive, in local time */
  from: string;
  to: string;
  text: string;
}

export const EMPTY_AUDIT_FILTER: AuditFilter = { actor: '', action: '', from: '', to: '', text: '' };

function localDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function filterAudit(logs: AuditLog[], f: AuditFilter): AuditLog[] {
  const text = f.text.trim().toLowerCase();
  return logs.filter((l) => {
    if (f.actor && l.actor !== f.actor) return false;
    if (f.action && l.action !== f.action) return false;
    if (f.from || f.to) {
      const day = localDay(l.createdAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (text) {
      const hay = [l.actor, l.action, l.entityType, l.entityId, l.details, l.ip].join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'credit' | 'gold' | 'maroon';

export function actionTone(action: string): BadgeTone {
  if (action === 'login') return 'success';
  if (action.includes('failed') || action.startsWith('delete') || action === 'set_user_status') return 'danger';
  if (action.startsWith('create') || action.startsWith('add') || action.startsWith('bootstrap')) return 'credit';
  if (action.includes('password')) return 'maroon';
  if (action.startsWith('update') || action.startsWith('set')) return 'gold';
  return 'neutral';
}

/** Pretty JSON when the details field holds JSON, otherwise the raw text. */
export function prettyDetails(details: string): string {
  const d = (details ?? '').trim();
  if (!d || !/^[[{"]/.test(d)) return d;
  try {
    const v = JSON.parse(d);
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  } catch {
    return d;
  }
}

/**
 * RFC 4180 CSV cell. Cells that a spreadsheet would treat as a formula
 * (= + - @ tab CR) are prefixed with an apostrophe (CSV injection guard).
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function auditCsv(logs: AuditLog[], formatTime: (ts: string) => string): string {
  return toCsv([
    ['Time', 'Actor', 'Action', 'Entity type', 'Entity id', 'Details', 'IP'],
    ...logs.map((l) => [formatTime(l.createdAt), l.actor, l.action, l.entityType, l.entityId, l.details, l.ip]),
  ]);
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
