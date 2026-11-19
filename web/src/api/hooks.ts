import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, get, patch, post, put } from './client';
import type {
  AccountHead,
  AuditLog,
  Block,
  College,
  CollegeCode,
  ManagedUser,
  Permission,
  UserInput,
  Vendor,
  VendorInput,
  Voucher,
  VoucherInput,
} from './types';

export const qk = {
  me: ['me'] as const,
  publicColleges: ['colleges', 'public'] as const,
  colleges: ['colleges'] as const,
  vouchers: (college: CollegeCode) => ['vouchers', college] as const,
  heads: (college: CollegeCode) => ['heads', college] as const,
  blocks: (college: CollegeCode) => ['blocks', college] as const,
  vendors: (college: CollegeCode) => ['vendors', college] as const,
  users: ['users'] as const,
  audit: ['audit'] as const,
};

/** Live sync interval (the legacy app polled the cloud every ~30s). */
export const LIVE_SYNC_MS = 30_000;

// ---------------- Colleges ----------------

export function usePublicColleges() {
  return useQuery({
    queryKey: qk.publicColleges,
    queryFn: () => get<{ colleges: College[] }>('/api/colleges/public').then((r) => r.colleges),
    staleTime: 5 * 60_000,
  });
}

export function useColleges() {
  return useQuery({
    queryKey: qk.colleges,
    queryFn: () => get<{ colleges: College[] }>('/api/colleges').then((r) => r.colleges),
    staleTime: 5 * 60_000,
  });
}

export function useCreateCollege() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; code?: string; location?: string; logoUrl?: string }) =>
      post<{ colleges: College[] }>('/api/colleges', body),
    onSuccess: (r) => {
      qc.setQueryData(qk.colleges, r.colleges);
      qc.invalidateQueries({ queryKey: qk.publicColleges });
    },
  });
}

export function useSetCollegeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, status }: { code: string; status: 'active' | 'inactive' }) =>
      patch<{ colleges: College[] }>(`/api/colleges/${encodeURIComponent(code)}/status`, { status }),
    onSuccess: (r) => {
      qc.setQueryData(qk.colleges, r.colleges);
      qc.invalidateQueries({ queryKey: qk.publicColleges });
    },
  });
}

// ---------------- Vouchers ----------------

/**
 * All vouchers visible to the user in a college. Polls every 30s using ETag/304,
 * so an unchanged list costs a single tiny query on the server.
 */
const voucherEtags = new Map<string, string>();

export function useVouchers(college: CollegeCode | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.vouchers(college ?? ''),
    enabled: !!college,
    refetchInterval: LIVE_SYNC_MS,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const key = college!;
      const cached = qc.getQueryData<Voucher[]>(qk.vouchers(key));
      const etag = cached ? voucherEtags.get(key) : undefined;
      const res = await fetch(`/api/vouchers?college=${encodeURIComponent(key)}`, {
        credentials: 'same-origin',
        signal,
        headers: etag ? { 'If-None-Match': etag } : {},
      });
      if (res.status === 304 && cached) return cached;
      if (!res.ok) {
        // 401 / errors: go through the shared client (silent refresh + readable error).
        voucherEtags.delete(key);
        const data = await api<{ vouchers: Voucher[] }>('/api/vouchers', { query: { college: key }, signal });
        return data.vouchers;
      }
      const tag = res.headers.get('ETag');
      if (tag) voucherEtags.set(key, tag);
      return ((await res.json()) as { vouchers: Voucher[] }).vouchers;
    },
  });
}

export function useSaveVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: VoucherInput & { id?: number }) =>
      id ? put<{ voucher: Voucher }>(`/api/vouchers/${id}`, input) : post<{ voucher: Voucher }>('/api/vouchers', input),
    onSuccess: (r) => qc.invalidateQueries({ queryKey: qk.vouchers(r.voucher.college) }),
  });
}

export function useDeleteVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; college: CollegeCode }) => del<{ ok: true }>(`/api/vouchers/${id}`),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: qk.vouchers(v.college) }),
  });
}

// ---------------- Heads & blocks ----------------

