'use client';
// Settings → Notifications: owner control for the STAFF-facing bell.
// When on, a staff member sees "approved/rejected" for their own off-day / half-day / MC / advance
// requests in their notification bell. Global (shop-wide), stored on notification_prefs (id=1).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function StaffBellToggle() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('notification_prefs')
      .select('notify_staff_decision').eq('id', 1).single();
    if (data) setOn(!!(data as { notify_staff_decision: boolean }).notify_staff_decision);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const toggle = async () => {
    if (on === null) return;
    const prev = on;
    const next = !on;
    setOn(next);
    const { error } = await supabase.from('notification_prefs')
      .update({ notify_staff_decision: next, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) { setOn(prev); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!isAdmin) return null;   // owner-only control

  return (
    <div className="max-w-2xl">
      <h2 className="text-sm font-semibold text-ink-2">Staff notifications</h2>
      <p className="mt-1 mb-3 text-xs text-ink-3">Controls the notification bell for your staff (not you).</p>
      <div className="flex items-start justify-between gap-3 rounded-card bg-card shadow-card p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">Tell staff when their request is decided</h3>
            {saved && <span className="text-[10px] font-medium text-good">saved ✓</span>}
          </div>
          <p className="mt-1 text-xs text-ink-3">
            When you approve or reject an off-day, half-day, MC, or advance request, the staff member sees the outcome in their own notification bell.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={!!on}
          disabled={on === null}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-good' : 'bg-ink/15'} disabled:opacity-50`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-card shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  );
}
