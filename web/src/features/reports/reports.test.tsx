import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Voucher } from '@/api/types';
import { buildCashBook } from './calc';
import { cashBookPrintHtml } from './CashBookPage';
import { DonutChart, HBarChart } from './charts';
import { voucherSheetRows } from './excel';

const base = {
  voucherNo: 'X',
  college: 'smgg',
  head: 'Misc',
  acName: '',
  receivedFrom: '',
  paidTo: '',
  vendorId: '',
  recipientPhone: '',
  reversalDate: '',
  towards: '',
  block: '',
  amtWords: '',
  mode: 'Cash',
  cheque: '',
  prepBy: '',
  checkedBy: '',
  remarks: '',
  createdBy: 'clerk',
  createdByLabel: 'clerk',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
} satisfies Partial<Voucher>;

describe('cash book print', () => {
  it('escapes voucher text so it cannot inject markup into the print document', () => {
    const v: Voucher = { ...base, id: 1, type: 'credit', date: '2026-11-02', amount: 10, receivedFrom: '<img src=x onerror=alert(1)>', towards: 'Fees' };
    const html = cashBookPrintHtml(buildCashBook([v], { from: '', to: '' }), { code: 'smgg', name: 'St <Marys>', location: '', logoUrl: '' }, { from: '', to: '' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('St &lt;Marys&gt;');
    expect(html).toContain('@page { size: A4 landscape');
  });
});

describe('excel rows', () => {
  it('uses the legacy column names and on-account status', () => {
    const [row] = voucherSheetRows([{ ...base, id: 7, type: 'onaccount', date: '2026-11-05', amount: 1234.6, reversalDate: '2026-11-09' }]);
    expect(row).toMatchObject({
      'S.No': 1,
      Date: '05/11/2026',
      'Voucher Type': 'On- Account',
      'On Account Status': 'Cleared',
      'Reverse / Cleared Date': '09/11/2026',
      'Amount (Rs.)': 1235,
    });
  });
});

describe('charts', () => {
  it('bar chart is labelled for screen readers and has a table fallback', () => {
    render(<HBarChart title="Top heads" data={[{ label: 'Electricity', value: 1500 }]} format={(n) => `₹${n}`} />);
    expect(screen.getByRole('img', { name: /Top heads: Electricity ₹1500/ })).toBeInTheDocument();
    expect(screen.getByText('Show as table')).toBeInTheDocument();
  });

  it('bar chart shows an empty message without data', () => {
    render(<HBarChart title="Top heads" data={[]} format={String} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('donut shows the centre total and legend', () => {
    render(
      <DonutChart
        title="Types"
        centerLabel="3"
        data={[
          { label: 'Debit', value: 2, color: '#000' },
          { label: 'Credit', value: 1, color: '#fff' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Types: Debit 2, Credit 1' })).toBeInTheDocument();
    expect(screen.getByText('Debit:')).toBeInTheDocument();
  });
});
