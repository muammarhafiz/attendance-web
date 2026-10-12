'use client';
// Shared success/error feedback. One ToastProvider is mounted in the root layout; any page calls
// useToast() -> toast.success / toast.error / toast.info. Toasts render in a fixed overlay above
// everything (z-[100], above drawers/modals), bottom-centre and safe-area aware, so the confirmation
// is always visible on a phone — never hidden behind a drawer or scrolled off the top of the page.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; text: string };
export type ToastApi = {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
const ToastCtx = createContext<ToastApi>(NOOP);

// Never crashes a page: without a provider it's a safe no-op.
export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++idRef.current;
    setItems((xs) => [...xs.slice(-2), { id, kind, text }]); // keep at most ~3 on screen
    const ttl = kind === 'error' ? 6000 : 3200;
    setTimeout(() => remove(id), ttl);
  }, [remove]);

  const api = useMemo<ToastApi>(() => ({
    success: (t) => push('success', t),
    error: (t) => push('error', t),
    info: (t) => push('info', t),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        {items.map((t) => (
          <button
            key={t.id}
            onClick={() => remove(t.id)}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium shadow-card ${
              t.kind === 'success' ? 'bg-good-soft text-good'
                : t.kind === 'error' ? 'bg-bad-soft text-bad'
                : 'border border-line bg-card text-ink'
            }`}
          >
            <span aria-hidden className="mt-px shrink-0 font-bold">{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'ℹ'}</span>
            <span className="flex-1">{t.text}</span>
          </button>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
