'use client';
// Per-device push control: turn phone notifications on/off for THIS device, and send a test.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false); // iOS Safari, not yet added to Home Screen

  const refresh = useCallback(async () => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) {
      // iOS only supports web push when launched from an installed (Home Screen) app.
      const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        typeof window !== 'undefined' &&
        (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
      if (isIOS && !standalone) setNeedsInstall(true);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setMsg('Permission was blocked. Allow notifications for this site in your browser settings, then try again.'); setBusy(false); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { data: pub, error: kErr } = await supabase.rpc('push_public_key');
      if (kErr || !pub) { setMsg('Could not load the push key. Try again in a moment.'); setBusy(false); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pub as string) as unknown as BufferSource });
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const { error } = await supabase.rpc('push_subscribe', {
        p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent,
      });
      if (error) { setMsg(error.message); setBusy(false); return; }
      setSubscribed(true);
      setMsg('On for this device. You can send a test below.');
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Could not turn on notifications.');
    }
    setBusy(false);
  }, []);

  const disable = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg('Off for this device.');
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Could not turn off notifications.');
    }
    setBusy(false);
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/push/test', { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(body?.error || 'Test failed.'); setBusy(false); return; }
      setMsg(body?.sent > 0 ? 'Test sent — check your notifications.' : 'No device received it.');
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Test failed.');
    }
    setBusy(false);
  }, []);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Phone notifications</h2>
      <p className="mt-1 text-xs text-gray-500">
        Get a push on this device whenever the notification bell has a new alert — even when the app is closed. Set this up on each phone you use.
      </p>

      {needsInstall ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">On iPhone/iPad:</span> tap the <span className="font-medium">Share</span> button →
          <span className="font-medium"> Add to Home Screen</span>, then open <span className="font-medium">Zordaq</span> from that icon and come back here to turn it on.
        </div>
      ) : supported === false ? (
        <div className="mt-3 text-sm text-gray-500">This browser doesn&apos;t support push notifications.</div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!subscribed ? (
            <button onClick={enable} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Working…' : '🔔 Turn on for this phone'}
            </button>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-700">✓ On for this device</span>
              <button onClick={sendTest} disabled={busy} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Send test</button>
              <button onClick={disable} disabled={busy} className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">Turn off</button>
            </>
          )}
        </div>
      )}

      {msg && <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">{msg}</div>}
    </div>
  );
}
