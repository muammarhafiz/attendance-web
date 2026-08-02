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
  const [me, setMe] = useState('');
  const [requireProof, setRequireProof] = useState(false); // ask the staff to upload proof for this day
  const [docReqs, setDocReqs] = useState<{ id: string; day: string; doc_path: string | null }[]>([]);
  const [paidOverride, setPaidOverride] = useState(false); // editor: "pay anyway" for an OFFDAY/MC day
  const [paidMap, setPaidMap] = useState<Map<string, boolean>>(new Map()); // day -> paid_override for the viewed staff

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      setMe(data.session?.user?.email ?? '');
      if (data.session) {
        const { data: ok } = await supabase.rpc('can_access', { p_feature: 'attendance' });
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

  // Proof requests for the staff being viewed → show status per day + let the manager view uploads.
  const loadDocReqs = useCallback(async () => {
    if (staffFilter === 'ALL') { setDocReqs([]); return; }
    const { data } = await supabase.from('attendance_doc_requests').select('id,day,doc_path').eq('staff_email', staffFilter);
    setDocReqs((data ?? []) as { id: string; day: string; doc_path: string | null }[]);
  }, [staffFilter]);
  useEffect(() => { if (isAdmin) loadDocReqs(); }, [isAdmin, loadDocReqs]);
  const docByDay = useMemo(() => { const m = new Map<string, { id: string; doc_path: string | null }>(); docReqs.forEach((d) => m.set(d.day, d)); return m; }, [docReqs]);

  // paid_override per day for the viewed staff — so the editor can show/preserve the "pay anyway" flag.
  const loadPaid = useCallback(async () => {
    if (staffFilter === 'ALL') { setPaidMap(new Map()); return; }
    const mm = String(month).padStart(2, '0');
    const start = `${year}-${mm}-01`;
    const endD = new Date(year, month, 1);
    const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-01`;
    const { data } = await supabase.from('day_status').select('day,paid_override').eq('staff_email', staffFilter).gte('day', start).lt('day', end);
    const m = new Map<string, boolean>();
    (data ?? []).forEach((d: { day: string; paid_override: boolean | null }) => m.set(d.day, !!d.paid_override));
    setPaidMap(m);
  }, [staffFilter, year, month]);
  useEffect(() => { if (isAdmin) loadPaid(); }, [isAdmin, loadPaid]);
  const viewDoc = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from('mc').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, []);

  // Deep-link from the month-end fix-absent card: /attendance/report?staff=<email> preselects that staff.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('staff');
    if (s) setStaffFilter(s);
  }, []);

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
    setRequireProof(false);
    setPaidOverride(paidMap.get(r.day) ?? false);
  }, [paidMap]);

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
          // For leave days, carry the "pay anyway" flag so an over-quota day isn't docked as unpaid.
          if (eStatus === 'OFFDAY' || eStatus === 'MC') {
            await supabase.rpc('set_day_pay', { p_email: email, p_day: day, p_paid: paidOverride });
          }
        }
      }
      await supabase.rpc('attendance_v2_recompute', { p_from: day, p_to: day });
      if (requireProof && eStatus !== 'WORKING') {
        const label = eStatus === 'HALF_AM' || eStatus === 'HALF_PM' ? 'HALF' : eStatus;
        await supabase.from('attendance_doc_requests').insert({ staff_email: email, day, label, note: eNote || null, required_by: me || null });
      }
      setRequireProof(false);
      setEditDay(null);
      await load();
      await loadDocReqs();
      await loadPaid();
    } finally {
      setSaving(false);
    }
  }, [eStatus, eIn, eOut, eNote, requireProof, paidOverride, me, load, loadDocReqs, loadPaid]);

  const prevMonth = () => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };
  const nextMonth = () => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-3">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

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
              <div className="text-base font-bold tracking-tight text-ink">ZORDAQ AUTO SERVICES</div>
              <div className="text-[10px] leading-snug text-ink-2">No. 1, Jalan Industri Putra 1, Presint 14, 62050 Putrajaya</div>
            </div>
          </div>
          <div className="text-right text-[10px] leading-snug text-ink-2">
            <div className="text-[13px] font-semibold text-ink">Monthly Attendance Report</div>
            <div>{MONTHS[month - 1]} {year} &middot; {printStaffName}</div>
            <div>Printed {printedOn}</div>
          </div>
        </div>
      </div>

      {/* Controls (not printed) */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={prevMonth} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">◀</button>
        <span className="min-w-[110px] text-center text-sm font-semibold text-ink">{MONTHS[month - 1]} {year}</span>
        <button onClick={nextMonth} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">▶</button>

        <select
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
          className="ml-2 rounded-lg border border-line px-2 py-1 text-sm"
        >
          <option value="ALL">All staff (summary)</option>
          {staffList.map(([email, name]) => (
            <option key={email} value={email}>{name}</option>
          ))}
        </select>

        <button onClick={load} disabled={loading} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button onClick={() => window.print()} disabled={rows.length === 0} title="Print or save as PDF" className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-ink/5 disabled:opacity-50">
          Print
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-ink/[0.03] p-4 text-center text-sm text-ink-3">No records for this month.</div>
      ) : staffFilter === 'ALL' ? (
        /* Summary table */
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-medium text-ink-2">Staff</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Present</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Absent</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Late days</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Total late</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">MC</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Off day</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Public holiday</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.email} className="border-t border-line hover:bg-ink/[0.03]">
                  <td className="px-3 py-2">
                    <button onClick={() => setStaffFilter(s.email)} className="text-left text-ink hover:text-accent hover:underline">{s.name}</button>
                  </td>
                  <td className="px-3 py-2 text-right text-good">{s.present}</td>
                  <td className="px-3 py-2 text-right text-bad">{s.absent || '—'}</td>
                  <td className="px-3 py-2 text-right text-warn">{s.lateDays || '—'}</td>
                  <td className="px-3 py-2 text-right text-warn">{s.lateMin ? `${s.lateMin} min` : '—'}</td>
                  <td className="px-3 py-2 text-right text-accent">{s.mc || '—'}</td>
                  <td className="px-3 py-2 text-right text-accent">{s.offday || '—'}</td>
                  <td className="px-3 py-2 text-right text-accent">{s.ph || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line px-3 py-2 text-xs text-ink-3 print:hidden">Tap a staff name to see their daily detail.</div>
        </div>
      ) : (
        /* Per-staff daily detail (editable) */
        <>
        <div className="mb-2 flex items-center gap-2 print:hidden">
          <button onClick={() => setStaffFilter('ALL')} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">← All staff</button>
          <span className="text-sm font-medium text-ink">{staffList.find(([e]) => e === staffFilter)?.[1] ?? staffFilter}</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-medium text-ink-2">Date</th>
                <th className="px-3 py-2 font-medium text-ink-2">Status</th>
                <th className="px-3 py-2 font-medium text-ink-2">In</th>
                <th className="px-3 py-2 font-medium text-ink-2">Out</th>
                <th className="px-3 py-2 text-right font-medium text-ink-2">Late</th>
                <th className="px-3 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {detail.map((r) => (
                <Fragment key={r.day}>
                  <tr className="border-t border-line">
                    <td className="px-3 py-2 text-ink-2">{fmtDay(r.day)}</td>
                    <td className="px-3 py-2">
                      {r.status === 'PRESENT' && <span className="text-good">Present</span>}
                      {r.status === 'HOME' && <span className="text-good">Home (WFH)</span>}
                      {r.status === 'ABSENT' && <span className="text-bad">Absent</span>}
                      {r.status === 'OFF' && <span className="text-ink-2">Closed</span>}
                      {r.status === 'OFFDAY' && <span className="text-accent">Off day</span>}
                      {r.status === 'PH' && <span className="text-accent">Public holiday</span>}
                      {r.status === 'MC' && <span className="text-accent">MC</span>}
                      {r.half && <span className="ml-1 rounded-full bg-accent-weak px-1.5 py-0.5 text-xs font-medium text-accent" title={r.half === 'AM' ? 'Half day · morning (9:30–1:30)' : 'Half day · afternoon (1:30–6:00)'}>½ {r.half}</span>}
                      {(r.status === 'OFFDAY' || r.status === 'MC') && paidMap.get(r.day) && <span className="ml-1 rounded-full bg-good-soft px-1.5 py-0.5 text-xs font-medium text-good" title="Paid anyway — not docked as unpaid">paid</span>}
                      {docByDay.get(r.day) && (docByDay.get(r.day)!.doc_path
                        ? <button onClick={() => viewDoc(docByDay.get(r.day)!.doc_path)} className="ml-1 rounded-full bg-good-soft px-1.5 py-0.5 text-xs font-medium text-good hover:opacity-80 print:hidden">proof ✓</button>
                        : <span className="ml-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn print:hidden">proof pending</span>)}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{fmt12(r.check_in_kl)}</td>
                    <td className="px-3 py-2 text-ink-2">{fmt12(r.check_out_kl)}</td>
                    <td className={`px-3 py-2 text-right ${(r.late_min ?? 0) > 0 ? 'font-semibold text-bad' : 'text-ink-3'}`}>
                      {(r.late_min ?? 0) > 0 ? `${r.late_min} min` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right print:hidden">
                      <button
                        onClick={() => (editDay === r.day ? setEditDay(null) : startEdit(r))}
                        className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5"
                      >
                        {editDay === r.day ? 'Close' : 'Edit'}
                      </button>
                    </td>
                  </tr>
                  {editDay === r.day && (
                    <tr className="border-t border-line bg-ink/[0.03] print:hidden">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="text-xs text-ink-2">Status
                            <select value={eStatus} onChange={(e) => setEStatus(e.target.value)} className="mt-0.5 block rounded-lg border border-line px-2 py-1 text-sm">
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
                              <label className="text-xs text-ink-2">Check-in
                                <input type="time" value={eIn} onChange={(e) => setEIn(e.target.value)} className="mt-0.5 block rounded-lg border border-line px-2 py-1 text-sm" />
                              </label>
                              <label className="text-xs text-ink-2">Check-out
                                <input type="time" value={eOut} onChange={(e) => setEOut(e.target.value)} className="mt-0.5 block rounded-lg border border-line px-2 py-1 text-sm" />
                              </label>
                            </>
                          )}
                          <label className="text-xs text-ink-2">Note
                            <input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="optional" className="mt-0.5 block rounded-lg border border-line px-2 py-1 text-sm" />
                          </label>
                          {eStatus !== 'WORKING' && (
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
                              <input type="checkbox" checked={requireProof} onChange={(e) => setRequireProof(e.target.checked)} className="h-3.5 w-3.5" /> Require proof from staff
                            </label>
                          )}
                          {(eStatus === 'OFFDAY' || eStatus === 'MC') && (
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2" title="Pay this day even if the staff is over their leave quota (don't dock it as unpaid).">
                              <input type="checkbox" checked={paidOverride} onChange={(e) => setPaidOverride(e.target.checked)} className="h-3.5 w-3.5" /> Pay anyway (don&apos;t dock)
                            </label>
                          )}
                          <button
                            onClick={() => saveEdit(r.staff_email, r.day)}
                            disabled={saving}
                            className="rounded-lg bg-btn px-3 py-1.5 text-sm font-semibold text-btn-ink hover:opacity-90 disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditDay(null)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">Cancel</button>
                        </div>
                        <div className="mt-2 text-xs text-ink-3">
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
      <div className="mt-5 hidden border-t border-line pt-2 text-[10px] text-ink-3 print:block">
        Generated by the ZORDAQ Attendance System &middot; {printedOn}
      </div>
    </div>
  );
}
