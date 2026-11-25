import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cx } from './index';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  kind: Kind;
}

const ToastContext = createContext<((message: string, kind?: Kind) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto rounded-lg px-4 py-3.5 text-sm font-semibold shadow-elev-3 ring-1 ring-inset ring-current/15',
              t.kind === 'success' && 'bg-success-tint text-success',
              t.kind === 'error' && 'bg-danger-tint text-danger',
              t.kind === 'info' && 'bg-accent-tint text-accent',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
