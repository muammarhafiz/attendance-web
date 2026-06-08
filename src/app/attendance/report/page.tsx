'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  staff_name: string | null;
  staff_email: string;
  day: string; // YYYY-MM-DD
  status: 'PRESENT' | 'ABSENT' | 'OFFDAY' | 'MC' | string;
  check_in_kl: string | null;  // 'HH:MM'
  check_out_kl: string | null; // 'HH:MM'
  late_min: number | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt12(t: string | null): string {
  if (!t) return '—';
  const [hh, mm] = t.split(':');
  let h = Number(hh);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}
function fmtDay(d: string): string {
  const [, m, dd] = d.split('-');
  return `${dd}/${m}`;
}

export default function AttendanceReportPage() {
  const today = useMemo(() => new Date(), []);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    const { data, error } = await supabase.rpc('month_attendance_v2_daily', { p_year: year, p_month: month });
    if (!error) setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const staffList = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.staff_email, r.staff_name ?? r.staff_email));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // per-staff summary
  const summary = useMemo(() => {
    const by = new Map<string, { name: string; present: number; absent: number; lateDays: number; lateMin: number; off: number }>();
    for (const r of rows) {
      const cur = by.get(r.staff_email) ?? { name: r.staff_name ?? r.staff_email, present: 0, absent: 0, lateDays: 0, lateMin: 0, off: 0 };
      if (r.status === 'PRESENT') { cur.present++; if ((r.late_min ?? 0) > 0) { cur.lateDays++; cur.lateMin += r.late_min ?? 0; } }
      else if (r.status === 'ABSENT') cur.absent++;
      else if (r.status === 'OFFDAY' || r.status === 'MC' || r.status === 'OFF') cur.off++;
      by.set(r.staff_email, cur);
    }
    return [...by.entries()].map(([email, v]) => ({ email, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const detail = useMemo(
    () => rows.filter((r) => r.staff_email === staffFilter).sort((a, b) => a.day.localeCompare(b.day)),
    [rows, staffFilter]
  );

  const prevMonth = () => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };
  const nextMonth = () => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={prevMonth} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50">◀</button>
        <span className="min-w-[110px] text-center text-sm font-semibold text-gray-900">{MONTHS[month - 1]} {year}</span>
        <button onClick={nextMonth} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50">▶</button>

        <select
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
          className="ml-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="ALL">All staff (summary)</option>
          {staffList.map(([email, name]) => (
            <option key={email} value={email}>{name}</option>
          ))}
        </select>

        <button onClick={load} disabled={loading} className="ml-auto rounded-md border border-gray-300 px-2.5 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">No records for this month.</div>
      ) : staffFilter === 'ALL' ? (
        /* Summary table */
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 font-medium text-gray-600">Staff</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Present</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Absent</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Late days</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Total late</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Off / MC</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.email} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <button onClick={() => setStaffFilter(s.email)} className="text-left text-gray-900 hover:text-blue-600 hover:underline">{s.name}</button>
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-700">{s.present}</td>
                  <td className="px-3 py-2 text-right text-rose-600">{s.absent || '—'}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{s.lateDays || '—'}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{s.lateMin ? `${s.lateMin} min` : '—'}</td>
                  <td className="px-3 py-2 text-right text-blue-700">{s.off || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">Tap a staff name to see their daily detail.</div>
        </div>
      ) : (
        /* Per-staff daily detail */
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 font-medium text-gray-600">Date</th>
                <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 font-medium text-gray-600">In</th>
                <th className="px-3 py-2 font-medium text-gray-600">Out</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Late</th>
              </tr>
            </thead>
            <tbody>
              {detail.map((r) => (
                <tr key={r.day} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700">{fmtDay(r.day)}</td>
                  <td className="px-3 py-2">
                    {r.status === 'PRESENT' && <span className="text-emerald-700">Present</span>}
                    {r.status === 'ABSENT' && <span className="text-rose-600">Absent</span>}
                    {r.status === 'OFF' && <span className="text-gray-500">Closed (Sun)</span>}
                    {r.status === 'OFFDAY' && <span className="text-blue-700">Off day</span>}
                    {r.status === 'MC' && <span className="text-blue-700">MC</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{fmt12(r.check_in_kl)}</td>
                  <td className="px-3 py-2 text-gray-700">{fmt12(r.check_out_kl)}</td>
                  <td className={`px-3 py-2 text-right ${(r.late_min ?? 0) > 0 ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                    {(r.late_min ?? 0) > 0 ? `${r.late_min} min` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
