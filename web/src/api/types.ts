/** Shapes returned by the Express API (see server/src/routes/*). */

export type CollegeCode = string;

export type Permission =
  | 'view_dashboard'
  | 'view_analytics'
  | 'create_voucher'
  | 'view_own_vouchers'
  | 'view_all_vouchers'
  | 'edit_voucher'
  | 'delete_voucher'
  | 'print_voucher'
  | 'export_excel'
  | 'cash_book'
  | 'link_excel'
  | 'printer_setup'
  | 'account_heads'
  | 'view_vendor_ledger'
  | 'manage_vendors'
  | 'manage_advances'
  | 'approve_advances'
  | 'create_users'
  | 'reset_passwords'
  | 'block_users'
  | 'create_admin'
  | 'manage_permissions'
  | 'manage_colleges'
  | 'change_admin_key'
  | 'view_audit';

export interface CurrentUser {
  username: string;
  /** Legacy display name: main administrators show as "admin1". */
  displayName: string;
  fullName: string;
  email: string;
  /** 'admin' | 'user' | 'head' */
  role: string;
  baseRole: 'admin' | 'user';
  isSuperAdmin: boolean;
  status: UserStatus;
  college: CollegeCode;
  /** In a UOS session: only the colleges of the campus Accounts was opened for. */
  collegeAccess: CollegeCode[];
  permissions: Permission[];
  mustChangePassword: boolean;
  /** Linked to a UOS person (signs in from the UOS launcher). */
  uosLinked?: boolean;
}

/** 'pending': created the first time the person opened Accounts from UOS, waiting for an admin to approve. */
export type UserStatus = 'active' | 'blocked' | 'pending';

/** Public UOS settings (GET /api/uos/config). */
export interface UosConfig {
  enabled: boolean;
  moduleId?: string;
  shellUrl?: string;
  logoutUrl?: string;
  legacyLogin?: boolean;
  /** The university's accent colour in UOS, if it has one. */
  accentColor?: string | null;
  campuses?: { campusId: string; code: string; name: string; colleges: CollegeCode[] }[];
}

/** The UOS session behind the signed-in user (from the module pass). */
export interface UosSession {
  moduleId: string;
  shellUrl: string;
  logoutUrl: string;
  /** When the module pass expires (ISO). Accounts re-enters through the shell before then. */
  expiresAt: string;
  orgId: string;
  campusId: string;
  campusCode: string;
  campusName: string;
  /** Colleges this session may open. */
  colleges: CollegeCode[];
  /** Colleges on other campuses the user may open (switching re-enters through UOS for that campus). */
  otherColleges: { code: CollegeCode; campusId: string }[];
}

