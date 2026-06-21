'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  staff_name: string | null;
  staff_email: string;
  day: string; // YYYY-MM-DD
  status: 'PRESENT' | 'ABSENT' | 'OFFDAY' | 'MC' | string;
  check_in_kl: string | null;  // 'HH:MM'
  check_out_kl: string | null; // 'HH:MM'
  late_min: number | null;
  half: 'AM' | 'PM' | null;
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
  const [editDay, setEditDay] = useState<string | null>(null);
  const [eStatus, setEStatus] = useState('WORKING');
  const [eIn, setEIn] = useState('');
  const [eOut, setEOut] = useState('');
  const [eNote, setENote] = useState('');
  const [saving, setSaving] = useState(false);

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
    const by = new Map<string, { name: string; present: number; absent: number; lateDays: number; lateMin: number; mc: number; offday: number; ph: number }>();
    for (const r of rows) {
      const cur = by.get(r.staff_email) ?? { name: r.staff_name ?? r.staff_email, present: 0, absent: 0, lateDays: 0, lateMin: 0, mc: 0, offday: 0, ph: 0 };
      if (r.status === 'PRESENT' || r.status === 'HOME') { cur.present++; if ((r.late_min ?? 0) > 0) { cur.lateDays++; cur.lateMin += r.late_min ?? 0; } }
      else if (r.status === 'ABSENT') cur.absent++;
      else if (r.status === 'MC') cur.mc++;
      else if (r.status === 'OFFDAY') cur.offday++;
      else if (r.status === 'PH') cur.ph++;
      // 'OFF' (Sunday / workshop closed) is intentionally NOT counted here
      by.set(r.staff_email, cur);
    }
    return [...by.entries()].map(([email, v]) => ({ email, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const detail = useMemo(
    () => rows.filter((r) => r.staff_email === staffFilter).sort((a, b) => a.day.localeCompare(b.day)),
    [rows, staffFilter]
  );

  const startEdit = useCallback((r: Row) => {
    setEditDay(r.day);
    setEStatus(r.half === 'AM' ? 'HALF_AM' : r.half === 'PM' ? 'HALF_PM'
      : r.status === 'OFFDAY' ? 'OFFDAY' : r.status === 'MC' ? 'MC' : r.status === 'ABSENT' ? 'ABSENT' : 'WORKING');
    setEIn(r.check_in_kl ?? '');
    setEOut(r.check_out_kl ?? '');
    setENote('');
  }, []);

  const saveEdit = useCallback(async (email: string, day: string) => {
    setSaving(true);
    try {
      if (eStatus === 'HALF_AM' || eStatus === 'HALF_PM') {
        // half day = a shift marker; clear any full-day override so it doesn't hide PRESENT/late
        await supabase.from('day_status').delete().eq('day', day).eq('staff_email', email);
        await supabase.rpc('set_day_half', { p_email: email, p_day: day, p_half: eStatus === 'HALF_PM' ? 'PM' : 'AM', p_note: eNote || null });
      } else {
        // any non-half status removes a half-day marker if one was set
        await supabase.rpc('clear_day_half', { p_email: email, p_day: day });
        if (eStatus === 'WORKING') {
          // no status override -> use real check-ins; optionally override the times
          await supabase.from('day_status').delete().eq('day', day).eq('staff_email', email);
          if (eIn || eOut) {
            await supabase.from('day_time_override').upsert(
              { day, staff_email: email, check_in_kl: eIn || null, check_out_kl: eOut || null, note: eNote || null },
              { onConflict: 'day,staff_email' }
            );
          } else {
            await supabase.from('day_time_override').delete().eq('day', day).eq('staff_email', email);
          }
        } else {
          // OFFDAY / MC / ABSENT
          await supabase.rpc('set_day_status', { p_email: email, p_day: day, p_status: eStatus, p_note: eNote || null });
        }
      }
      await supabase.rpc('attendance_v2_recompute', { p_from: day, p_to: day });
      setEditDay(null);
      await load();
    } finally {
      setSaving(false);
    }
  }, [eStatus, eIn, eOut, eNote, load]);

  const prevMonth = () => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };
  const nextMonth = () => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  const printStaffName = staffFilter === 'ALL' ? 'All staff' : (staffList.find(([e]) => e === staffFilter)?.[1] ?? staffFilter);
  const printedOn = today.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          /* Lock the layout to A4 so a full month always fits one page. */
          @page { size: A4 portrait; margin: 11mm; }
          body { background: #fff; }
          table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          thead th { background: #eef2f7 !important; border-bottom: 1.4px solid #334155; padding: 3px 7px; color: #0f172a;
                     -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          tbody td { border-bottom: 1px solid #e5e7eb; padding: 2.5px 7px; line-height: 1.25; }
          tbody tr:nth-child(even) td { background: #f8fafc !important;
                     -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      ` }} />
      {/* Print-only letterhead (hidden on screen) */}
      <div className="mb-3 hidden print:block">
        <div className="flex items-start justify-between border-b-2 border-slate-800 pb-1.5">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zordaq-auto.png" alt="ZORDAQ Auto Services" className="h-11 w-auto" />
            <div>
              <div className="text-base font-bold tracking-tight text-slate-900">ZORDAQ AUTO SERVICES</div>
              <div className="text-[10px] leading-snug text-slate-500">No. 1, Jalan Industri Putra 1, Presint 14, 62050 Putrajaya</div>
            </div>
          </div>
          <div className="text-right text-[10px] leading-snug text-slate-500">
            <div className="text-[13px] font-semibold text-slate-900">Monthly Attendance Report</div>
            <div>{MONTHS[month - 1]} {year} &middot; {printStaffName}</div>
            <div>Printed {printedOn}</div>
          </div>
        </div>
      </div>

      {/* Controls (not printed) */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
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
        <button onClick={() => window.print()} disabled={rows.length === 0} title="Print or save as PDF" className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          🖨 Print
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
                <th className="px-3 py-2 text-right font-medium text-gray-600">MC</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Off day</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Public holiday</th>
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
                  <td className="px-3 py-2 text-right text-purple-700">{s.mc || '—'}</td>
                  <td className="px-3 py-2 text-right text-blue-700">{s.offday || '—'}</td>
                  <td className="px-3 py-2 text-right text-indigo-700">{s.ph || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400 print:hidden">Tap a staff name to see their daily detail.</div>
        </div>
      ) : (
        /* Per-staff daily detail (editable) */
        <>
        <div className="mb-2 flex items-center gap-2 print:hidden">
          <button onClick={() => setStaffFilter('ALL')} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50">← All staff</button>
          <span className="text-sm font-medium text-gray-900">{staffList.find(([e]) => e === staffFilter)?.[1] ?? staffFilter}</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 font-medium text-gray-600">Date</th>
                <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 font-medium text-gray-600">In</th>
                <th className="px-3 py-2 font-medium text-gray-600">Out</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Late</th>
                <th className="px-3 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {detail.map((r) => (
                <Fragment key={r.day}>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{fmtDay(r.day)}</td>
                    <td className="px-3 py-2">
                      {r.status === 'PRESENT' && <span className="text-emerald-700">Present</span>}
                      {r.status === 'HOME' && <span className="text-emerald-700">Home (WFH)</span>}
                      {r.status === 'ABSENT' && <span className="text-rose-600">Absent</span>}
                      {r.status === 'OFF' && <span className="text-gray-500">Closed</span>}
                      {r.status === 'OFFDAY' && <span className="text-blue-700">Off day</span>}
                      {r.status === 'PH' && <span className="text-indigo-700">Public holiday</span>}
                      {r.status === 'MC' && <span className="text-blue-700">MC</span>}
                      {r.half && <span className="ml-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700" title={r.half === 'AM' ? 'Half day · morning (9:30–1:30)' : 'Half day · afternoon (1:30–6:00)'}>½ {r.half}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{fmt12(r.check_in_kl)}</td>
                    <td className="px-3 py-2 text-gray-700">{fmt12(r.check_out_kl)}</td>
                    <td className={`px-3 py-2 text-right ${(r.late_min ?? 0) > 0 ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                      {(r.late_min ?? 0) > 0 ? `${r.late_min} min` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right print:hidden">
                      <button
                        onClick={() => (editDay === r.day ? setEditDay(null) : startEdit(r))}
                        className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
                      >
                        {editDay === r.day ? 'Close' : 'Edit'}
                      </button>
                    </td>
                  </tr>
                  {editDay === r.day && (
                    <tr className="border-t border-gray-100 bg-gray-50 print:hidden">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="text-xs text-gray-500">Status
                            <select value={eStatus} onChange={(e) => setEStatus(e.target.value)} className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm">
                              <option value="WORKING">Working day</option>
                              <option value="HALF_AM">Half day — morning (9:30–1:30)</option>
                              <option value="HALF_PM">Half day — afternoon (1:30–6:00)</option>
                              <option value="OFFDAY">Off day</option>
                              <option value="MC">Sick leave (MC)</option>
                              <option value="ABSENT">Absent</option>
                            </select>
                          </label>
                          {eStatus === 'WORKING' && (
                            <>
                              <label className="text-xs text-gray-500">Check-in
                                <input type="time" value={eIn} onChange={(e) => setEIn(e.target.value)} className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm" />
                              </label>
                              <label className="text-xs text-gray-500">Check-out
                                <input type="time" value={eOut} onChange={(e) => setEOut(e.target.value)} className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm" />
                              </label>
                            </>
                          )}
                          <label className="text-xs text-gray-500">Note
                            <input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="optional" className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm" />
                          </label>
                          <button
                            onClick={() => saveEdit(r.staff_email, r.day)}
                            disabled={saving}
                            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditDay(null)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                        </div>
                        <div className="mt-2 text-xs text-gray-400">
                          &quot;Working day&quot; clears any off-day/MC and uses real check-ins (with your time edits, if any).
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Print-only footer */}
      <div className="mt-5 hidden border-t border-slate-300 pt-2 text-[10px] text-slate-400 print:block">
        Generated by the ZORDAQ Attendance System &middot; {printedOn}
      </div>
    </div>
  );
}
