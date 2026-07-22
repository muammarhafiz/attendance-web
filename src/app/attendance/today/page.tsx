'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

type Row = {
  display_name: string | null;
  staff_email: string;
  day: string;
  status: 'PRESENT' | 'ABSENT' | 'OFFDAY' | 'MC' | string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
  half: 'AM' | 'PM' | null;
};

function fmtTime(t: string | null | undefined): string {
  if (!t) return '—';
  const [hh, mm] = t.split(':');
  let h = Number(hh);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}

// current KL time as minutes-since-midnight (correct TZ handling)
function klNowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

const DEFAULT_START_MIN = 9 * 60 + 30; // 09:30 default start
const PM_HALF_START_MIN = 13 * 60 + 30; // afternoon half-day expects 1:30pm
const GRACE_MIN = 60; // "Absent" shows 1 hour after each person's start

export default function AttendanceTodayPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<string>('');
  const [startByEmail, setStartByEmail] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) {
        const { data: ok } = await supabase.rpc('can_access', { p_feature: 'attendance' });
        setIsAdmin(ok === true);
      } else {
        setIsAdmin(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('attendance_today_v2');
    if (!error) {
      setRows((data ?? []) as Row[]);
      setUpdated(
        new Intl.DateTimeFormat('en-MY', {
          timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: true,
        }).format(new Date())
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  useVisibleInterval(load, 30000, isAdmin);

  // per-staff start times (for the per-person "Absent" cutoff = start + 1h)
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('staff').select('email,work_start_time').then(({ data }) => {
      const m = new Map<string, number>();
      (data ?? []).forEach((s: { email: string; work_start_time: string | null }) => {
        const t = (s.work_start_time ?? '09:30:00').split(':');
        m.set(s.email, Number(t[0]) * 60 + Number(t[1]));
      });
      setStartByEmail(m);
    });
  }, [isAdmin]);

  // Expected start (minutes) — an afternoon half-day expects 1:30pm, else the staff's normal start.
  const expStartFor = useCallback(
    (r: Row) => (r.half === 'PM' ? PM_HALF_START_MIN : (startByEmail.get(r.staff_email) ?? DEFAULT_START_MIN)),
    [startByEmail]
  );
  // "Absent" only shows 1 hour after the expected start (so an afternoon half-day isn't flagged in the morning).
  const cutoffFor = useCallback((r: Row) => expStartFor(r) + GRACE_MIN, [expStartFor]);

  const counts = useMemo(() => {
    const nowMin = klNowMinutes();
    let present = 0, absent = 0, late = 0, off = 0, notYet = 0;
    for (const r of rows) {
      if (r.status === 'OFFDAY' || r.status === 'MC' || r.status === 'OFF' || r.status === 'PH') off++;
      else if (r.status === 'PRESENT' || r.status === 'HOME') {
        present++;
        if ((r.late_min ?? 0) > 0) late++;
      } else if (r.status === 'ABSENT') {
        if (nowMin >= cutoffFor(r)) absent++;
        else notYet++;
      }
    }
    return { present, absent, late, off, notYet };
  }, [rows, cutoffFor]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">You don&apos;t have access to this page.</div>;

  return (
    <div>
      {/* Summary */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Present', value: counts.present, cls: 'text-emerald-700' },
          { label: 'Late', value: counts.late, cls: 'text-amber-700' },
          { label: 'Not in yet', value: counts.notYet, cls: 'text-gray-500' },
          { label: 'Absent', value: counts.absent, cls: 'text-rose-700' },
          { label: 'Off / MC', value: counts.off, cls: 'text-blue-700' },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <div className={`text-2xl font-bold ${c.cls}`}>{c.value}</div>
            <div className="text-xs text-gray-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">Updated {updated || '…'} · auto-refreshes</span>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 font-medium text-gray-600">Name</th>
              <th className="px-3 py-2 font-medium text-gray-600">Status</th>
              <th className="px-3 py-2 font-medium text-gray-600">Check-in</th>
              <th className="px-3 py-2 font-medium text-gray-600">Check-out</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Late</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isAbsent = r.status === 'ABSENT';
              const nowMin = klNowMinutes();
              const showAbsent = isAbsent && nowMin >= cutoffFor(r);
              const showNotYet = isAbsent && nowMin < cutoffFor(r);
              const isLate = r.status === 'PRESENT' && (r.late_min ?? 0) > 0;
              const halfLabel = r.half === 'AM' ? 'Half day · AM (9:30–1:30)' : r.half === 'PM' ? 'Half day · PM (1:30–6:00)' : null;
              return (
                <tr key={r.staff_email} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-900">{r.display_name ?? r.staff_email}</td>
                  <td className="px-3 py-2">
                    {r.status === 'PRESENT' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Present</span>}
                    {r.status === 'HOME' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Home</span>}
                    {r.status === 'OFF' && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Closed</span>}
                    {r.status === 'PH' && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Public holiday</span>}
                    {(r.status === 'OFFDAY' || r.status === 'MC') && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{r.status === 'OFFDAY' ? 'Off day' : 'MC'}</span>}
                    {showAbsent && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">Absent</span>}
                    {showNotYet && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Not in yet</span>}
                    {halfLabel && <span className="ml-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700" title={halfLabel}>½ {r.half}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{fmtTime(r.check_in_kl)}</td>
                  <td className="px-3 py-2 text-gray-700">{fmtTime(r.check_out_kl)}</td>
                  <td className={`px-3 py-2 text-right ${isLate ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                    {(r.late_min ?? 0) > 0 ? `${r.late_min} min` : '—'}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-500">
                  No check-ins recorded today yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
