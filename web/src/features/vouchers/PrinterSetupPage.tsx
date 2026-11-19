import { useMemo, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '@/api/client';
import type { Voucher } from '@/api/types';
import { useColleges } from '@/api/hooks';
import { useSession } from '@/auth/AuthProvider';
import { Badge, Button, Card, Checkbox, Field, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { amountInWords, todayISO } from '@/lib/format';
import { PrintPreviewModal } from './PrintPreviewModal';
import { getPrintSettings, PAPER_OPTIONS, savePrintSettings, type PaperSize, type PrintBehaviour } from './printSettings';
import {
  buildEscPosTest,
  connectSerialPrinter,
  disconnectSerialPrinter,
  isSerialConnected,
  sendToSerial,
  serialSupported,
  subscribeSerial,
} from './serial';

export function PrinterSetupPage() {
  const { user, college } = useSession();
  const colleges = useColleges();
  const toast = useToast();
  const [settings, setSettings] = useState(getPrintSettings);
  const [preview, setPreview] = useState<Voucher | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = useSyncExternalStore(subscribeSerial, isSerialConnected, isSerialConnected);
  const supported = serialSupported();

  function update(patch: Parameters<typeof savePrintSettings>[0]) {
    setSettings(savePrintSettings(patch));
    toast('Printer settings saved');
  }

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
    } catch (e) {
      // User closing the port picker is not an error worth shouting about.
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const sample = useMemo<Voucher>(
    () => ({
      id: 0,
      voucherNo: `${college.toUpperCase()}-DV-SAMPLE`,
      college,
      type: 'debit',
      date: todayISO(),
      head: 'Electricity',
      acName: '',
      receivedFrom: '',
      paidTo: 'Sample Vendor',
      vendorId: '',
      recipientPhone: '',
      reversalDate: '',
      towards: 'Test print to check paper size and alignment',
      block: 'A Block',
      amount: 12500,
      amtWords: amountInWords(12500),
      mode: 'Cash',
      cheque: '',
      prepBy: user.fullName || user.displayName,
      checkedBy: '',
      remarks: '',
      createdBy: user.username,
      createdByLabel: user.displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    [college, user],
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Printer Setup" subtitle="These settings are saved in this browser only." />

      <div className="flex flex-col gap-5">
        <Card title="Paper & behaviour" actions={<Button variant="secondary" size="sm" onClick={() => setPreview(sample)}>Preview sample voucher</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default paper" hint={PAPER_OPTIONS.find((p) => p.value === settings.paper)?.help}>
              <Select value={settings.paper} onChange={(e) => update({ paper: e.target.value as PaperSize })}>
                {PAPER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="When I click Print"
              hint={settings.behaviour === 'preview' ? 'A preview opens first; print from there.' : 'The browser print dialog opens straight away on your default printer — press Enter to print.'}
            >
              <Select value={settings.behaviour} onChange={(e) => update({ behaviour: e.target.value as PrintBehaviour })}>
                <option value="silent">Print directly</option>
                <option value="preview">Show preview first</option>
              </Select>
            </Field>
          </div>
          <Checkbox
            className="mt-4"
            label="Print the voucher title banner in maroon (colour printers)"
            checked={settings.color}
            onChange={(e) => update({ color: e.target.checked })}
          />
          <p className="mt-4 rounded-lg bg-sand-50 p-3 text-xs text-sand-600">
            Tip: for one-click printing without the dialog, start Chrome with <code>--kiosk-printing</code> on the accounts
            office computer. The dialog is then skipped and vouchers go straight to the default printer.
          </p>
        </Card>

        <Card
          title="USB thermal printer (ESC/POS)"
          actions={connected ? <Badge tone="success">Connected ✓</Badge> : <Badge tone="danger">Not connected</Badge>}
        >
          {!supported ? (
            <p className="text-sm text-sand-600">
              This browser does not support Web Serial. Use Google Chrome or Microsoft Edge on a Windows / macOS / Linux computer to print to a
              USB receipt printer. Normal printers work in every browser.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-sand-600">
                Connect a USB receipt printer once per browser tab. While connected, every voucher print goes to the thermal printer instead of
                the normal print dialog.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={connected} loading={busy && !connected} onClick={() => run(() => connectSerialPrinter(), 'USB printer connected')}>
                  Connect printer
                </Button>
                <Button variant="secondary" disabled={!connected || busy} onClick={() => run(() => sendToSerial(buildEscPosTest()), 'Test page sent')}>
                  Print test page
                </Button>
                <Button variant="danger" disabled={!connected || busy} onClick={() => run(disconnectSerialPrinter, 'Printer disconnected')}>
                  Disconnect
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <PrintPreviewModal voucher={preview} college={colleges.data?.find((c) => c.code === college)} onClose={() => setPreview(null)} />
    </div>
  );
}
