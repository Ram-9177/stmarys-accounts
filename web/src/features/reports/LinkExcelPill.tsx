/**
 * "Link Excel": pick an .xlsx file once; every time the college's voucher list
 * changes (save, edit, delete, or live sync), the file is rewritten in place.
 * Uses the File System Access API (Chrome / Edge). The file handle is kept in
 * IndexedDB per college so the link survives a page refresh; after a restart the
 * browser asks for permission again on the first click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useColleges, useVouchers } from '@/api/hooks';
import type { Voucher } from '@/api/types';
import { useSession } from '@/auth/AuthProvider';
import { ConfirmDialog, cx } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { vouchersWorkbookBytes } from './excel';

// ---- Minimal typings for the parts of the File System Access API we use ----
type PermState = 'granted' | 'denied' | 'prompt';
interface XlHandle {
  name: string;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermState>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
interface PickerWindow {
  showOpenFilePicker?(o: unknown): Promise<XlHandle[]>;
  showSaveFilePicker?(o: unknown): Promise<XlHandle>;
}
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PICKER_TYPES = [{ description: 'Excel', accept: { [XLSX_TYPE]: ['.xlsx'] } }];

// ---- IndexedDB (all access wrapped: private windows / blocked storage just disable persistence) ----
const DB = 'stmv_xl';
const STORE = 'h';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key: string): Promise<XlHandle | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      q.onsuccess = () => res((q.result as XlHandle) ?? null);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
async function idbPut(key: string, h: XlHandle | null): Promise<void> {
  try {
    const db = await idb();
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    if (h) store.put(h, key);
    else store.delete(key);
  } catch {
    /* persistence unavailable */
  }
}

export function isLinkExcelSupported(): boolean {
  return typeof window !== 'undefined' && ('showSaveFilePicker' in window || 'showOpenFilePicker' in window);
}

const signature = (vs: Voucher[]) => `${vs.length}|${vs.reduce((m, v) => (v.updatedAt > m ? v.updatedAt : m), '')}|${vs.reduce((s, v) => s + v.id, 0)}`;

type State = 'unlinked' | 'linked' | 'needs-grant' | 'saving';

export function LinkExcelPill() {
  const { college } = useSession();
  const toast = useToast();
  const vouchers = useVouchers(college);
  const colleges = useColleges();
  const collegeObj = colleges.data?.find((c) => c.code === college);
  const [handle, setHandle] = useState<XlHandle | null>(null);
  const [state, setState] = useState<State>('unlinked');
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const lastWritten = useRef<string>('');
  const key = `linked:${college}`;
  const supported = isLinkExcelSupported();

  // Restore the handle for this college.
  useEffect(() => {
    let alive = true;
    setHandle(null);
    setState('unlinked');
    lastWritten.current = '';
    if (!supported) return;
    idbGet(key).then(async (h) => {
      if (!alive || !h) return;
      setHandle(h);
      let perm: PermState = 'prompt';
      try {
        perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
      } catch {
        /* ignore */
      }
      if (alive) setState(perm === 'granted' ? 'linked' : 'needs-grant');
    });
    return () => {
      alive = false;
    };
  }, [key, supported]);

  const write = useCallback(
    async (h: XlHandle, list: Voucher[]) => {
      setState('saving');
      try {
        const bytes = await vouchersWorkbookBytes(list, collegeObj);
        const w = await h.createWritable();
        await w.write(new Blob([bytes], { type: XLSX_TYPE }));
        await w.close();
        lastWritten.current = signature(list);
        setState('linked');
      } catch (err) {
        console.error(err);
        toast(`Excel auto-save failed: ${(err as Error).message}`, 'error');
        setState('needs-grant');
      }
    },
    [collegeObj, toast],
  );

  // Auto-write whenever the voucher list actually changes (debounced).
  useEffect(() => {
    if (!handle || state !== 'linked' || !vouchers.data) return;
    if (signature(vouchers.data) === lastWritten.current) return;
    const list = vouchers.data;
    const t = setTimeout(() => void write(handle, list), 1500);
    return () => clearTimeout(t);
  }, [handle, state, vouchers.data, write]);

  async function onClick() {
    if (handle && state === 'needs-grant') {
      try {
        const p = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
        if (p === 'granted') {
          setState('linked');
          toast(`Re-linked: ${handle.name}`);
        } else toast('Permission denied', 'error');
      } catch (err) {
        toast(`Restore failed: ${(err as Error).message}`, 'error');
      }
      return;
    }
    if (handle) {
      setConfirmUnlink(true);
      return;
    }
    const w = window as unknown as PickerWindow;
    try {
      let h: XlHandle;
      if (w.showOpenFilePicker) {
        [h] = await w.showOpenFilePicker({ types: PICKER_TYPES, excludeAcceptAllOption: false, multiple: false });
        const perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
        if (perm !== 'granted') {
          toast('Write permission denied', 'error');
          return;
        }
      } else {
        h = await w.showSaveFilePicker!({ suggestedName: `StMarys_Vouchers_${college}.xlsx`, types: PICKER_TYPES });
      }
      await idbPut(key, h);
      setHandle(h);
      lastWritten.current = '';
      setState('linked');
      toast(`Linked: ${h.name}. Every change now updates this file.`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast(`Link failed: ${(err as Error).message}`, 'error');
    }
  }

  async function unlink() {
    await idbPut(key, null);
    setHandle(null);
    setState('unlinked');
    setConfirmUnlink(false);
    toast('Excel unlinked', 'info');
  }

  if (!supported) return null;

  const label =
    state === 'unlinked'
      ? '📎 Link Excel'
      : state === 'needs-grant'
        ? `🔓 Click to restore: ${handle?.name}`
        : state === 'saving'
          ? `⏳ Saving ${handle?.name}`
          : `✅ ${handle?.name}`;
  const title =
    state === 'unlinked'
      ? 'Pick an Excel file — every voucher change will update it directly.'
      : state === 'needs-grant'
        ? 'Click and approve to re-enable auto-save'
        : 'Click to unlink. Changes are written to this file.';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={cx(
          'max-w-56 truncate rounded-full border px-3 py-1 text-xs',
          state === 'unlinked' ? 'border-white/30 hover:bg-white/10' : 'border-gold-400 bg-gold-500/20',
          state === 'needs-grant' && 'animate-pulse',
        )}
      >
        {label}
      </button>
      <ConfirmDialog
        open={confirmUnlink}
        title="Unlink Excel file?"
        message={`Future changes will not be written to "${handle?.name}". The file itself is kept.`}
        confirmLabel="Unlink"
        onConfirm={unlink}
        onCancel={() => setConfirmUnlink(false)}
      />
    </>
  );
}
