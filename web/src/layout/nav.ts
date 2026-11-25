import type { Permission } from '@/api/types';
import { isVoucherAdmin } from '@/auth/AuthProvider';
import type { CurrentUser } from '@/api/types';
import type { IconName } from '@/components/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  visible: (u: CurrentUser, can: (p: Permission) => boolean) => boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const USER_ADMIN: Permission[] = ['create_users', 'create_admin', 'manage_permissions', 'reset_passwords', 'block_users', 'change_admin_key'];

export const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', visible: (_u, can) => can('view_dashboard') },
      { to: '/my-dashboard', label: 'My Dashboard', icon: 'dashboard', visible: (_u, can) => !can('view_dashboard') },
      { to: '/analytics', label: 'Analytics', icon: 'analytics', visible: (_u, can) => can('view_analytics') },
    ],
  },
  {
    title: 'Vouchers',
    items: [
      { to: '/vouchers/new', label: 'New Voucher', icon: 'plus', visible: (_u, can) => can('create_voucher') },
      { to: '/vouchers', label: 'All Vouchers', icon: 'list', visible: (u, can) => isVoucherAdmin(u) || can('view_all_vouchers') },
      { to: '/my-vouchers', label: 'My Vouchers', icon: 'file', visible: (u, can) => !isVoucherAdmin(u) && !can('view_all_vouchers') },
    ],
  },
  {
    title: 'Vendors',
    items: [
      { to: '/vendors', label: 'Vendors & Agreements', icon: 'vendors', visible: (_u, can) => can('manage_vendors') },
      {
        to: '/vendor-ledger',
        label: 'Vendor Ledger',
        icon: 'ledger',
        visible: (u, can) => isVoucherAdmin(u) || can('view_vendor_ledger') || can('manage_vendors'),
      },
    ],
  },
  {
    title: 'Export & Reports',
    items: [
      { to: '/cash-book', label: 'Cash Book', icon: 'cashbook', visible: (_u, can) => can('cash_book') },
      { to: '/exports', label: 'Excel Exports', icon: 'download', visible: (_u, can) => can('export_excel') },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users & Permissions', icon: 'users', visible: (_u, can) => USER_ADMIN.some(can) },
      { to: '/admin/colleges', label: 'Colleges', icon: 'building', visible: (_u, can) => can('manage_colleges') },
      { to: '/admin/audit', label: 'Audit Log', icon: 'shield', visible: (_u, can) => can('view_audit') },
    ],
  },
  {
    title: 'Settings',
    items: [
      { to: '/settings/printer', label: 'Printer Setup', icon: 'printer', visible: (_u, can) => can('printer_setup') || can('print_voucher') },
      { to: '/account', label: 'My Account', icon: 'account', visible: () => true },
    ],
  },
];

/** First page a user lands on after sign-in. */
export function homePath(can: (p: Permission) => boolean): string {
  return can('view_dashboard') ? '/dashboard' : '/my-dashboard';
}
