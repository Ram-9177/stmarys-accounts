import { useMemo, useState } from 'react';
import { errorMessage } from '@/api/client';
import { useAudit } from '@/api/hooks';
import { Badge, Button, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table } from '@/components/ui';
import { dateTime, todayISO } from '@/lib/format';
import { actionTone, auditCsv, downloadText, EMPTY_AUDIT_FILTER, filterAudit, prettyDetails, type AuditFilter } from './audit';

const PAGE = 200;

export function AuditPage() {
  const audit = useAudit();
  const [f, setF] = useState<AuditFilter>(EMPTY_AUDIT_FILTER);
  const [shown, setShown] = useState(PAGE);
  const logs = audit.data ?? [];

  const actors = useMemo(() => Array.from(new Set(logs.map((l) => l.actor))).sort(), [logs]);
  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);
  const filtered = useMemo(() => filterAudit(logs, f), [logs, f]);
  const set = (patch: Partial<AuditFilter>) => {
    setF((cur) => ({ ...cur, ...patch }));
    setShown(PAGE);
  };

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Sign-ins, voucher changes and administration actions (latest 2,000 entries)."
        actions={
          <>
            <Button variant="secondary" onClick={() => audit.refetch()} loading={audit.isFetching}>
              Refresh
            </Button>
            <Button
              disabled={!filtered.length}
              onClick={() => downloadText(`audit-log-${todayISO()}.csv`, auditCsv(filtered, (t) => dateTime(t)))}
            >
              ⇩ Export CSV
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Search">
          <Input value={f.text} onChange={(e) => set({ text: e.target.value })} placeholder="Any text…" />
        </Field>
        <Field label="User">
          <Select value={f.actor} onChange={(e) => set({ actor: e.target.value })}>
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Action">
          <Select value={f.action} onChange={(e) => set({ action: e.target.value })}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label="To">
          <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      </div>

      {audit.isLoading ? (
        <Spinner className="mx-auto my-10 size-8 text-maroon-700" />
      ) : audit.error ? (
        <ErrorBox>{errorMessage(audit.error)}</ErrorBox>
      ) : !filtered.length ? (
        <EmptyState title="No activity found">Try clearing the filters.</EmptyState>
      ) : (
        <>
          <p className="mb-2 text-xs text-sand-600">
            Showing {Math.min(shown, filtered.length)} of {filtered.length} entries
          </p>
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map((l) => {
                const details = prettyDetails(l.details);
                return (
                  <tr key={l.id} className="align-top">
                    <td className="whitespace-nowrap text-xs text-sand-600">{dateTime(l.createdAt)}</td>
                    <td className="font-semibold">{l.actor}</td>
                    <td>
                      <Badge tone={actionTone(l.action)}>{l.action}</Badge>
                    </td>
                    <td className="text-xs">
                      <span className="text-sand-600">{l.entityType}</span> <b>{l.entityId}</b>
                    </td>
                    <td className="max-w-md">
                      {details.includes('\n') ? (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-sand-50 p-2 text-xs">{details}</pre>
                      ) : (
                        <span className="whitespace-normal break-all text-xs">{details}</span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-sand-400">{l.ip}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {shown < filtered.length && (
            <div className="mt-4 text-center">
              <Button variant="secondary" onClick={() => setShown((s) => s + PAGE)}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
