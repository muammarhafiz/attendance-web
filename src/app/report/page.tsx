'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type AttRow = {
  id: string;
  staff_name: string | null;
  staff_email: string;
  action: 'in' | 'out';
  ts: string;
  day: string; // YYYY-MM-DD
};

type DayRow = {
  date: string;        // YYYY-MM-DD
  checkIn?: Date;
  checkOut?: Date;
  lateMin?: number;
};

type StaffMonth = {
  email: string;
  name: string;
  days: DayRow[];
};

const fmtKLTime = (d?: Date) =>
  d ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(d) : '—';

const fmtDate = (isoDate: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(isoDate + 'T00:00:00+08:00'));

const monthDays = (y: number, m: number) => {
  const days: string[] = [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
  for (let d = 1; d <= last; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    days.push(`${y}-${mm}-${dd}`);
  }
  return days;
};

const cutoffLateMinutes = (d: Date) => {
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric' }).format(d);
  const m = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit' }).format(d);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit' }).format(d);
  const cutoff = new Date(`${y}-${m}-${day}T09:30:00+08:00`);
  return Math.max(0, Math.round((d.getTime() - cutoff.getTime()) / 60000));
};

export default function Report() {
  const now = new Date();
  const [year, setYear] = useState<number>(Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric' }).format(now)));
  const [month, setMonth] = useState<number>(Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit' }).format(now)));
  const [day, setDay] = useState<number | ''>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AttRow[]>([]);
  const [filter, setFilter] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : `${year}-${String(month).padStart(2, '0')}-31`;

    const q = supabase
      .from('attendance')
      .select('id, staff_name, staff_email, action, ts, day')
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: true })
      .order('ts', { ascending: true });

    const { data, error } = await q;

    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as AttRow[]);
    }
    setLoading(false);
  }, [year, month, day]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Build per-staff month tables
  const perStaffMonth: StaffMonth[] = useMemo(() => {
    const byStaff = new Map<string, StaffMonth>();
    const days = monthDays(year, month);

    // Seed
    for (const r of rows) {
      const key = r.staff_email;
      if (!byStaff.has(key)) {
        byStaff.set(key, {
          email: key,
          name: r.staff_name ?? key.split('@')[0],
          days: days.map((d) => ({ date: d })),
        });
      }
    }

    // Fill data
    for (const r of rows) {
      const s = byStaff.get(r.staff_email);
      if (!s) continue;
      const idx = s.days.findIndex((d) => d.date === r.day);
      if (idx < 0) continue;
      const d = new Date(r.ts);
      const cell = s.days[idx];
      if (r.action === 'in') {
        if (!cell.checkIn || d < cell.checkIn) cell.checkIn = d;
      } else if (r.action === 'out') {
        if (!cell.checkOut || d > cell.checkOut) cell.checkOut = d;
      }
    }

    // Compute late minutes
    for (const s of byStaff.values()) {
      for (const dayRow of s.days) {
        if (dayRow.checkIn) {
          const mins = cutoffLateMinutes(dayRow.checkIn);
          if (mins > 0) dayRow.lateMin = mins;
        }
      }
    }

    // Filter by staff name/email if needed
    let arr = Array.from(byStaff.values()).sort((a, b) => a.name.localeCompare(b.name));
    const q = filter.trim().toLowerCase();
    if (q) {
      arr = arr.filter(
        (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [rows, year, month, filter]);

  const staffOptions = useMemo(
    () =>
      Array.from(new Map(perStaffMonth.map((s) => [s.email, s])).values()).map((s) => ({
        email: s.email,
        name: s.name,
      })),
    [perStaffMonth],
  );

  const [selectedEmail, setSelectedEmail] = useState<string>('');

  useEffect(() => {
    if (staffOptions.length && !staffOptions.find((x) => x.email === selectedEmail)) {
      setSelectedEmail(staffOptions[0].email);
    }
  }, [staffOptions, selectedEmail]);

  const visible = perStaffMonth.filter((s) => !selectedEmail || s.email === selectedEmail);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Attendance Report</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label>Year&nbsp;
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value || '0', 10))} style={{ width: 90 }} />
        </label>
        <label>Month&nbsp;
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(parseInt(e.target.value || '0', 10))} style={{ width: 70 }} />
        </label>
        <label>Day (optional)&nbsp;
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(e.target.value ? parseInt(e.target.value, 10) : '')}
            style={{ width: 90 }}
          />
        </label>
        <button onClick={reload} disabled={loading}>{loading ? 'Loading…' : 'Reload'}</button>
        <span style={{ marginLeft: 8 }}>Period: {String(month).padStart(2, '0')}/{year}{day ? `, Day ${day}` : ''}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          placeholder="Filter by staff name/email…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 220, padding: 8 }}
        />
        <select value={selectedEmail} onChange={(e) => setSelectedEmail(e.target.value)} style={{ padding: 8 }}>
          {staffOptions.map((s) => (
            <option key={s.email} value={s.email}>{s.name} — {s.email}</option>
          ))}
        </select>
      </div>

      {error && <div style={{ color: 'crimson', marginBottom: 8 }}>Failed to load report: {error}</div>}

      {visible.map((s) => (
        <section key={s.email} style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '12px 0 8px' }}>{s.name} <span style={{ color: '#666', fontWeight: 400 }}>({s.email})</span></h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Check-in</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Check-out</th>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Late (min)</th>
                </tr>
              </thead>
              <tbody>
                {s.days.map((d) => {
                  const lateStyle = d.lateMin && d.lateMin > 0 ? { color: '#a00', fontWeight: 600, background: '#fff3f2' } : undefined;
                  return (
                    <tr key={d.date} style={lateStyle}>
                      <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{fmtDate(d.date)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{fmtKLTime(d.checkIn)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{fmtKLTime(d.checkOut)}</td>
                      <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{d.lateMin ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {!loading && !error && visible.length === 0 && (
        <div style={{ color: '#555' }}>No data for the selected period.</div>
      )}
    </main>
  );
}