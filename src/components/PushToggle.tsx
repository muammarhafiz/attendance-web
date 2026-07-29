'use client';
// Phone-notification control for THIS device + a list of all your registered devices (so you can remove
// stale ones — the usual cause of "I don't get notifications"). Reusable on Settings and the Office page.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Device = { endpoint: string; host: string; ua: string | null; created: string };

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(ua: string | null, host: string): string {
  const u = (ua || '').toLowerCase();
  const os = /iphone/.test(u) ? 'iPhone' : /ipad/.test(u) ? 'iPad' : /android/.test(u) ? 'Android'
    : /mac/.test(u) ? 'Mac' : /windows/.test(u) ? 'Windows' : /linux/.test(u) ? 'Linux' : 'Device';
  const br = /crios/.test(u) ? 'Chrome' : /fxios|firefox/.test(u) ? 'Firefox' : /edg/.test(u) ? 'Edge'
    : /chrome/.test(u) ? 'Chrome' : /safari/.test(u) ? 'Safari' : host.includes('apple') ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
const fmtWhen = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }); } catch { return ''; } };

export default function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);

  const loadDevices = useCallback(async () => {
    const { data } = await supabase.rpc('my_push_devices');
    setDevices(Array.isArray(data) ? (data as Device[]) : []);
  }, []);

  const refresh = useCallback(async () => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) {
      const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = typeof window !== 'undefined' &&
        (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
      if (isIOS && !standalone) setNeedsInstall(true);
      await loadDevices();
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
      setCurrentEndpoint(sub?.endpoint ?? null);
    } catch { /* ignore */ }
    await loadDevices();
  }, [loadDevices]);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setMsg('Permission was blocked. Allow notifications for this site in your phone settings, then try again.'); setBusy(false); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { data: pub, error: kErr } = await supabase.rpc('push_public_key');
      if (kErr || !pub) { setMsg('Could not load the push key. Try again in a moment.'); setBusy(false); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pub as string) as unknown as BufferSource });
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const { error } = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent });
      if (error) { setMsg(error.message); setBusy(false); return; }
      setSubscribed(true); setCurrentEndpoint(j.endpoint ?? null);
      setMsg('✓ On for this phone. Tap "Send test" to check it arrives.');
      await loadDevices();
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Could not turn on notifications.');
    }
    setBusy(false);
  }, [loadDevices]);

  const disable = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setSubscribed(false); setCurrentEndpoint(null);
      setMsg('Off for this phone.');
      await loadDevices();
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Could not turn off notifications.');
    }
    setBusy(false);
  }, [loadDevices]);

  const removeDevice = useCallback(async (ep: string) => {
    setBusy(true); setMsg(null);
    try {
      await supabase.rpc('push_unsubscribe', { p_endpoint: ep });
      if (ep === currentEndpoint) {
        try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); await sub?.unsubscribe(); } catch { /* ignore */ }
        setSubscribed(false); setCurrentEndpoint(null);
      }
      await loadDevices();
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Could not remove that device.');
    }
    setBusy(false);
  }, [currentEndpoint, loadDevices]);

  const sendTest = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/push/test', { method: 'POST', headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(body?.error || 'Test failed.'); setBusy(false); return; }
      setMsg(body?.sent > 0 ? '✓ Test sent — check your phone now.' : 'Sent, but no device received it. Tap Turn off, then Turn on, and test again.');
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Test failed.');
    }
    setBusy(false);
  }, []);

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-sm font-semibold text-ink">🔔 Phone notifications</h2>
      <p className="mt-1 text-xs text-ink-2">Get a push on this phone when there&rsquo;s a new alert — even when the app is closed. Turn it on once on each phone you use.</p>

      {/* This device */}
      {needsInstall ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-medium">On iPhone/iPad:</span> tap the <span className="font-medium">Share</span> button →
          <span className="font-medium"> Add to Home Screen</span>, then open <span className="font-medium">Zordaq</span> from that icon and come back here to turn it on.
        </div>
      ) : supported === false ? (
        <div className="mt-3 text-sm text-ink-2">This browser doesn&apos;t support push notifications.</div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!subscribed ? (
            <button onClick={enable} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Working…' : '🔔 Turn on for this phone'}
            </button>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-700">✓ On for this phone</span>
              <button onClick={sendTest} disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-2 hover:bg-ink/5 disabled:opacity-50">Send test</button>
              <button onClick={disable} disabled={busy} className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">Turn off</button>
            </>
          )}
        </div>
      )}

      {msg && <div className="mt-3 rounded-lg border border-line bg-ink/5 px-3 py-2 text-xs text-ink-2">{msg}</div>}

      {/* All registered devices */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Phones getting your notifications</div>
        {devices.length === 0 ? (
          <p className="text-sm text-ink-2">None yet — turn it on above.</p>
        ) : (
          <ul className="divide-y divide-line">
            {devices.map((dv) => (
              <li key={dv.endpoint} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="text-ink-2">{deviceLabel(dv.ua, dv.host)}</span>
                  {dv.endpoint === currentEndpoint && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">this phone</span>}
                  <span className="ml-1.5 text-[11px] text-ink-3">added {fmtWhen(dv.created)}</span>
                </div>
                <button onClick={() => removeDevice(dv.endpoint)} disabled={busy} className="shrink-0 text-xs text-ink-3 hover:text-rose-600 disabled:opacity-50">Remove</button>
              </li>
            ))}
          </ul>
        )}
        {devices.length > 1 && <p className="mt-1.5 text-[11px] text-ink-3">Not getting pushes on a phone? Remove old entries here, then Turn off &amp; on again on that phone.</p>}
      </div>
    </div>
  );
}
