'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Row = {
  email: string;
  staff_name: string;
  day: string;                 // 'YYYY-MM-DD'
  first_in_kl: string | null;  // ISO or null
  last_out_kl: string | null;  // ISO or null
  late_minutes: number;
  absent: boolean;
};

const th: React.CSSProperties = { textAlign:'left', padding:'10px', borderBottom:'1px solid #e5e5e5' };
const td: React.CSSProperties = { padding:'10px', borderBottom:'1px solid #f0f0f0' };

function parseMonthParam(params: ReturnType<typeof useSearchParams>): Date {
  const m = params.get('month'); // expected: YYYY-MM
  if (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
    return new Date(`${m}-01T00:00:00`);
  }
  return new Date(); // default = current month
}

export default function ReportPage() {
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const monthStart = useMemo(() => parseMonthParam(params), [params]);
  const ym = useMemo(
    () => `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
    [monthStart]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      const iso = monthStart.toISOString().slice(0, 10); // YYYY-MM-DD
      const { data, error } = await supabase.rpc('month_attendance', { p_month: iso });
      if (error) setErr(error.message);
      else setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, [monthStart]);

  const byStaff = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.staff_name}:::${r.email}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const out = [];
    for (const [k, arr] of map) {
      arr.sort((a, b) => a.day.localeCompare(b.day));
      const [name, email] = k.split(':::');
      const absentDays = arr.filter(x => x.absent).length;
      const lateTotal = arr.reduce((s, x) => s + (x.late_minutes || 0), 0);
      out.push({ name, email, rows: arr, absentDays, lateTotal });
    }
    // sort staff alphabetically
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [rows]);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Attendance Report – {ym}</h2>
      <div style={{ margin: '8px 0' }}>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}
        >
          Print / Save PDF
        </button>
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
                        {r.first_in_kl
                          ? new Date(r.first_in_kl).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td style={td}>
                        {r.last_out_kl
                          ? new Date(r.last_out_kl).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
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
          button { display: none; }
          a { text-decoration: none; color: black; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          section { page-break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}