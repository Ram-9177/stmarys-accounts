import { useCallback, useState, type ReactNode } from 'react';
import { errorMessage } from '@/api/client';
import { useColleges } from '@/api/hooks';
import type { Voucher } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { useToast } from '@/components/ui/toast';
import { printVoucher } from './print';
import { getPrintSettings } from './printSettings';
import { PrintPreviewModal } from './PrintPreviewModal';

/**
 * print(v): prints directly, or opens the preview first if the user chose that on Printer Setup.
 * view(v): always opens the preview. Render `modal` somewhere in the page.
 */
export function usePrintAction(): { print: (v: Voucher) => void; view: (v: Voucher) => void; modal: ReactNode } {
  const { can, college } = useSession();
  const colleges = useColleges();
  const toast = useToast();
  const [preview, setPreview] = useState<Voucher | null>(null);
  const collegeOf = useCallback((code: string) => colleges.data?.find((c) => c.code === code), [colleges.data]);

  const print = useCallback(
    (v: Voucher) => {
      if (getPrintSettings().behaviour === 'preview') {
        setPreview(v);
        return;
      }
      toast('🖨 Sending to printer…', 'info');
      printVoucher(v, collegeOf(v.college || college)).catch((e) => toast(errorMessage(e), 'error'));
    },
    [college, collegeOf, toast],
  );

  const modal = (
    <PrintPreviewModal
      voucher={preview}
      college={preview ? collegeOf(preview.college || college) : undefined}
      onClose={() => setPreview(null)}
      canPrint={can('print_voucher')}
    />
  );
  return { print, view: setPreview, modal };
}
