// src/components/settings/AttendanceSettings.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Staff = { email: string; name: string | null; work_start_time: string | null; weekly_schedule: Record<string, string> | null };

const DOW = [
  { key: '1', label: 'Mon' }, { key: '2', label: 'Tue' }, { key: '3', label: 'Wed' },
  { key: '4', label: 'Thu' }, { key: '5', label: 'Fri' }, { key: '6', label: 'Sat' },
  { key: '0', label: 'Sun' },
];
const DEFAULT_SCHED: Record<string, string> = { '0': 'off', '1': 'workshop', '2': 'workshop', '3': 'workshop', '4': 'workshop', '5': 'workshop', '6': 'workshop' };
const nextMode = (m: string) => (m === 'workshop' ? 'home' : m === 'home' ? 'off' : 'workshop');
const modeStyle = (m: string) =>
  m === 'workshop' ? 'bg-blue-100 text-blue-700' : m === 'home' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400';

const isoToday = () => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
};
const firstOfMonth = () => isoToday().slice(0, 8) + '01';

export default function AttendanceSettings() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('email,name,work_start_time,weekly_schedule')
      .is('archived_at', null)
      .order('name');
    setStaff((data ?? []) as Staff[]);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const saveTime = useCallback(async (email: string, value: string) => {
    if (!value) return;
    setSavingEmail(email);
    setMsg(null);
    setStaff((prev) => prev.map((s) => (s.email === email ? { ...s, work_start_time: value } : s)));
    const { error } = await supabase.from('staff').update({ work_start_time: value }).eq('email', email);
    if (error) {
      setMsg(`Save failed: ${error.message}`);
    } else {
      // recompute this month so today's late + status update immediately
      await supabase.rpc('attendance_v2_recompute', { p_from: firstOfMonth(), p_to: isoToday() });
      setMsg('Saved ✓');
      setTimeout(() => setMsg(null), 2500);
    }
    setSavingEmail(null);
  }, []);

  const cycleDay = useCallback(async (email: string, dowKey: string) => {
    // compute the new schedule up-front (NOT inside the setState updater)
    const target = staff.find((s) => s.email === email);
    const cur = { ...DEFAULT_SCHED, ...(target?.weekly_schedule || {}) };
    cur[dowKey] = nextMode(cur[dowKey] || 'workshop');

    setSavingEmail(email);
    setMsg(null);
    setStaff((prev) => prev.map((s) => (s.email === email ? { ...s, weekly_schedule: cur } : s)));

    const { error } = await supabase.from('staff').update({ weekly_schedule: cur }).eq('email', email);
    if (error) setMsg(`Save failed: ${error.message}`);
    else {
      await supabase.rpc('attendance_v2_recompute', { p_from: firstOfMonth(), p_to: isoToday() });
      setMsg('Saved ✓');
      setTimeout(() => setMsg(null), 2000);
    }
    setSavingEmail(null);
  }, [staff]);

  const recomputeAll = useCallback(async () => {
    setRecomputing(true);
    setMsg('Recomputing all history…');
    const { error } = await supabase.rpc('attendance_v2_recompute', { p_from: '2025-09-01', p_to: isoToday() });
    setMsg(error ? `Failed: ${error.message}` : 'All history recomputed ✓');
    setRecomputing(false);
    setTimeout(() => setMsg(null), 3000);
  }, []);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div className="max-w-xl">
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-800">Shifts &amp; weekly schedule per employee</div>
        <div className="mt-0.5 text-xs text-gray-400">
          <b>Start time</b>: &quot;Late&quot; counts from here; &quot;Absent&quot; shows 1 hour after it (9:30→10:30, 12:30→13:30).<br />
          <b>Weekly schedule</b>: tap a day to switch Workshop → Home → Off. Workshop = GPS check-in; Home = auto-present (no check-in); Off = rest day.
          Changes apply to this month immediately.
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 font-medium text-gray-600">Employee</th>
              <th className="px-3 py-2 font-medium text-gray-600">Start</th>
              <th className="px-3 py-2 font-medium text-gray-600">Weekly schedule (tap a day)</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const sched = { ...DEFAULT_SCHED, ...(s.weekly_schedule || {}) };
              return (
                <tr key={s.email} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-3 py-2 align-top text-gray-900">
                    {s.name ?? s.email}
                    {savingEmail === s.email && <span className="ml-1 text-xs text-gray-400">saving…</span>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="time"
                      value={(s.work_start_time ?? '09:30').slice(0, 5)}
                      onChange={(e) => saveTime(s.email, e.target.value)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {DOW.map((d) => {
                        const mode = sched[d.key] || 'workshop';
                        return (
                          <button
                            key={d.key}
                            onClick={() => cycleDay(s.email, d.key)}
                            title={`${d.label}: ${mode}`}
                            className={`w-11 rounded px-1 py-1 text-xs font-medium ${modeStyle(mode)}`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">No staff found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-blue-100 align-middle" />Workshop (GPS)</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-emerald-100 align-middle" />Home (auto-present)</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-gray-100 align-middle" />Off</span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={recomputeAll}
          disabled={recomputing}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {recomputing ? 'Recomputing…' : 'Recompute all history'}
        </button>
        <span className="text-xs text-gray-400">Use after changing a shift, to fix past months&apos; late numbers.</span>
      </div>

      {msg && <div className="mt-3 text-sm text-emerald-700">{msg}</div>}
    </div>
  );
}
