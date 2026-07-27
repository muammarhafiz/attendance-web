'use client';
// Notification preferences: per-type on/off for what gets pushed to this person's phone. Owner sees all
// alert types; Manager/Office see the ones they receive (currently "Purchase invoice created").
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Pref = { type: string; enabled: boolean };

const TYPE_LABEL: Record<string, string> = {
  mc: 'MC requests',
  offday: 'Off-day requests',
  halfday: 'Half-day requests',
  advance: 'Salary advance requests',
  po: 'Purchase orders to approve',
  pinv: 'Purchase invoices to review',
  pinv_created: 'Purchase invoice created',
  stuckcar: 'Cars stuck in shop',
  debt: 'Newly overdue bills',
  lowstock: 'Items to restock',
};

function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function NotificationPrefs() {
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('my_notification_prefs');
      setPrefs(Array.isArray(data) ? (data as Pref[]) : []);
    })();
  }, []);

  const toggle = useCallback(async (type: string, enabled: boolean) => {
    setBusy(true);
    setPrefs((prev) => (prev ? prev.map((p) => (p.type === type ? { ...p, enabled } : p)) : prev));
    const { error } = await supabase.rpc('set_notification_pref', { p_type: type, p_enabled: enabled });
    if (error) setPrefs((prev) => (prev ? prev.map((p) => (p.type === type ? { ...p, enabled: !enabled } : p)) : prev));
    setBusy(false);
  }, []);

  if (prefs === null || prefs.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Which alerts push to your phone</h2>
      <p className="mt-1 text-xs text-gray-500">Turn off any alert you don&rsquo;t want as a phone notification. (It still appears in the in-app bell.)</p>
      <ul className="mt-3 divide-y divide-gray-50">
        {prefs.map((p) => (
          <li key={p.type} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-gray-700">{TYPE_LABEL[p.type] ?? p.type}</span>
            <Switch on={p.enabled} disabled={busy} onChange={(v) => toggle(p.type, v)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
