'use client';
// Registers the service worker app-wide so pushes work regardless of which page is open.
import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });
    }
  }, []);
  return null;
}
