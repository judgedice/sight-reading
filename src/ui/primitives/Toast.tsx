import './primitives.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastSpec {
  text: string;
  action?: { label: string; onAction: () => void };
}

export interface ToastApi {
  /** Shows one toast, replacing any current one. Does nothing while suppressed (during a take). */
  show: (toast: ToastSpec) => void;
  dismiss: () => void;
}

/** Toasts last 4 seconds (04 section 7.5). */
export const TOAST_DURATION_MS = 4000;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

export interface ToastProviderProps {
  /** true during a take: no toast is shown and any current one is removed (7.5, 8.4). */
  suppressed?: boolean;
  durationMs?: number;
  children: ReactNode;
}

/** Owns the single toast slot and its polite live region (z 60). */
export function ToastProvider({ suppressed = false, durationMs = TOAST_DURATION_MS, children }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (next: ToastSpec) => {
      if (suppressed) return;
      if (timer.current !== null) clearTimeout(timer.current);
      setToast(next);
      timer.current = setTimeout(clear, durationMs);
    },
    [suppressed, durationMs, clear],
  );

  useEffect(() => {
    if (suppressed) clear();
  }, [suppressed, clear]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss: clear }), [show, clear]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite" aria-atomic="true">
        {toast && !suppressed ? (
          <div className="ui-toast" data-testid="toast">
            <span>{toast.text}</span>
            {toast.action ? (
              <button
                type="button"
                className="ui-toast-action"
                onClick={() => {
                  toast.action?.onAction();
                  clear();
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
