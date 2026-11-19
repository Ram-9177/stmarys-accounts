import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Voucher } from '@/api/types';
import { ToastProvider } from '@/components/ui/toast';
import { PrintPreviewModal } from './PrintPreviewModal';

const voucher = {
  id: 1,
  voucherNo: 'SMGG-OA-2026-00001',
  college: 'smgg',
  type: 'onaccount',
  date: '2026-11-19',
  head: 'On Account',
  acName: '',
  receivedFrom: '',
  paidTo: 'Ravi',
  vendorId: '',
  recipientPhone: '9000000001',
  reversalDate: '',
  towards: 'Advance for sports meet',
  block: '',
  amount: 500,
  amtWords: 'Five Hundred Rupees Only',
  mode: 'Cash',
  cheque: '',
  prepBy: '',
  checkedBy: '',
  remarks: '',
  createdBy: 'clerk',
  createdByLabel: 'clerk',
  createdAt: '',
  updatedAt: '',
} satisfies Voucher;

describe('PrintPreviewModal', () => {
  it('shows the voucher in a sandboxed preview with a paper choice', async () => {
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <PrintPreviewModal voucher={voucher} college={undefined} onClose={onClose} />
      </ToastProvider>,
    );
    expect(screen.getByText(/On Account Voucher · SMGG-OA-2026-00001/)).toBeInTheDocument();
    const frame = screen.getByTitle('Voucher preview') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('ON ACCOUNT VOUCHER');
    expect(frame.getAttribute('srcdoc')).toContain('PENDING / Ph: 9000000001');

    await userEvent.selectOptions(screen.getByRole('combobox'), 'a4_double');
    expect(screen.getByText(/Two copies of the voucher/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the print button for users without print permission', () => {
    render(
      <ToastProvider>
        <PrintPreviewModal voucher={voucher} college={undefined} onClose={() => {}} canPrint={false} />
      </ToastProvider>,
    );
    expect(screen.queryByRole('button', { name: /Print/ })).not.toBeInTheDocument();
  });
});
