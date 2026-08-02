'use client';
// Centered spinning-logo overlay shown during page navigation. It fires when an in-app link is
// clicked and clears once the new route renders — with a short delay so instant navigations don't
// flash the overlay, and a safety timeout so it can never get stuck.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

export default function RouteLoader() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  // Route changed → navigation finished.
  useEffect(() => { clearTimer(); setShow(false); }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      const target = a.getAttribute('target');
      if (!href || target === '_blank' || a.hasAttribute('download') || href.startsWith('#')) return;
      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      // Only show if the navigation takes long enough to notice (avoids a flash on instant loads).
      clearTimer();
      timer.current = setTimeout(() => setShow(true), 140);
    };
    document.addEventListener('click', onClick, true);
    return () => { document.removeEventListener('click', onClick, true); clearTimer(); };
  }, []);

  // Safety: never stay up forever.
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 8000);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-card/70 backdrop-blur-sm" aria-live="polite" aria-busy="true">
      <Image src="/icon.png" alt="Loading…" width={64} height={64} priority className="h-16 w-16 animate-spin" style={{ animationDuration: '1.1s' }} />
    </div>
  );
}
