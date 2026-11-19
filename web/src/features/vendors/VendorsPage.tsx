import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '@/api/client';
import { useBulkSaveVendors, useDeleteVendor, useVendors } from '@/api/hooks';
import type { Vendor } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Spinner, Table } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dmy, formatINR } from '@/lib/format';
import { AgreementBadge, AgreementModal, CollegeBadge, FileLinks } from './components';
import { downloadImportTemplate, exportVendorsForImport, readVendorSheet } from './excel';
import { mapImportRows, type ImportedRow } from './importRows';
import { agreementNumber, maskAadhaar, matchesVendorSearch, vendorPeriodStart } from './ledger';
import { VendorForm } from './VendorForm';

export function VendorsPage() {
  const { college } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const vendorsQ = useVendors(college);
  const vendors = useMemo(() => vendorsQ.data ?? [], [vendorsQ.data]);
  const del = useDeleteVendor();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [preview, setPreview] = useState<Partial<Vendor> | null>(null);
  const [toDelete, setToDelete] = useState<Vendor | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [askOpenLedger, setAskOpenLedger] = useState<string | null>(null);

  const filtered = useMemo(() => vendors.filter((v) => matchesVendorSearch(v, query)), [vendors, query]);

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await del.mutateAsync({ college, vendorId: toDelete.vendorId });
      toast(`Vendor ${toDelete.vendorId} deleted.`);
      if (editing?.vendorId === toDelete.vendorId) setEditing(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setToDelete(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Vendors & Agreements"
        subtitle="Register contract vendors. Each vendor gets a permanent ID and its own ledger."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              ⇪ Import Excel
            </Button>
            <Button
              variant="secondary"
              disabled={!vendors.length}
              onClick={() => exportVendorsForImport(vendors, college).catch((e) => toast(errorMessage(e), 'error'))}
            >
              ⇩ Export Excel
            </Button>
            <Button variant="secondary" onClick={() => navigate('/vendor-ledger')}>
              📒 Vendor Ledger
            </Button>
          </>
        }
      />

      <VendorForm
        college={college}
        vendors={vendors}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onPreview={setPreview}
        onSaved={(v, isNew) => {
          setEditing(null);
          if (isNew && v) setAskOpenLedger(v.vendorId);
        }}
      />

      <Card
        className="mt-6"
        title="Registered Vendors"
        actions={
          <Input
            type="search"
            placeholder="Search ID, company, name, phone, PAN, GST…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-72 max-w-full"
            aria-label="Search vendors"
          />
        }
      >
        {vendorsQ.isLoading ? (
          <Spinner className="mx-auto my-6 size-6 text-maroon-700" />
        ) : vendorsQ.error ? (
          <ErrorBox>{errorMessage(vendorsQ.error)}</ErrorBox>
        ) : !filtered.length ? (
          <EmptyState title={vendors.length ? 'No vendors match your search' : 'No vendors registered yet'}>
            {vendors.length ? 'Try a different search.' : 'Use the form above or import an Excel sheet.'}
          </EmptyState>
        ) : (
          <>
            <p className="mb-2 text-xs text-sand-600">
              Showing {filtered.length} registered {filtered.length === 1 ? 'vendor' : 'vendors'}
            </p>
            <Table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Contact & IDs</th>
                  <th>Agreed Amount</th>
                  <th>Work</th>
                  <th>Agreement</th>
                  <th>Files</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.vendorId}>
                    <td>
                      <div className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                        {v.vendorId} <CollegeBadge code={v.college} />
                      </div>
                      <div className="font-semibold text-maroon-700">{v.companyName || '—'}</div>
                      <div className="text-xs text-sand-600">{v.vendorName || '—'}</div>
                    </td>
                    <td className="text-xs">
                      <div>📞 {v.phone || '—'}</div>
                      <div className="font-mono text-sand-600">PAN: {v.pan || '—'}</div>
                      {v.aadhaar && <div className="font-mono text-sand-600">Aadhaar: {maskAadhaar(v.aadhaar)}</div>}
                      {v.email && <div className="text-sand-600">✉ {v.email}</div>}
                    </td>
                    <td>
                      <div className="font-semibold tabular">{formatINR(v.agreedAmount)}</div>
                      <div className="max-w-44 truncate text-xs text-sand-600" title={v.amountInWords}>
                        {v.amountInWords}
                      </div>
                    </td>
                    <td>
                      <div className="max-w-56 whitespace-normal text-xs" title={v.workDescription}>
                        {v.workDescription.length > 70 ? v.workDescription.slice(0, 70) + '…' : v.workDescription || '—'}
                      </div>
                    </td>
                    <td className="text-xs">
                      <div className="font-medium">{dmy(vendorPeriodStart(v)) || '—'}</div>
                      <div className="font-mono text-sand-600">{agreementNumber(v)}</div>
                      <div className="mt-1">
                        <AgreementBadge vendor={v} />
                      </div>
                    </td>
                    <td>
                      <FileLinks vendor={v} college={college} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" onClick={() => navigate(`/vendor-ledger?vendor=${encodeURIComponent(v.vendorId)}`)}>
                          📂 Ledger
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setPreview(v)}>
                          🖨 Agreement
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>
                          ✎ Edit
                        </Button>
                        <Button size="sm" variant="danger" aria-label={`Delete ${v.vendorId}`} onClick={() => setToDelete(v)}>
                          🗑
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>

      <AgreementModal vendor={preview} onClose={() => setPreview(null)} />

      <ConfirmDialog
        open={!!toDelete}
        danger
        title="Delete vendor?"
        message={
          <>
            Delete vendor <b>{toDelete?.vendorId}</b> ({toDelete?.companyName || toDelete?.vendorName}) and its ledger? Vouchers already
            linked to it are not deleted.
          </>
        }
        confirmLabel="Delete vendor"
        loading={del.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />

      <ConfirmDialog
        open={!!askOpenLedger}
        title="Vendor saved"
        message={
          <>
            Vendor <b>{askOpenLedger}</b> and its ledger were created. Open the vendor's ledger statement now?
          </>
        }
        confirmLabel="Open ledger"
        onConfirm={() => {
          const id = askOpenLedger;
          setAskOpenLedger(null);
          navigate(`/vendor-ledger?vendor=${encodeURIComponent(id ?? '')}`);
        }}
        onCancel={() => setAskOpenLedger(null)}
      />

      {importOpen && <ImportModal vendors={vendors} college={college} onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function ImportModal({ vendors, college, onClose }: { vendors: Vendor[]; college: string; onClose: () => void }) {
  const toast = useToast();
  const bulk = useBulkSaveVendors();
  const [rows, setRows] = useState<ImportedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [serverFailures, setServerFailures] = useState<{ vendorId: string; error: string }[]>([]);

  const valid = rows?.filter((r) => r.vendor) ?? [];
  const invalid = rows?.filter((r) => !r.vendor) ?? [];

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setRows(null);
    setServerFailures([]);
    setFileName(file.name);
    setReading(true);
    try {
      const raw = await readVendorSheet(file);
      if (!raw.length) throw new Error('The sheet is empty.');
      if (raw.length > 500) throw new Error('At most 500 vendors can be imported at once.');
      setRows(mapImportRows(raw, vendors));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  async function doImport() {
    try {
      const r = await bulk.mutateAsync({ college, vendors: valid.map((x) => x.vendor!) });
      setServerFailures(r.failed);
      toast(`${r.saved} vendor${r.saved === 1 ? '' : 's'} imported.${r.failed.length ? ` ${r.failed.length} failed.` : ''}`, r.failed.length ? 'info' : 'success');
      if (!r.failed.length) onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Import vendors from Excel"
      footer={
        <>
          <Button variant="ghost" onClick={() => downloadImportTemplate().catch((e) => setError(errorMessage(e)))}>
            Download template
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!valid.length} loading={bulk.isPending} onClick={() => void doImport()}>
            Import {valid.length || ''} vendor{valid.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-sand-600">
          Use the template (or a file from <b>Export Excel</b>). Rows without a Vendor ID get the next free ID. Rows with an existing
          Vendor ID update that vendor; empty cells keep the current value. Attachments are not imported.
        </p>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-sand-200 px-3 py-3 hover:bg-sand-50">
          <span aria-hidden>📊</span>
          <span>{fileName || 'Choose .xlsx / .xls / .csv file…'}</span>
          <input
            type="file"
            className="sr-only"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {reading && <Spinner className="ml-auto size-4" />}
        </label>
        <ErrorBox>{error}</ErrorBox>
        {rows && (
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{valid.filter((r) => !r.isUpdate).length} new</Badge>
            <Badge tone="gold">{valid.filter((r) => r.isUpdate).length} updates</Badge>
            {invalid.length > 0 && <Badge tone="danger">{invalid.length} rows with errors (skipped)</Badge>}
          </div>
        )}
        {(invalid.length > 0 || serverFailures.length > 0 || valid.some((r) => r.warnings.length)) && (
          <Table>
            <thead>
              <tr>
                <th>Row / ID</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {invalid.map((r) => (
                <tr key={`e${r.rowNumber}`}>
                  <td>Row {r.rowNumber}</td>
                  <td className="whitespace-normal text-debit">{r.errors.join('; ')}</td>
                </tr>
              ))}
              {serverFailures.map((f, i) => (
                <tr key={`s${i}`}>
                  <td>{f.vendorId || '—'}</td>
                  <td className="text-debit">{f.error}</td>
                </tr>
              ))}
              {valid
                .filter((r) => r.warnings.length)
                .map((r) => (
                  <tr key={`w${r.rowNumber}`}>
                    <td>
                      Row {r.rowNumber} ({r.vendor?.vendorId})
                    </td>
                    <td className="whitespace-normal text-onaccount">Warning: {r.warnings.join('; ')}</td>
                  </tr>
                ))}
            </tbody>
          </Table>
        )}
      </div>
    </Modal>
  );
}
