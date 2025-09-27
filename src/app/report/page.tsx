'use client';
export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Row = {
  email: string;
  staff_name: string;
  day: string;                 // 'YYYY-MM-DD'
  first_in_utc: string | null; // ISO or null
  last_out_utc: string | null; // ISO or null
  late_minutes: number;
  absent: boolean;
};

const th: React.CSSProperties = { textAlign:'left', padding:'10px', borderBottom:'1px solid #e5e5e5' };
const td: React.CSSProperties = { padding:'10px', borderBottom:'1px solid #f0f0f0' };

export default function ReportPageWrapper() {
  return (
    <Suspense fallback={<div style={{padding:16,fontFamily:'system-ui'}}>Loading…</div>}>
      <ReportPageInner />
    </Suspense>
  );
}

function getInt(v: string | null, fallback: number) {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate(); // month1to12 = 1..12
}

function ReportPageInner() {
  const params = useSearchParams();
  const router = useRouter();

  // Read query: ?year=YYYY&month=MM&day=DD (day optional)
  const now = new Date();
  const qYear = getInt(params.get('year'), now.getFullYear());
  const qMonth = getInt(params.get('month'), now.getMonth() + 1); // 1..12
  const qDay = params.get('day'); // optional, '01'..'31' or null

  // Build p_month (YYYY-MM-01) for the RPC month_attendance(p_month date)
  const pMonthISO = useMemo(() => {
    const y = qYear;
    const m = String(qMonth).padStart(2, '0');
    return `${y}-${m}-01`;
  }, [qYear, qMonth]);

  const ymLabel = useMemo(() => `${qYear}-${String(qMonth).padStart(2, '0')}`, [qYear, qMonth]);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase.rpc('month_attendance', { p_month: pMonthISO });
      if (error) setErr(error.message);
      else setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, [pMonthISO]);

  // Optional per-day client filter
  const filteredByDay: Row[] = useMemo(() => {
    if (!qDay) return rows;
    const d = String(qDay).padStart(2, '0');
    const target = `${qYear}-${String(qMonth).padStart(2, '0')}-${d}`;
    return rows.filter(r => r.day === target);
  }, [rows, qYear, qMonth, qDay]);

  // Group by staff for rendering
  const byStaff = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filteredByDay) {
      const k = `${r.staff_name}:::${r.email}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const out = Array.from(map.entries()).map(([k, arr]) => {
      arr.sort((a, b) => a.day.localeCompare(b.day));
      const [name, email] = k.split(':::');
      const absentDays = arr.filter(x => x.absent).length;
      const lateTotal = arr.reduce((s, x) => s + (x.late_minutes || 0), 0);
      return { name, email, rows: arr, absentDays, lateTotal };
    });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [filteredByDay]);

  // Controls
  const years = useMemo(() => {
    const cur = now.getFullYear();
    const list: number[] = [];
    for (let y = cur - 5; y <= cur + 1; y++) list.push(y);
    return list;
  }, [now]);

  const totalDays = daysInMonth(qYear, qMonth);
  const dayOptions = Array.from({ length: totalDays }, (_, i) => String(i + 1).padStart(2, '0'));

  function setQuery(next: { year?: number; month?: number; day?: string | null }) {
    const y = next.year ?? qYear;
    const m = next.month ?? qMonth;
    const d = next.day === undefined ? qDay : next.day; // allow null to clear
    const sp = new URLSearchParams();
    sp.set('year', String(y));
    sp.set('month', String(m).padStart(2, '0'));
    if (d) sp.set('day', d);
    router.replace(`/report?${sp.toString()}`);
  }

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Attendance Report</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 12px' }}>
        <label>Year</label>
        <select
          value={qYear}
          onChange={(e) => setQuery({ year: Number(e.target.value) })}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 6 }}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <label>Month</label>
        <select
          value={String(qMonth).padStart(2, '0')}
          onChange={(e) => setQuery({ month: Number(e.target.value) })}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 6 }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const v = String(m).padStart(2, '0');
            return (
              <option key={v} value={v}>{v}</option>
            );
          })}
        </select>

        <label>Day</label>
        <select
          value={qDay ?? ''}
          onChange={(e) => setQuery({ day: e.target.value || null })}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 6 }}
        >
          <option value="">All days</option>
          {dayOptions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}
        >
          Print / Save PDF
        </button>
      </div>

      <div style={{ margin: '4px 0 10px', color: '#555' }}>
        Period: <b>{ymLabel}{qDay ? `-${qDay}` : ''}</b>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {byStaff.map((st) => (
        <section key={st.email} style={{ margin: '24px 0' }}>
          <h3 style={{ margin: '6px 0' }}>
            {st.name}{' '}
            <span style={{ color: '#666', fontWeight: 400 }}>({st.email})</span>
          </h3>
          <div style={{ margin: '6px 0', fontSize: 14 }}>
            <b>Absent days:</b> {st.absentDays} &nbsp;•&nbsp; <b>Late total:</b> {st.lateTotal} min
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ background: '#f6f6f6' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Check-in (KL)</th>
                  <th style={th}>Check-out (KL)</th>
                  <th style={th}>Late (min)</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {st.rows.map((r) => {
                  const late = r.late_minutes || 0;
                  const lateStyle = late > 0 ? { color: '#b91c1c', fontWeight: 600 } : {};
                  const status = r.absent ? 'Absent' : 'Present';
                  const statusStyle = r.absent ? { color: '#b91c1c', fontWeight: 600 } : {};
                  return (
                    <tr key={r.day}>
                      <td style={td}>
                        {new Date(`${r.day}T00:00:00`).toLocaleDateString('en-GB')}
                      </td>
                      <td style={td}>
                        {r.first_in_utc
                          ? new Date(r.first_in_utc).toLocaleTimeString('en-GB', {
                              hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'
                            })
                          : '—'}
                      </td>
                      <td style={td}>
                        {r.last_out_utc
                          ? new Date(r.last_out_utc).toLocaleTimeString('en-GB', {
                              hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'
                            })
                          : '—'}
                      </td>
                      <td style={{ ...td, ...lateStyle }}>{late}</td>
                      <td style={{ ...td, ...statusStyle }}>{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <hr style={{ marginTop: 24 }} />
        </section>
      ))}

      <style>{`
        @media print {
          button, select, label { display: none; }
          a { text-decoration: none; color: black; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          section { page-break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}