export function useHeads(college: CollegeCode | undefined) {
  return useQuery({
    queryKey: qk.heads(college ?? ''),
    enabled: !!college,
    queryFn: () => get<{ heads: AccountHead[] }>('/api/heads', { college }).then((r) => r.heads),
    staleTime: 60_000,
  });
}

export function useAddHead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; type?: AccountHead['type']; college: CollegeCode }) =>
      post<{ heads: AccountHead[] }>('/api/heads', b),
    onSuccess: (r, b) => qc.setQueryData(qk.heads(b.college), r.heads),
  });
}

export function useBlocks(college: CollegeCode | undefined) {
  return useQuery({
    queryKey: qk.blocks(college ?? ''),
    enabled: !!college,
    queryFn: () => get<{ blocks: Block[] }>('/api/blocks', { college }).then((r) => r.blocks),
    staleTime: 60_000,
  });
}

export function useAddBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; college: CollegeCode }) => post<{ blocks: Block[] }>('/api/blocks', b),
    onSuccess: (r, b) => qc.setQueryData(qk.blocks(b.college), r.blocks),
  });
}

// ---------------- Vendors ----------------

export function useVendors(college: CollegeCode | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.vendors(college ?? ''),
    enabled: !!college && enabled,
    queryFn: () => get<{ vendors: Vendor[] }>('/api/vendors', { college }).then((r) => r.vendors),
    staleTime: 30_000,
  });
}

export function useSaveVendor() {
  const qc = useQueryClient();
  return useMutation({
    /** create: true when adding a new vendor - the server answers 409 instead of overwriting an existing ID. */
    mutationFn: ({ college, vendor, create = false }: { college: CollegeCode; vendor: VendorInput; create?: boolean }) =>
      put<{ ok: true; vendor: Vendor }>('/api/vendors', { college, create, vendor: { ...vendor, college } }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: qk.vendors(v.college) }),
  });
}

export function useBulkSaveVendors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ college, vendors }: { college: CollegeCode; vendors: VendorInput[] }) =>
      post<{ ok: true; saved: number; failed: { vendorId: string; error: string }[] }>('/api/vendors/bulk', { college, vendors }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: qk.vendors(v.college) }),
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ college, vendorId }: { college: CollegeCode; vendorId: string }) =>
      del<{ ok: true }>(`/api/vendors/${encodeURIComponent(vendorId)}`, { college }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: qk.vendors(v.college) }),
  });
}

/** URL to open/download a vendor attachment (served with the user's session cookie). */
export function vendorFileUrl(college: CollegeCode, vendorId: string, fileId: string, download = false) {
  const q = new URLSearchParams({ college });
  if (download) q.set('download', '1');
  return `/api/vendors/${encodeURIComponent(vendorId)}/files/${encodeURIComponent(fileId)}?${q}`;
}

// ---------------- Users ----------------

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: qk.users,
    enabled,
    queryFn: () => get<{ users: ManagedUser[]; permissions: Permission[] }>('/api/users'),
  });
}

function useUserMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }) });
}

export const useCreateUser = () => useUserMutation((u: UserInput & { username: string; password: string }) => post('/api/users', { ...u }));
export const useUpdateUser = () =>
  useUserMutation(({ username, ...u }: UserInput & { username: string }) => patch(`/api/users/${encodeURIComponent(username)}`, { ...u }));
export const useSetUserStatus = () =>
  useUserMutation(({ username, status }: { username: string; status: 'active' | 'blocked' }) =>
    patch(`/api/users/${encodeURIComponent(username)}/status`, { status }),
  );
export const useResetPassword = () =>
  useUserMutation(({ username, password }: { username: string; password: string }) =>
    post<{ ok: true; signedOut: boolean }>(`/api/users/${encodeURIComponent(username)}/reset-password`, { password }),
  );
export const useDeleteUser = () => useUserMutation(({ username }: { username: string }) => del(`/api/users/${encodeURIComponent(username)}`));

// ---------------- Audit ----------------

export function useAudit(enabled = true) {
  return useQuery({
    queryKey: qk.audit,
    enabled,
    queryFn: () => get<{ logs: AuditLog[] }>('/api/audit').then((r) => r.logs),
  });
}
