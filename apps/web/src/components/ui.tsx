import clsx from 'clsx';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react';
import type { Tone } from '../lib/format';

/**
 * Briques d'interface.
 *
 * Volontairement peu nombreuses: une seule variante de carte, un seul style de
 * champ, quatre variantes de bouton. Moins de choix à l'écriture, plus de
 * cohérence à l'écran.
 */

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={clsx('card', className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[0.95rem] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[0.85rem] text-[var(--color-ink-soft)]">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx('divider', className)} />;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx('btn', `btn-${variant}`, size === 'sm' && 'px-2.5 py-1 text-[0.85rem]', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------------

export function Field({ label, hint, error, children, required }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[0.85rem] font-medium">
        {label}
        {required && <span className="text-[var(--color-danger)]">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-[0.8rem] leading-snug text-[var(--color-ink-soft)]">{hint}</span>}
      {error && <span className="mt-1.5 block text-[0.8rem] text-[var(--color-danger)]">{error}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('field', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx('field', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('field font-mono text-[0.82rem] leading-relaxed', props.className)} />;
}

export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-[0.9rem] font-medium">{label}</div>
        {description && <p className="mt-0.5 text-[0.83rem] leading-snug text-[var(--color-ink-soft)]">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150',
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]',
          disabled && 'opacity-50',
        )}
      >
        <span
          className={clsx(
            'absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left] duration-150',
            checked ? 'left-[19px]' : 'left-[3px]',
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-sunk)] text-[var(--color-ink-soft)]',
  ok: 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]',
  warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.75rem] font-medium', TONE_CLASSES[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral' }: { tone?: Tone }) {
  const color: Record<Tone, string> = {
    neutral: 'var(--color-ink-faint)',
    ok: 'var(--color-ok)',
    warn: 'var(--color-warn)',
    danger: 'var(--color-danger)',
    info: 'var(--color-info)',
    accent: 'var(--color-accent)',
  };
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color[tone] }} />;
}

export function Progress({ value, tone = 'accent', className }: { value: number; tone?: Tone; className?: string }) {
  const color: Record<Tone, string> = {
    neutral: 'var(--color-ink-faint)',
    ok: 'var(--color-ok)',
    warn: 'var(--color-warn)',
    danger: 'var(--color-danger)',
    info: 'var(--color-info)',
    accent: 'var(--color-accent)',
  };
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunk)]', className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color[tone] }}
      />
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-[var(--color-ink-faint)]" />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-[var(--color-ink-faint)]">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[0.87rem] text-[var(--color-ink-soft)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fenêtres
// ---------------------------------------------------------------------------

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className={clsx('card animate-in max-h-[90vh] w-full overflow-hidden rounded-b-none sm:rounded-b-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center justify-between gap-4 px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost -mr-2 p-1.5" aria-label="Fermer">
            <X size={17} />
          </button>
        </header>
        <Divider />
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <>
            <Divider />
            <footer className="flex justify-end gap-2 px-5 py-3">{footer}</footer>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

const ToastContext = createContext<{ push: (level: Toast['level'], message: string) => void }>({ push: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((level: Toast['level'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, level, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);
  const icons = {
    info: <Info size={15} />,
    success: <Check size={15} />,
    warn: <AlertTriangle size={15} />,
    error: <AlertTriangle size={15} />,
  };
  const tones: Record<Toast['level'], Tone> = { info: 'info', success: 'ok', warn: 'warn', error: 'danger' };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="card animate-in pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 shadow-lg">
            <span className={clsx('mt-0.5 rounded-md p-1', TONE_CLASSES[tones[toast.level]])}>{icons[toast.level]}</span>
            <p className="flex-1 text-[0.87rem] leading-snug">{toast.message}</p>
            <button type="button" className="btn btn-ghost -mr-1 -mt-1 p-1" onClick={() => setToasts((p) => p.filter((t) => t.id !== toast.id))} aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Navigation locale
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-lg px-2.5 py-1 text-[0.85rem] font-medium transition-colors',
            value === option.value
              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]'
              : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-sunk)] hover:text-[var(--color-ink)]',
          )}
        >
          {option.label}
          {option.count !== undefined && <span className="tnum ml-1.5 opacity-60">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
