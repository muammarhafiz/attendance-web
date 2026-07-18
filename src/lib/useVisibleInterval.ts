import { useEffect, useRef } from 'react';

/**
 * Like setInterval, but it only runs while the browser tab is visible, and it fires once
 * immediately when the tab becomes visible/focused again. A backgrounded tab makes ZERO calls —
 * this stops left-open admin/board screens from polling the DB every few seconds forever.
 *
 * - `enabled = false` turns the timer off entirely (e.g. until the user is authorised).
 * - `fn` is always invoked with its latest closure (via a ref), so it can safely read changing
 *   state/props without churning the interval. The interval is only re-created when `ms` or
 *   `enabled` change.
 */
export function useVisibleInterval(fn: () => void, ms: number, enabled: boolean | null | undefined = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const runIfVisible = () => { if (typeof document === 'undefined' || !document.hidden) saved.current(); };
    const id = setInterval(runIfVisible, ms);
    document.addEventListener('visibilitychange', runIfVisible);
    window.addEventListener('focus', runIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', runIfVisible);
      window.removeEventListener('focus', runIfVisible);
    };
  }, [ms, enabled]);
}
