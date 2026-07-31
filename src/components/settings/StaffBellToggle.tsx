'use client';
// Settings → Notifications: owner-only, shop-wide notification switches.
// Stored on notification_prefs (single row id=1). Admin-only (RLS + this gate).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type PrefKey = 'notify_staff_decision' | 'notify_staff_uploads' | 'notify_holiday_reminders';
const TOGGLES: { key: PrefKey; title: string; desc: string }[] = [
  {
    key: 'notify_staff_decision',
    title: 'Tell staff when their request is decided',
    desc: 'When you approve or reject an off-day, half-day, MC, or advance request, the staff member sees the outcome in their own notification bell.',
  },
  {
    key: 'notify_staff_uploads',
    title: 'Remind staff to upload documents',
    desc: 'A bell reminder for a staff member when they have a pending MC certificate or requested proof they haven’t uploaded yet.',
  },
  {
    key: 'notify_holiday_reminders',
    title: 'Remind me about public holidays',
    desc: 'A bell reminder about 30 days before each public holiday (to set Open / Close / Swap), and — from October — when next year’s dates still need loading.',
  },
];

export default function StaffBellToggle() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean> | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notification_prefs')
      .select('notify_staff_decision,notify_staff_uploads,notify_holiday_reminders').eq('id', 1).single();
    if (data) setPrefs(data as Record<PrefKey, boolean>);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const toggle = async (key: PrefKey) => {
    if (!prefs) return;
    const prev = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const { error } = await supabase.from('notification_prefs')
      .update({ [key]: next[key], updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) { setPrefs(prev); return; }
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
  };

  if (!isAdmin) return null; // owner-only controls

  return (
    <div className="max-w-2xl">
      <h2 className="text-sm font-semibold text-ink-2">Owner notifications</h2>
      <p className="mt-1 mb-3 text-xs text-ink-3">Shop-wide reminders and staff-facing alerts.</p>
      <div className="space-y-3">
        {TOGGLES.map((t) => {
          const on = !!prefs?.[t.key];
          return (
            <div key={t.key} className="flex items-start justify-between gap-3 rounded-card bg-card shadow-card p-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink">{t.title}</h3>
                  {savedKey === t.key && <span className="text-[10px] font-medium text-good">saved ✓</span>}
                </div>
                <p className="mt-1 text-xs text-ink-3">{t.desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={on}
                disabled={!prefs}
                onClick={() => toggle(t.key)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-good' : 'bg-ink/15'} disabled:opacity-50`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-card shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
