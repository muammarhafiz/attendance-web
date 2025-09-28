'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type Row = {
  staff_name: string;
  staff_email: string;
  day: string;          // ISO date (yyyy-mm-dd)
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
  override: 'OFFDAY' | 'MC' | null; // comes from day_status.status
};

const box: React.CSSProperties = {
  maxWidth: 980,
  margin: '16px auto',
  padding: 16,
};

const input: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #ddd',
  borderRadius: 8,
  outline: 'none',
  width: 120,
};

const bigInput: React.CSSProperties = {
  ...input,
  width: 260,
};

const btn: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid #ddd',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#f7f7f7',
};

const h3: React.CSSProperties = {
  margin: '6px 0 12px',
  fontWeight: 600,
};

const tableWrap: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid #eee',
  borderRadius: 10,
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  background: '#f5fafc',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid #eee',
};

const td: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f1f1',
  whiteSpace: 'nowrap',
};

const redCell: React.CSSProperties = { color: '#b42318', fontWeight: 600 };
const greenPill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#e8f5e9', color: '#1b5e20', fontSize: 12 };
const grayPill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#f0f0f0', color: '#333', fontSize: 12 };

export default function ReportPage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1); // 1-12
  const [day, setDay] = useState<number | ''>(''); // optional day filter
  const [filter, setFilter] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  // get current user for navbar sign-out etc (and to block unauth access)
  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      setMeEmail(data.session?.user?.email ?? null);
    };
    getSession();
    const { data: unsub } = supabase.auth.onAuthStateChange(() => getSession());
    return () => { unsub.subscription.unsubscribe(); };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p_day = day === '' ? null : Number(day);

      const { data, error } = await supabase.rpc('month_attendance', {
        p_year: Number(year),
        p_month: Number(month),
        p_day,
      });

      if (error) throw error;

      // ensure proper typing
      const casted: Row[] = (data as unknown as Row[])?.map(r => ({
        staff_name: r.staff_name,
        staff_email: r.staff_email,
        day: r.day,
        check_in_kl: r.check_in_kl,
        check_out_kl: r.check_out_kl,
        late_min: r.late_min,
        override: (r.override as Row['override']) ?? null,
      })) ?? [];

      setRows(casted);
    } catch (e) {
      console.error('Failed to load report', e);
      alert(`Failed to load report: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day]);

  useEffect(() => {
    // auto load for current month on first paint
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.staff_name.toLowerCase().includes(q) ||
      r.staff_email.toLowerCase().includes(q)
    );
  }, [rows, filter]);

  // Group by staff
  const byStaff = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = `${r.staff_name}|||${r.staff_email}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    // sort inside each group by date asc
    for (const [, arr] of m) {
      arr.sort((a, b) => a.day.localeCompare(b.day));
    }
    return Array.from(m.entries()).map(([k, v]) => {
      const [name, email] = k.split('|||');
      return { name, email, rows: v };
    });
  }, [filtered]);

  if (!meEmail) {
    return (
      <div style={box}>
        <p>Please <Link href="/login">sign in</Link> to view the report.</p>
      </div>
    );
  }

  return (
    <div style={box}>
      <h2 style={{margin: 0}}>Attendance Report</h2>

      <div style={{display:'flex', gap:12, flexWrap:'wrap', marginTop:12, alignItems:'center'}}>
        <div>
          <div style={{fontSize:12, color:'#777'}}>Year</div>
          <input
            type="number"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            style={input}
          />
        </div>
        <div>
          <div style={{fontSize:12, color:'#777'}}>Month</div>
          <input
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            style={input}
          />
        </div>
        <div>
          <div style={{fontSize:12, color:'#777'}}>Day (optional)</div>
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={e => {
              const v = e.target.value;
              setDay(v === '' ? '' : Number(v));
            }}
            placeholder="(optional)"
            style={input}
          />
        </div>
        <button onClick={reload} style={btn} disabled={loading}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
        <div style={{fontSize:14, color:'#666'}}>
          Period: <b>{String(month).padStart(2,'0')}/{year}</b>
          {day !== '' ? `, Day ${day}` : ''}
        </div>
      </div>

      <div style={{marginTop:12}}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by staff name/email…"
          style={bigInput}
        />
      </div>

      <div style={{marginTop:18}}>
        {byStaff.length === 0 && (
          <div style={{color:'#b42318'}}>No rows.</div>
        )}

        {byStaff.map(group => {
          // totals for this staff (late minutes sum, absences count)
          const lateTotal = group.rows.reduce((acc, r) => acc + (r.late_min ?? 0), 0);
          const absentDays = group.rows.reduce((acc, r) => {
            // Absent only if no check-in and no override
            const absent = !r.check_in_kl && !r.override;
            return acc + (absent ? 1 : 0);
          }, 0);

          return (
            <div key={group.email} style={{marginTop:24}}>
              <div style={h3}>
                {group.name} <span style={{color:'#888'}}>({group.email})</span>
              </div>
              <div style={{margin: '4px 0 10px', fontSize:14}}>
                Total late: <b>{lateTotal}</b> min · Absent days: <b>{absentDays}</b>
              </div>

              <div style={tableWrap}>
                <table style={{borderCollapse:'separate', borderSpacing:0, width:'100%'}}>
                  <thead>
                    <tr>
                      <th style={th}>Date</th>
                      <th style={th}>Check-in</th>
                      <th style={th}>Check-out</th>
                      <th style={th}>Late (min)</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(r => {
                      const absent = !r.check_in_kl && !r.override;
                      const statusEl = r.override
                        ? <span style={grayPill}>{r.override}</span>
                        : (absent ? <span style={redCell}>Absent</span> : <span style={greenPill}>Present</span>);

                      const lateEl =
                        r.override ? '—' : (r.late_min && r.late_min > 0 ? r.late_min : '—');

                      return (
                        <tr key={`${group.email}-${r.day}`}>
                          <td style={td}>{r.day}</td>
                          <td style={td}>{r.check_in_kl ?? '—'}</td>
                          <td style={td}>{r.check_out_kl ?? '—'}</td>
                          <td style={{...td, ...(r.late_min && r.late_min > 0 ? redCell : {})}}>
                            {lateEl}
                          </td>
                          <td style={td}>{statusEl}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}