export interface College {
  code: CollegeCode;
  name: string;
  location: string;
  logoUrl: string;
  status?: 'active' | 'inactive';
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type VoucherType = 'debit' | 'credit' | 'onaccount';

/** The advance an On Account payment (or a return of unspent money) belongs to. */
export interface VoucherAdvanceLink {
  id: number;
  advanceNo: string;
  role: 'payment' | 'return';
}

export interface Voucher {
  id: number;
  voucherNo: string;
  college: CollegeCode;
  type: VoucherType;
  /** ISO YYYY-MM-DD */
  date: string;
  head: string;
  acName: string;
  receivedFrom: string;
  paidTo: string;
  vendorId: string;
  recipientPhone: string;
  /** ISO YYYY-MM-DD or '' - on-account vouchers: date the advance was reversed / cleared. */
  reversalDate: string;
  towards: string;
  block: string;
  amount: number;
  amtWords: string;
  mode: string;
  cheque: string;
  prepBy: string;
  checkedBy: string;
  remarks: string;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the voucher is an advance's payment (On Account) or money returned on one. */
  advance?: VoucherAdvanceLink | null;
}

/** Body for POST /api/vouchers and PUT /api/vouchers/:id */
export type VoucherInput = Omit<Voucher, 'id' | 'voucherNo' | 'createdBy' | 'createdByLabel' | 'createdAt' | 'updatedAt' | 'advance'>;

export interface AccountHead {
  id: number;
  name: string;
  type: 'debit' | 'credit' | 'onaccount' | 'common';
  college: CollegeCode;
}

export interface Block {
  id: number;
  name: string;
  college: CollegeCode;
}

export interface VendorFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

/** New attachment being uploaded (base64 data URL), or an existing one to keep ({id}). */
export type VendorFileInput = { id: string } | { name: string; dataUrl: string };

export interface Vendor {
  vendorId: string;
  college: CollegeCode;
  companyName: string;
  vendorName: string;
  phone: string;
  pan: string;
  aadhaar: string;
  email: string;
  gstNumber: string;
  bankAccountDetails: string;
  workDescription: string;
  agreedAmount: number;
  amountInWords: string;
  periodStart: string;
  periodEnd: string;
  authBy: string;
  authRole: string;
  authPlace: string;
  remarks: string;
  files: VendorFile[];
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  /** Extra free-form fields kept from the legacy form (address, status, agreement{agreementNo,...}). */
  address?: string;
  status?: string;
  agreementDate?: string;
  agreement?: { agreementNo?: string; agreementDate?: string; periodStart?: string; periodEnd?: string; [k: string]: unknown };
  [extra: string]: unknown;
}

/** Editable vendor fields (explicit list: Vendor's index signature would make an Omit<> untyped). */
type VendorField =
  | 'companyName'
  | 'vendorName'
  | 'phone'
  | 'pan'
  | 'aadhaar'
  | 'email'
  | 'gstNumber'
  | 'bankAccountDetails'
  | 'workDescription'
  | 'agreedAmount'
  | 'amountInWords'
  | 'periodStart'
  | 'periodEnd'
  | 'authBy'
  | 'authRole'
  | 'authPlace'
  | 'remarks'
  | 'address'
  | 'status'
  | 'agreementDate'
  | 'agreement';

export type VendorInput = { [K in VendorField]?: Vendor[K] } & {
  vendorId: string;
  college?: CollegeCode;
  files?: VendorFileInput[];
};

export interface ManagedUser {
  username: string;
  displayName: string;
  fullName: string;
  email: string;
  role: string;
  baseRole: 'admin' | 'user';
  isSuperAdmin: boolean;
  status: UserStatus;
  college: CollegeCode;
  collegeAccess: CollegeCode[];
  permissions: Permission[];
  mustChangePassword: boolean;
  uosLinked?: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserInput {
  username?: string;
  password?: string;
  role: 'admin' | 'user' | 'head';
  fullName: string;
  email: string;
  college: CollegeCode;
  collegeAccess: CollegeCode[];
  permissions: Permission[];
}

export interface AuditLog {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  ip: string;
  createdAt: string;
}

// ---------------- On Account (Finance flow F2, MRF flow B4) ----------------

export type PayeeKind = 'vendor' | 'employee';
/** Before payment: planned / prepared (waiting for the second approver) / cancelled. After: with_payee, to_recover, closed. */
export type AdvanceState = 'planned' | 'prepared' | 'cancelled' | 'with_payee' | 'to_recover' | 'closed';
export const PAYMENT_FORMS = ['Cash', 'Cheque', 'DD', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'Card'] as const;
export type PaymentForm = (typeof PAYMENT_FORMS)[number];

export interface AdvanceFigures {
  given: number;
  setOff: number;
  returned: number;
  settled: number;
  outstanding: number;
  toRecover: number;
  overdue: boolean;
  dueDate: string | null;
}

export interface AdvanceSettlement {
  id: number;
  kind: 'bill' | 'returned' | 'legacy_clear';
  billNo: string;
  billDate: string | null;
  billTotal: number | null;
  amount: number;
  date: string;
  form: string;
  reference: string;
  receiptVoucherId: number | null;
  notes: string;
  createdBy: string;
  createdAt: string;
}

export interface Advance {
  id: number;
  advanceNo: string;
  college: CollegeCode;
  status: 'planned' | 'prepared' | 'paid' | 'cancelled';
  state: AdvanceState;
  payee: { kind: PayeeKind; name: string; phone: string; vendorId: string; vendorCode: string; vendorGst: string; employeeRef: string };
  amount: number;
  plannedForm: string;
  payment: { form: string; reference: string; bank: string; receivedBy: string; datePaid: string | null } | null;
  settleBy: string | null;
  recoveredBy: string;
  purpose: string;
  head: string;
  block: string;
  caseNo: string;
  poNo: string;
  clearanceRef: string;
  source: 'accounts' | 'mrf' | 'legacy';
  billsFinal: boolean;
  voucherId: number | null;
  closedOn: string | null;
  returnReason: string;
  cancelReason: string;
  remarks: string;
  plannedBy: string;
  plannedAt: string | null;
  preparedBy: string;
  preparedAt: string | null;
  approvedBy: string;
  approvedAt: string | null;
  figures: AdvanceFigures;
  settlements: AdvanceSettlement[];
  createdAt: string;
  updatedAt: string;
}

export interface AdvanceDetail extends Advance {
  vendorMark: { mark: 'blacklisted' | 'suspended'; reason: string; details: string; until: string | null } | null;
  track: { at: string; actor: string; action: string; details: Record<string, unknown> }[];
  can: { prepare: boolean; approve: boolean; sendBack: boolean; cancel: boolean; settle: boolean };
}

export interface AdvanceSummary {
  given: number;
  settled: number;
  outstanding: number;
  toRecover: number;
  overdue: number;
  awaitingApproval: number;
  planned: number;
}

export interface AdvanceSettings {
  employeeDays: number;
  limits: Record<'Cash' | 'UPI' | 'Card', number>;
  highLimit: number;
  approval: 'second_person' | 'off';
}

export interface AdvancePlanInput {
  college: CollegeCode;
  payeeKind: PayeeKind;
  payeeName: string;
  payeePhone?: string;
  vendorId?: string;
  vendorCode?: string;
  vendorGst?: string;
  amount: number;
  plannedForm?: string;
  settleBy?: string;
  recoveredBy?: string;
  purpose?: string;
  head?: string;
  block?: string;
  caseNo?: string;
  poNo?: string;
  remarks?: string;
  form?: string;
  reference?: string;
  bank?: string;
  receivedBy?: string;
}
