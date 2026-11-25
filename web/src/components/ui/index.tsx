/**
 * Small in-house component kit (no Radix/shadcn). Every page builds on these so
 * the look stays consistent with the UOS shell: white surfaces, neutral greys,
 * maroon accent (tokens in index.css).
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-maroon-700 text-white shadow-sm hover:bg-maroon-800 disabled:bg-maroon-700/50',
  secondary: 'bg-white text-ink border border-sand-200 shadow-sm hover:bg-sand-50 disabled:opacity-50',
  ghost: 'text-sand-800 hover:bg-sand-100 disabled:opacity-50',
  danger: 'bg-white text-debit border border-debit/30 hover:bg-red-50 disabled:opacity-50',
  gold: 'bg-gold-500 text-white hover:bg-gold-400 disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Form fields ----------

const control =
  'rounded-lg border border-sand-200 bg-white px-3 text-sm text-ink shadow-sm placeholder:text-sand-400 focus:border-maroon-500 focus:outline-none focus:ring-2 focus:ring-maroon-500/15 disabled:bg-sand-100 disabled:text-sand-600';

/**
 * Default full width / standard height, unless the caller sets its own.
 * (In the generated CSS w-full and h-10 come after w-40, h-9 etc., so passing
 * both would always give full width.)
 */
function sized(className: string | undefined, height: string): string {
  const c = className ?? '';
  return cx(/(?:^|\s)w-/.test(c) ? '' : 'w-full', height && !/(?:^|\s)h-/.test(c) ? height : '');
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-sand-600">
          {label}
          {required && <span className="text-debit"> *</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-debit">{error}</p> : hint ? <p className="text-xs text-sand-600">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(control, sized(className, 'h-10'), className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cx(control, sized(className, ''), 'py-2', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(control, sized(className, 'h-10'), 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input id={id} type="checkbox" className="size-4 accent-maroon-700" {...rest} />
      {label}
    </label>
  );
}

// ---------- Layout bits ----------

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-sand-200 bg-white shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 px-4 py-3">
          {title && <h3 className="text-base font-semibold text-ink">{title}</h3>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-sand-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'maroon' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'maroon' | 'debit' | 'credit' | 'onaccount' | 'gold' }) {
  const bar = { maroon: 'bg-maroon-700', debit: 'bg-debit', credit: 'bg-credit', onaccount: 'bg-onaccount', gold: 'bg-gold-500' }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-sand-200 bg-white p-4 shadow-card">
      <span className={cx('absolute inset-x-0 top-0 h-0.5', bar)} />
      <p className="text-xs font-medium text-sand-600">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold leading-tight tabular 2xl:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-sand-600">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'debit' | 'credit' | 'onaccount' | 'gold' | 'maroon' | 'success' | 'danger';
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: 'bg-sand-100 text-sand-800',
    debit: 'bg-red-50 text-debit',
    credit: 'bg-green-50 text-credit',
    onaccount: 'bg-orange-50 text-onaccount',
    gold: 'bg-yellow-50 text-gold-500',
    maroon: 'bg-maroon-50 text-maroon-700',
    success: 'bg-green-50 text-credit',
    danger: 'bg-red-50 text-debit',
  };
  return (
    <span title={title} className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-sand-200 px-6 py-10 text-center">
      <p className="font-medium text-sand-800">{title}</p>
      {children && <div className="mt-1 text-sm text-sand-600">{children}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-debit">
      {children}
    </div>
  );
}

/** Horizontally scrollable table wrapper with consistent cell styles (use `th`/`td` normally). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card', className)}>
      <table className="w-full min-w-max text-left text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:border-b [&_th]:border-sand-200 [&_th]:bg-sand-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-sand-600 [&_tbody_tr]:border-t [&_tbody_tr]:border-sand-100 [&_tbody_tr:first-child]:border-t-0 [&_tbody_tr:hover]:bg-sand-50/70">
        {children}
      </table>
    </div>
  );
}

// ---------- Modal (native <dialog>) ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.() ?? d.setAttribute('open', '');
    if (!open && d.open) d.close?.() ?? d.removeAttribute('open');
  }, [open]);
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-6xl' }[size];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-xl p-0 shadow-2xl backdrop:bg-black/40', width)}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-sand-200 px-5 py-3">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-sand-600 hover:bg-sand-100" aria-label="Close">
              ✕
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-sand-200 bg-sand-50/60 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Promise-free confirm dialog. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-sand-800">{message}</div>
    </Modal>
  );
}
