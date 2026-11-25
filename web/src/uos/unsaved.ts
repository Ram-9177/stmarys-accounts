import { useEffect } from 'react';

/**
 * Unsaved work on screen (a voucher or vendor form being filled in).
 * Re-entering through UOS reloads the page, so it waits while there is any.
 */
const dirty = new Set<string>();
const listeners = new Set<() => void>();

export function setUnsaved(key: string, on: boolean) {
  const had = dirty.has(key);
  if (on) dirty.add(key);
  else dirty.delete(key);
  if (had !== on) listeners.forEach((fn) => fn());
}

/** True while a form has unsaved changes or a dialog is open. */
export function hasUnsavedWork(): boolean {
  return dirty.size > 0 || (typeof document !== 'undefined' && !!document.querySelector('dialog[open]'));
}

export function onUnsavedChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Marks `key` as unsaved while `on` is true (and clears it when the component unmounts). */
export function useUnsavedWork(key: string, on: boolean) {
  useEffect(() => {
    setUnsaved(key, on);
    return () => setUnsaved(key, false);
  }, [key, on]);
}
