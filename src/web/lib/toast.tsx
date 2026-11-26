import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastVariant = 'default' | 'success' | 'danger';

export type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastContextValue = {
  notify: (input: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'border-border bg-surface text-text',
  success: 'border-success bg-surface text-text',
  danger: 'border-danger bg-surface text-text',
};

export function ToastStateProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(({ title, description, variant = 'default', durationMs = 4000 }: ToastInput) => {
    const id = nextIdRef.current++;
    setItems((prev) => [...prev.slice(-3), { id, title, description, variant }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, durationMs);
  }, []);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        data-testid="toast-viewport"
        className="pointer-events-none fixed bottom-16 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 md:bottom-4"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.variant === 'danger' ? 'alert' : 'status'}
            data-testid={`toast-${item.variant}`}
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-[var(--radius-md)] border p-3.5 shadow-md ${VARIANT_CLASSES[item.variant]}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-snug">{item.title}</div>
              {item.description ? <p className="mt-0.5 text-xs text-text-muted">{item.description}</p> : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dismiss(item.id)}
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-surface-muted hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      notify: () => undefined,
      dismiss: () => undefined,
    };
  }
  return ctx;
}
