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
/** The shell's buttons: .btn-primary, .btn-secondary, .btn-ghost, .btn-danger-quiet. */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-card hover:brightness-110',
  secondary: 'bg-[var(--btn-secondary-bg)] text-fg border border-[var(--btn-secondary-edge)] shadow-card hover:bg-[var(--btn-secondary-hover)]',
  ghost: 'text-accent hover:bg-surface-2',
  danger: 'bg-transparent text-danger ring-[1.5px] ring-inset ring-danger hover:bg-danger-tint',
  gold: 'bg-warning text-surface-1 hover:brightness-110',
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
        'inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.006em] whitespace-nowrap transition-[background,box-shadow,filter] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-9 rounded-md px-3.5 text-[13px]' : 'h-12 rounded-lg px-5 text-[14.5px]',
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

/** The shell's .field input: 48px, 14px corners, accent border and soft ring on focus. */
const control =
  'rounded-lg border border-line bg-surface-1 px-3.5 text-[15px] text-fg placeholder:text-ink-30 transition-[border-color,box-shadow] hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft disabled:bg-surface-2 disabled:text-ink-50';

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
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-fg">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs font-semibold text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(control, sized(className, 'h-12'), className)} {...rest} />;
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
    <select ref={ref} className={cx(control, sized(className, 'h-12'), 'cursor-pointer pr-9', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input id={id} type="checkbox" className="size-[18px] cursor-pointer accent-[var(--accent)]" {...rest} />
      {label}
    </label>
  );
}

// ---------- Layout bits ----------

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl bg-surface-1 shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-5 py-4">
          {title && <h3 className="text-base font-bold tracking-[-0.012em] text-fg">{title}</h3>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.015em] text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The shell's .kpi card: label, a mono figure, a note. The tone marks what kind of money it is. */
export function StatCard({ label, value, hint, tone = 'maroon' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'maroon' | 'debit' | 'credit' | 'onaccount' | 'gold' }) {
  const dot = { maroon: 'bg-accent', debit: 'bg-debit', credit: 'bg-credit', onaccount: 'bg-onaccount', gold: 'bg-warning' }[tone];
  return (
    <div className="relative flex flex-col gap-1 overflow-hidden rounded-2xl bg-surface-1 px-5 py-[18px] shadow-card">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.01em] text-ink-50">
        <span className={cx('size-1.5 shrink-0 rounded-full', dot)} aria-hidden />
        {label}
      </p>
      <p className="mt-0.5 break-words font-mono text-[26px] leading-none font-medium tracking-[-0.02em] text-fg tabular">{value}</p>
      {hint && <p className="text-xs text-ink-50">{hint}</p>}
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
  // The shell's .pill-* colours (pill-neutral, pill-success, pill-warning, pill-danger) and the accent tint.
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    debit: 'bg-danger-tint text-danger',
    credit: 'bg-success-tint text-success',
    onaccount: 'bg-warning-tint text-warning',
    gold: 'bg-warning-tint text-warning',
    maroon: 'bg-accent-tint text-accent',
    success: 'bg-success-tint text-success',
    danger: 'bg-danger-tint text-danger',
  };
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-none font-semibold whitespace-nowrap ring-1 ring-inset ring-current/15',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-1 px-5 py-9 text-center shadow-card">
      <p className="text-[15px] font-bold text-fg">{title}</p>
      {children && <div className="max-w-[42ch] text-[13.5px] text-ink-50">{children}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-lg bg-danger-tint px-4 py-3.5 text-sm text-danger ring-1 ring-inset ring-current/15">
      {children}
    </div>
  );
}

/** Horizontally scrollable table wrapper with consistent cell styles (use `th`/`td` normally). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-xl bg-surface-1 shadow-card', className)}>
      <table className="w-full min-w-max text-left text-[13.5px] text-ink-60 [&_td]:px-[18px] [&_td]:py-3.5 [&_td]:align-middle [&_th]:border-b [&_th]:border-hair [&_th]:bg-bg-2 [&_th]:px-[18px] [&_th]:py-3 [&_th]:text-[10.5px] [&_th]:font-semibold [&_th]:tracking-[0.14em] [&_th]:text-ink-50 [&_th]:uppercase [&_tbody_tr]:border-t [&_tbody_tr]:border-hair [&_tbody_tr:first-child]:border-t-0 [&_tbody_tr:hover_td]:bg-surface-2">
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
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl bg-surface-1 p-0 text-fg shadow-elev-3 backdrop:bg-black/40', width)}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-hair px-6 py-4">
            <h2 className="text-xl font-bold tracking-[-0.012em] text-fg">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="Close"
            >
              ✕
            </button>
          </header>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-hair bg-surface-2 px-6 py-4">{footer}</footer>}
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
