'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type MonthRow = {
  staff_name: string;
  staff_email: string;
  day: string; // date (YYYY-MM-DD from SQL)
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
};

type StaffEntry = {
  staff_name: string;
  staff_email: string;
  rows: MonthRow[];
  totalLate: number;
  absentDays: number;
};

function klNowParts() {
  const klNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  return { y: klNow.getFullYear(), m: klNow.getMonth() + 1 };
}

export default function ReportPage() {
  const { y, m } = klNowParts();
  const [year, setYear] = useState<number>(y);
  const [month, setMonth] = useState<number>(m);
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [errorText, setErrorText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [filter, setFilter] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<string>(''); // dropdown

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    const { data, error } = await supabase
      .rpc('month_attendance_v2', { p_year: year, p_month: month });
    if (error) {
      setErrorText(error.message);
      setRows([]);
    } else {
      setRows((data as MonthRow[]) ?? []);
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => { reload(); }, [reload]);

  // Build staff buckets
  const staffList = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const r of rows) {
      if (!map.has(r.staff_email)) map.set(r.staff_email, { name: r.staff_name, email: r.staff_email });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const byStaff = useMemo(() => {
    const res: StaffEntry[] = [];
    const groups = new Map<string, MonthRow[]>();
    for (const r of rows) {
      if (!groups.has(r.staff_email)) groups.set(r.staff_email, []);
      groups.get(r.staff_email)!.push(r);
    }
    for (const [email, list] of groups.entries()) {
      list.sort((a, b) => a.day.localeCompare(b.day));
      const name = list[0]?.staff_name ?? email;
      const totalLate = list.reduce((acc, x) => acc + (x.late_min ?? 0), 0);
      const absentDays = list.reduce((acc, x) => {
        const absent = !x.check_in_kl && !x.check_out_kl;
        return acc + (absent ? 1 : 0);
      }, 0);
      res.push({ staff_name: name, staff_email: email, rows: list, totalLate, absentDays });
    }
    res.sort((a, b) => a.staff_name.localeCompare(b.staff_name));
    return res;
  }, [rows]);

  // Apply filter + dropdown selection
  const visibleStaff = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let arr = byStaff;
    if (selectedEmail) arr = arr.filter(s => s.staff_email === selectedEmail);
    if (!q) return arr;
    return arr.filter(s =>
      s.staff_name.toLowerCase().includes(q) ||
      s.staff_email.toLowerCase().includes(q)
    );
  }, [byStaff, filter, selectedEmail]);

  const periodLabel = useMemo(
    () => `Period: ${String(month).padStart(2, '0')}/${year}`,
    [year, month]
  );

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Attendance Report</h2>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label>
          <div>Year</div>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value || '0', 10))}
            style={{ padding: 8, width: 100 }}
          />
        </label>

        <label>
          <div>Month</div>
          <input
            type="number"
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value || '0', 10))}
            style={{ padding: 8, width: 80 }}
          />
        </label>

        <button onClick={reload} style={{ padding: '8px 12px' }}>Reload</button>

        <div style={{ marginLeft: 'auto' }}>{periodLabel}</div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          placeholder="Filter by staff name/email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: 8, flex: 1, minWidth: 220 }}
        />
        <select
          value={selectedEmail}
          onChange={(e) => setSelectedEmail(e.target.value)}
          style={{ padding: 8, minWidth: 220 }}
        >
          <option value="">All staff</option>
          {staffList.map(s => (
            <option key={s.email} value={s.email}>
              {s.name} ({s.email})
            </option>
          ))}
        </select>
        <button onClick={() => window.print()} style={{ padding: '8px 12px' }}>
          Print / Save PDF
        </button>
      </div>

      {errorText && (
        <p style={{ color: '#b00020', marginBottom: 12 }}>Failed to load: {errorText}</p>
      )}

      {loading && <p>Loading…</p>}

      {!loading && visibleStaff.length === 0 && (
        <p>No rows.</p>
      )}

      {visibleStaff.map((s) => (
        <section key={s.staff_email} style={{ marginBottom: 28 }}>
          <h3 style={{ margin: '8px 0' }}>
            {s.staff_name} <span style={{ color: '#666', fontWeight: 400 }}>({s.staff_email})</span>
          </h3>
          <div style={{ marginBottom: 6, color: '#444' }}>
            Total late: <b>{s.totalLate}</b> min &nbsp;•&nbsp; Absent days: <b>{s.absentDays}</b>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f7fb' }}>
                  <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Check-in</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Check-out</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Late (min)</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => {
                  const late = r.late_min ?? undefined;
                  const isLate = typeof late === 'number' && late > 0;
                  const absent = !r.check_in_kl && !r.check_out_kl;
                  return (
                    <tr key={`${r.staff_email}-${r.day}`} style={{ background: isLate ? '#fff4f2' : undefined }}>
                      <td style={{ padding: 8 }}>{r.day}</td>
                      <td style={{ padding: 8 }}>{r.check_in_kl ?? '—'}</td>
                      <td style={{ padding: 8 }}>{r.check_out_kl ?? '—'}</td>
                      <td style={{ padding: 8, color: isLate ? '#b33' : undefined }}>
                        {absent ? 'Absent' : (late ?? '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}