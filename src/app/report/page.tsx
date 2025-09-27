'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  staff_email: string;
  staff_name: string | null;
  day: string;             // ISO date (YYYY-MM-DD)
  check_in: string | null; // ISO ts
  check_out: string | null;// ISO ts
  was_late: boolean;
  late_minutes: number;
  absent: boolean;
};

function toMYT(ts: string | null) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' });
}

export default function ReportPage() {
  const router = useRouter();
  const params = useSearchParams();

  // ---- AUTH GUARD ----
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userEmail = data.session?.user?.email ?? null;
      if (!userEmail) {
        router.replace('/login?next=/report');
        return;
      }
      setEmail(userEmail);
      setCheckingAuth(false);
    })();
  }, [router]);

  // ---- FILTER STATE (month/day/year) ----
  const today = useMemo(() => new Date(), []);
  const initYear = Number(params.get('y')) || today.getFullYear();
  const initMonth = Number(params.get('m')) || (today.getMonth() + 1); // 1..12

  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [day, setDay] = useState<number | ''>(''); // optional single day filter

  // compute period range (start..end exclusive) in MYT
  const { startISO, endISO, label } = useMemo(() => {
    const start = new Date(Date.UTC(year, month - 1, 1, 16, 0, 0)); // 00:00 MYT = 16:00 UTC prev day
    const end = new Date(Date.UTC(year, month, 1, 16, 0, 0));
    const fmt = (d: Date) => d.toISOString();
    return {
      startISO: fmt(start),
      endISO: fmt(end),
      label: `${String(month).padStart(2, '0')}/${year}`,
    };
  }, [year, month]);

  // ---- DATA ----
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true); setErr(null);
    // If you created SQL function month_attendance(start,end), prefer rpc:
    // const { data, error } = await supabase.rpc('month_attendance', { p_start: startISO, p_end: endISO });

    // Otherwise, read from a view/materialized view; here we select from attendance joined with staff.
    const { data, error } = await supabase
      .from('attendance_report_view') // <- use your real view/table name here
      .select('staff_email, staff_name, day, check_in, check_out, was_late, late_minutes, absent')
      .gte('day', `${year}-${String(month).padStart(2, '0')}-01`)
      .lt('day', `${year}-${String(month + 1).padStart(2, '0')}-01`);
    if (error) setErr(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month]);

  const filtered = useMemo(() => {
    if (day === '' || day == null) return rows;
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return rows.filter(r => r.day === dStr);
  }, [rows, day, month, year]);

  // ---- RENDER ----
  if (checkingAuth) return <div style={{ padding: 16 }}>Checking sign-in…</div>;

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui', background: '#fff', color: '#111' }}>
      <h2>Attendance Report</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label>Year</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 6, width: 100 }}
        />
        <label>Month</label>
        <input
          type="number"
          value={month}
          min={1}
          max={12}
          onChange={(e) => setMonth(Math.max(1, Math.min(12, Number(e.target.value))))}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 6, width: 80 }}
        />
        <label>Day</label>
        <input
          type="number"
          value={day}
          placeholder="(optional)"
          onChange={(e) => {
            const v = e.target.value;
            setDay(v === '' ? '' : Number(v));
          }}
          style={{ padding: 6, border: '1px solid #ccc', borderRadius: 6, width: 120 }}
        />
        <button onClick={fetchData} style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}>
          Reload
        </button>
        <div style={{ marginLeft: 12, color: '#555' }}>Period: <b>{label}</b></div>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {!loading && !err && (
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', background: '#f9f9f9' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={th}>Staff</th>
                <th style={th}>Email</th>
                <th style={th}>Day</th>
                <th style={th}>Check-in</th>
                <th style={th}>Check-out</th>
                <th style={th}>Late?</th>
                <th style={th}>Late (min)</th>
                <th style={th}>Absent?</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ background: r.was_late ? '#ffecec' : 'transparent' }}>
                  <td style={td}>{r.staff_name || '-'}</td>
                  <td style={td}>{r.staff_email}</td>
                  <td style={td}>{r.day}</td>
                  <td style={td}>{toMYT(r.check_in)}</td>
                  <td style={td}>{toMYT(r.check_out)}</td>
                  <td style={td}>{r.was_late ? 'Yes' : 'No'}</td>
                  <td style={td}>{r.late_minutes ?? 0}</td>
                  <td style={td}>{r.absent ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 12, color: '#666' }}>No data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: 10, borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: 10, borderBottom: '1px solid #f0f0f0' };