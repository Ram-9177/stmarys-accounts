import { useMemo, useState } from 'react';
import { errorMessage } from '@/api/client';
import type { College, Voucher } from '@/api/types';
import { Button, Field, Modal, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { dmy, VOUCHER_TYPE_LABEL } from '@/lib/format';
import { buildVoucherHtml, printVoucher } from './print';
import { getPrintSettings, PAPER_OPTIONS, type PaperSize } from './printSettings';

/** Shows the voucher exactly as it will print, with a paper-size choice. */
export function PrintPreviewModal({
  voucher,
  college,
  onClose,
  canPrint = true,
}: {
  voucher: Voucher | null;
  college: College | undefined;
  onClose: () => void;
  canPrint?: boolean;
}) {
  const toast = useToast();
  const [paper, setPaper] = useState<PaperSize>(() => getPrintSettings().paper);
  const [busy, setBusy] = useState(false);

  const srcDoc = useMemo(() => {
    if (!voucher) return '';
    const html = buildVoucherHtml(voucher, college);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:12px;background:#f3f1ec;display:flex;justify-content:center}</style></head><body>${html}</body></html>`;
  }, [voucher, college]);

  async function print() {
    if (!voucher) return;
    setBusy(true);
    try {
      await printVoucher(voucher, college, paper);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const help = PAPER_OPTIONS.find((p) => p.value === paper)?.help;

  return (
    <Modal
      open={!!voucher}
      onClose={onClose}
      size="lg"
      title={voucher ? `${dmy(voucher.date)} – ${VOUCHER_TYPE_LABEL[voucher.type]} Voucher${voucher.voucherNo ? ` · ${voucher.voucherNo}` : ''}` : 'Preview'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canPrint && (
            <Button onClick={print} loading={busy}>
              🖨 Print
            </Button>
          )}
        </>
      }
    >
      {voucher && (
        <div className="flex flex-col gap-3">
          {canPrint && (
            <Field label="Paper" hint={help}>
              <Select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
                {PAPER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {/* sandbox with no tokens: images render, scripts never run */}
          <iframe title="Voucher preview" sandbox="" srcDoc={srcDoc} className="h-[420px] w-full rounded-lg border border-sand-200 bg-sand-50" />
        </div>
      )}
    </Modal>
  );
}
