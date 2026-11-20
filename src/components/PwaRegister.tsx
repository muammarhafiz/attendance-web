'use client';
// Registers the service worker app-wide so pushes work regardless of which page is open,
// and routes the app when a notification is tapped (iOS can't navigate the window client,
// so the SW postMessages us the target URL — see public/sw.js).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PwaRegister() {
  const router = useRouter();
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });

    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d && d.type === 'notification-navigate' && typeof d.url === 'string' && d.url) {
        router.push(d.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
