import { useColleges, vendorFileUrl } from '@/api/hooks';
import type { CollegeCode, Vendor, VendorFile } from '@/api/types';
import { Badge, Button, Modal, cx } from '@/components/ui';
import { collegeShort } from '@/lib/colleges';
import { agreementHtml, formatFileSize, printHtml } from './documents';
import { agreementStatus, type AgreementStatusKey, type PaymentStatus, type VendorFinancials } from './ledger';

/** College display name used as the heading of printed documents. */
export function useCollegeName(code: CollegeCode): string {
  const colleges = useColleges();
  return colleges.data?.find((c) => c.code === code)?.name ?? collegeShort(code);
}

export function CollegeBadge({ code }: { code: CollegeCode }) {
  return <Badge tone={code === 'smwec' ? 'maroon' : code === 'smhyd' ? 'gold' : 'neutral'}>{collegeShort(code)}</Badge>;
}

const AG_TONE: Record<AgreementStatusKey, 'success' | 'gold' | 'danger' | 'neutral' | 'maroon'> = {
  active: 'success',
  expiring_soon: 'gold',
  expired: 'danger',
  not_started: 'neutral',
  completed: 'maroon',
  terminated: 'danger',
};
const AG_ICON: Record<AgreementStatusKey, string> = {
  active: '🟢',
  expiring_soon: '🟡',
  expired: '🔴',
  not_started: '⏳',
  completed: '🔵',
  terminated: '⛔',
};

export function AgreementBadge({ vendor }: { vendor: Partial<Vendor> }) {
  const s = agreementStatus(vendor);
  return (
    <Badge tone={AG_TONE[s.key]}>
      {AG_ICON[s.key]} {s.label}
      {s.detail && <span className="ml-1 opacity-80">({s.detail})</span>}
    </Badge>
  );
}

export function PaymentBadge({ fin }: { fin: Pick<VendorFinancials, 'status' | 'paidPercent'> }) {
  const s: PaymentStatus = fin.status;
  if (s === 'paid') return <Badge tone="success">✓ Fully Paid (100%)</Badge>;
  if (s === 'partial') return <Badge tone="gold">⏳ {fin.paidPercent}% Paid</Badge>;
  return <Badge tone="neutral">Pending Payment</Badge>;
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sand-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', percent >= 100 ? 'bg-credit' : 'bg-maroon-500')} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

/** Links to saved attachments (opened in a new tab with the user's session). */
export function FileLinks({ vendor, college }: { vendor: Pick<Vendor, 'vendorId' | 'files'>; college: CollegeCode }) {
  if (!vendor.files?.length) return <span className="text-xs text-sand-400">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {vendor.files.map((f: VendorFile, i) => (
        <a
          key={f.id}
          href={vendorFileUrl(college, vendor.vendorId, f.id)}
          target="_blank"
          rel="noopener noreferrer"
          title={`${f.name} (${formatFileSize(f.size)})`}
          className="rounded-full border border-sand-200 px-2 py-0.5 text-xs hover:bg-sand-50"
        >
          {f.type.includes('pdf') ? '📄' : '📎'} Doc {i + 1}
        </a>
      ))}
    </div>
  );
}

/** Preview + print of the vendor agreement document. */
export function AgreementModal({ vendor, onClose }: { vendor: Partial<Vendor> | null; onClose: () => void }) {
  const collegeName = useCollegeName(vendor?.college ?? 'smgg');
  const html = vendor ? agreementHtml(vendor, collegeName) : '';
  return (
    <Modal
      open={!!vendor}
      onClose={onClose}
      title="Vendor Agreement Document"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => printHtml(html, `Agreement ${vendor?.vendorId ?? ''}`)}>🖨 Print Agreement</Button>
        </>
      }
    >
      {/* agreementHtml escapes every value it interpolates */}
      <div className="overflow-x-auto bg-sand-100 p-3" dangerouslySetInnerHTML={{ __html: html }} />
    </Modal>
  );
}
