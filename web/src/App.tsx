import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import type { Permission } from '@/api/types';
import { isVoucherAdmin, useAuth } from '@/auth/AuthProvider';
import { EmptyState, Spinner } from '@/components/ui';
import { AccountPage, AuditPage, CollegesPage, UsersPage } from '@/features/admin';
import { AdvanceDetailPage, AdvanceFormPage, AdvancesPage } from '@/features/advances';
import { AnalyticsPage, CashBookPage, DashboardPage, ExportsPage, MyDashboardPage } from '@/features/reports';
import { VendorLedgerPage, VendorsPage } from '@/features/vendors';
import { PrinterSetupPage, VoucherFormPage, VoucherListPage } from '@/features/vouchers';
import { AppShell } from '@/layout/AppShell';
import { homePath } from '@/layout/nav';
import { ForcedPasswordChange } from '@/pages/ChangePasswordPage';
import { LoginPage } from '@/pages/LoginPage';
import { RenewedPage } from '@/pages/RenewedPage';
import { SsoCallbackPage } from '@/pages/SsoCallbackPage';

function Protected() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-maroon-700">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (status === 'anonymous' || !user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return <AppShell />;
}

/** Hides a page the user has no permission for (the API enforces the same rules). */
function Gate({ allow, children }: { allow: (can: (p: Permission) => boolean, voucherAdmin: boolean) => boolean; children: ReactNode }) {
  const { can, user } = useAuth();
  if (!allow(can, isVoucherAdmin(user))) {
    return <EmptyState title="You don't have access to this page">Ask your Accounts administrator to grant the permission if you need it.</EmptyState>;
  }
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  return <Navigate to={homePath(can)} replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/uos/renewed', element: <RenewedPage /> },
  // The UOS shell opens modules at <base_url>/sso-callback#token=…&returnTo=…
  { path: '/sso-callback', element: <SsoCallbackPage /> },
  {
    path: '/',
    element: <Protected />,
    children: [
      { index: true, element: <Home /> },
      { path: 'dashboard', element: <Gate allow={(can) => can('view_dashboard')}><DashboardPage /></Gate> },
      { path: 'my-dashboard', element: <MyDashboardPage /> },
      { path: 'analytics', element: <Gate allow={(can) => can('view_analytics')}><AnalyticsPage /></Gate> },
      { path: 'vouchers', element: <Gate allow={(can, admin) => admin || can('view_all_vouchers')}><VoucherListPage scope="all" /></Gate> },
      { path: 'my-vouchers', element: <VoucherListPage scope="mine" /> },
      { path: 'vouchers/new', element: <Gate allow={(can) => can('create_voucher')}><VoucherFormPage /></Gate> },
      { path: 'vouchers/:id/edit', element: <VoucherFormPage /> },
      {
        path: 'advances',
        element: <Gate allow={(can, admin) => admin || can('manage_advances') || can('approve_advances') || can('view_all_vouchers')}><AdvancesPage /></Gate>,
      },
      { path: 'advances/new', element: <Gate allow={(can) => can('manage_advances')}><AdvanceFormPage /></Gate> },
      // The server decides who may open one advance (its preparer always can).
      { path: 'advances/:id', element: <AdvanceDetailPage /> },
      { path: 'vendors', element: <Gate allow={(can) => can('manage_vendors')}><VendorsPage /></Gate> },
      {
        path: 'vendor-ledger',
        element: <Gate allow={(can, admin) => admin || can('view_vendor_ledger') || can('manage_vendors')}><VendorLedgerPage /></Gate>,
      },
      { path: 'cash-book', element: <Gate allow={(can) => can('cash_book')}><CashBookPage /></Gate> },
      { path: 'exports', element: <Gate allow={(can) => can('export_excel')}><ExportsPage /></Gate> },
      { path: 'settings/printer', element: <PrinterSetupPage /> },
      { path: 'account', element: <AccountPage /> },
      {
        path: 'admin/users',
        element: (
          <Gate allow={(can) => ['create_users', 'create_admin', 'manage_permissions', 'reset_passwords', 'block_users', 'change_admin_key'].some((p) => can(p as Permission))}>
            <UsersPage />
          </Gate>
        ),
      },
      { path: 'admin/colleges', element: <Gate allow={(can) => can('manage_colleges')}><CollegesPage /></Gate> },
      { path: 'admin/audit', element: <Gate allow={(can) => can('view_audit')}><AuditPage /></Gate> },
      { path: '*', element: <EmptyState title="Page not found" /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
