'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type MonthRow = {
  staff_name: string;
  staff_email: string;
  day: string; // YYYY-MM-DD
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
  const [selectedEmail, setSelectedEmail] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    const { data, error } = await supabase.rpc('month_attendance_v2', {
      p_year: year,
      p_month: month,
    });
    if (error) {
      setErrorText(error.message);
      setRows([]);
    } else {
      setRows((data as MonthRow[]) ?? []);
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    reload();
  }, [reload]);

  const staffList = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const r of rows) {
      if (!map.has(r.staff_email)) {
        map.set(r.staff_email, { name: r.staff_name, email: r.staff_email });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
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

  const visibleStaff = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let arr = byStaff;
    if (selectedEmail) arr = arr.filter((s) => s.staff_email === selectedEmail);
    if (!q) return arr;
    return arr.filter(
      (s) =>
        s.staff_name.toLowerCase().includes(q) ||
        s.staff_email.toLowerCase().includes(q)
    );
  }, [byStaff, filter, selectedEmail]);

  const periodLabel = useMemo(
    () => `Period: ${String(month).padStart(2, '0')}/${year}`,
    [year, month]
  );

  // styles (mobile-first)
  const page: React.CSSProperties = { padding: 16, fontFamily: 'system-ui', maxWidth: 980, margin: '0 auto' };
  const row = (gap = 12): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap,
  });
  const rowWide: React.CSSProperties = {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 10,
    border: '1px solid #d0d5dd',
    borderRadius: 8,
    fontSize: 16,
    boxSizing: 'border-box',
  };
  const btn: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d0d5dd',
    background: '#f6f8fb',
    cursor: 'pointer',
    fontSize: 16,
  };
  const tableWrap: React.CSSProperties = { overflowX: 'auto', marginTop: 8 };
  const th: React.CSSProperties = { textAlign: 'left', padding: 8, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: 8 };

  return (
    <main style={page}>
      <h2 style={{ marginBottom: 12 }}>Attendance Report</h2>

      {/* Row 1: Year / Month / Reload — stacks on mobile */}
      <div style={row(8)}>
        <div style={rowWide}>
          <label>
            <div style={{ marginBottom: 4 }}>Year</div>
            <input
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value || '0', 10))}
              style={inputStyle}
              aria-label="Report year"
            />
          </label>

          <label>
            <div style={{ marginBottom: 4 }}>Month</div>
            <input
              type="number"
              inputMode="numeric"
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value || '0', 10))}
              style={inputStyle}
              aria-label="Report month"
            />
          </label>

          <div>
            <div style={{ marginBottom: 4, visibility: 'hidden' }}>Reload</div>
            <button onClick={reload} style={btn} aria-label="Reload report">Reload</button>
          </div>
        </div>

        <div style={{ color: '#555' }}>{periodLabel}</div>
      </div>

      {/* Row 2: Filter / Staff dropdown / Print — stacks on mobile */}
      <div style={{ ...row(8), marginTop: 12 }}>
        <input
          placeholder="Filter by staff name/email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={inputStyle}
          aria-label="Filter staff"
        />

        <select
          value={selectedEmail}
          onChange={(e) => setSelectedEmail(e.target.value)}
          style={inputStyle}
          aria-label="Select staff"
        >
          <option value="">All staff</option>
          {staffList.map((s) => (
            <option key={s.email} value={s.email}>
              {s.name} ({s.email})
            </option>
          ))}
        </select>

        <button onClick={() => window.print()} style={btn} aria-label="Print or save to PDF">
          Print / Save PDF
        </button>
      </div>

      {errorText && (
        <p style={{ color: '#b00020', marginTop: 12 }}>Failed to load: {errorText}</p>
      )}
      {loading && <p style={{ marginTop: 12 }}>Loading…</p>}
      {!loading && visibleStaff.length === 0 && <p style={{ marginTop: 12 }}>No rows.</p>}

      {visibleStaff.map((s) => (
        <section key={s.staff_email} style={{ marginTop: 20 }}>
          <h3 style={{ margin: '8px 0' }}>
            {s.staff_name}{' '}
            <span style={{ color: '#666', fontWeight: 400 }}>({s.staff_email})</span>
          </h3>
          <div style={{ marginBottom: 6, color: '#444' }}>
            Total late: <b>{s.totalLate}</b> min &nbsp;•&nbsp; Absent days: <b>{s.absentDays}</b>
          </div>

          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f7fb' }}>
                  <th style={th}>Date</th>
                  <th style={th}>Check-in</th>
                  <th style={th}>Check-out</th>
                  <th style={th}>Late (min)</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => {
                  const late = r.late_min ?? undefined;
                  const isLate = typeof late === 'number' && late > 0;
                  const absent = !r.check_in_kl && !r.check_out_kl;
                  return (
                    <tr
                      key={`${r.staff_email}-${r.day}`}
                      style={{ background: isLate ? '#fff4f2' : undefined }}
                    >
                      <td style={td}>{r.day}</td>
                      <td style={td}>{r.check_in_kl ?? '—'}</td>
                      <td style={td}>{r.check_out_kl ?? '—'}</td>
                      <td style={{ ...td, color: isLate ? '#b33' : undefined }}>
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