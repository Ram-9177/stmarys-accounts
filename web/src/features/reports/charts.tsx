/** Hand-written SVG charts (no chart library). Each has an aria-label and a data table fallback. */
import { useId, type ReactNode } from 'react';

/** Chart colours follow the UOS theme (light and dark) through its CSS variables. */
const ACCENT = 'var(--accent)';
const BARS = 'color-mix(in srgb, var(--accent) 38%, transparent)';
const INK = 'var(--ink-80)';
const MUTED = 'var(--ink-50)';
const TRACK = 'var(--surface-3)';
const AXIS = 'var(--border)';

function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-sand-600 hover:text-maroon-700">Show as table</summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} className={`border-b border-sand-100 py-1 font-semibold text-sand-600 ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`border-b border-sand-50 py-1 tabular ${j > 0 ? 'text-right' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Horizontal bars with the value printed inside/after each bar. */
export function HBarChart({
  title,
  data,
  format,
  color = ACCENT,
}: {
  title: string;
  data: { label: string; value: number }[];
  format: (n: number) => string;
  color?: string;
}) {
  if (!data.length) return <p className="text-xs text-sand-400">No data yet</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = 30;
  const labelW = 150;
  const width = 560;
  const barMax = width - labelW - 90;
  const height = data.length * rowH;
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`}>
        {data.map((d, i) => {
          const y = i * rowH;
          const w = Math.max(2, (d.value / max) * barMax);
          const label = d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
              <text x={labelW - 8} y={y + rowH / 2 + 4} textAnchor="end" fontSize="12" style={{ fill: INK }}>
                {label}
              </text>
              <rect x={labelW} y={y + 5} width={barMax} height={rowH - 10} rx="4" style={{ fill: TRACK }} />
              <rect x={labelW} y={y + 5} width={w} height={rowH - 10} rx="4" style={{ fill: color }} />
              <text x={labelW + w + 6} y={y + rowH / 2 + 4} fontSize="12" fontWeight="600" style={{ fill: INK }}>
                {format(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <DataTable caption={title} headers={['Item', 'Value']} rows={data.map((d) => [d.label, format(d.value)])} />
    </figure>
  );
}

/** Donut with centre total and a legend. */
export function DonutChart({
  title,
  data,
  centerLabel,
}: {
  title: string;
  data: { label: string; value: number; color: string; hint?: string }[];
  centerLabel: string;
}) {
  const id = useId();
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = 38;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure>
      <div className="flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 110 110" className="size-36 shrink-0" role="img" aria-labelledby={id}>
          <title id={id}>{`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}</title>
          <circle cx="55" cy="55" r={r} fill="none" style={{ stroke: TRACK }} strokeWidth="18" />
          {total > 0 &&
            data.map((d) => {
              const len = (d.value / total) * c;
              const el = (
                <circle
                  key={d.label}
                  cx="55"
                  cy="55"
                  r={r}
                  fill="none"
                  style={{ stroke: d.color }}
                  strokeWidth="18"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 55 55)"
                />
              );
              offset += len;
              return el;
            })}
          <text x="55" y="60" textAnchor="middle" fontSize="16" fontWeight="700" style={{ fill: ACCENT }}>
            {centerLabel}
          </text>
        </svg>
        <ul className="flex flex-col gap-2 text-sm">
          {data.map((d) => (
            <li key={d.label} className="flex items-center gap-2">
              <span className="size-3 rounded-sm" style={{ background: d.color }} aria-hidden />
              <span className="font-medium">{d.label}:</span>
              <span className="tabular">{d.value}</span>
              {d.hint && <span className="text-xs text-sand-600">({d.hint})</span>}
            </li>
          ))}
        </ul>
      </div>
      <DataTable caption={title} headers={['Type', 'Count', 'Amount']} rows={data.map((d) => [d.label, d.value, d.hint ?? ''])} />
    </figure>
  );
}

/** Vertical columns (count) with an amount line overlay. */
export function ColumnChart({
  title,
  data,
  formatAmount,
}: {
  title: string;
  data: { label: string; count: number; amount: number }[];
  formatAmount: (n: number) => string;
}) {
  if (!data.length) return <p className="text-xs text-sand-400">No data yet</p>;
  const width = 560;
  const height = 220;
  const top = 24;
  const bottom = 30;
  const plotH = height - top - bottom;
  const slot = width / data.length;
  const barW = Math.min(48, slot * 0.55);
  const maxC = Math.max(...data.map((d) => d.count), 1);
  const maxA = Math.max(...data.map((d) => d.amount), 1);
  const points = data.map((d, i) => `${i * slot + slot / 2},${top + plotH - (d.amount / maxA) * plotH}`).join(' ');
  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}: ${data.map((d) => `${d.label} ${d.count} vouchers, ${formatAmount(d.amount)}`).join('; ')}`}
      >
        <line x1="0" x2={width} y1={top + plotH} y2={top + plotH} style={{ stroke: AXIS }} />
        {data.map((d, i) => {
          const h = Math.max(2, (d.count / maxC) * plotH);
          const x = i * slot + (slot - barW) / 2;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${d.count} vouchers, ${formatAmount(d.amount)}`}</title>
              <rect x={x} y={top + plotH - h} width={barW} height={h} rx="4" style={{ fill: BARS }} />
              <text x={x + barW / 2} y={top + plotH - h - 6} textAnchor="middle" fontSize="12" fontWeight="600" style={{ fill: INK }}>
                {d.count}
              </text>
              <text x={x + barW / 2} y={height - 10} textAnchor="middle" fontSize="11" style={{ fill: MUTED }}>
                {d.label}
              </text>
            </g>
          );
        })}
        <polyline points={points} fill="none" style={{ stroke: ACCENT }} strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={d.label} cx={i * slot + slot / 2} cy={top + plotH - (d.amount / maxA) * plotH} r="3.5" style={{ fill: ACCENT }} />
        ))}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-sand-600">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm" style={{ background: BARS }} aria-hidden /> Vouchers (count)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-4" style={{ background: ACCENT }} aria-hidden /> Amount
        </span>
      </div>
      <DataTable caption={title} headers={['Month', 'Vouchers', 'Amount']} rows={data.map((d) => [d.label, d.count, formatAmount(d.amount)])} />
    </figure>
  );
}
