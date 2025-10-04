'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type Row = {
  staff_name: string;
  staff_email: string;
  day: string;                  // yyyy-mm-dd
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
  override: 'OFFDAY' | 'MC' | null;
};

const box: React.CSSProperties = { maxWidth: 980, margin: '16px auto', padding: 16 };
const input: React.CSSProperties = { padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, outline: 'none', width: 120 };
const bigInput: React.CSSProperties = { ...input, width: 260 };
const btn: React.CSSProperties = { padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#f7f7f7' };
const h3: React.CSSProperties = { margin: '6px 0 12px', fontWeight: 600 };
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontWeight: 600, background: '#f5fafc', whiteSpace: 'nowrap', borderBottom: '1px solid #eee' };
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f1f1', whiteSpace: 'nowrap' };
const redCell: React.CSSProperties = { color: '#b42318', fontWeight: 600 };
const greenPill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#e8f5e9', color: '#1b5e20', fontSize: 12 };
const grayPill: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: '#f0f0f0', color: '#333', fontSize: 12 };

export default function ReportPage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>(''); // optional
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // SINGLE declarations:
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Staff dropdown
  const [selectedKey, setSelectedKey] = useState<string>(''); // '' = show nothing, 'ALL' = all staff

  // Session + admin check (via security-definer RPC)
  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      setMeEmail(email);

      if (email) {
        const { data: flag, error } = await supabase.rpc('is_admin', {});
        setIsAdmin(!error && flag === true);
      } else {
        setIsAdmin(false);
      }
    };

    getSession();
    const { data: sub } = supabase.auth.onAuthStateChange(() => getSession());
    return () => { sub.subscription.unsubscribe(); };
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
      setRows((data as Row[]) ?? []);
    } catch (e) {
      alert(`Failed to load report: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day]);

  useEffect(() => { reload(); }, [reload]);

  // group rows by staff (email key)
  type Group = { key: string; name: string; email: string; rows: Row[] };
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of rows) {
      const key = r.staff_email;
      if (!m.has(key)) m.set(key, { key, name: r.staff_name, email: r.staff_email, rows: [] });
      m.get(key)!.rows.push(r);
    }
    for (const g of m.values()) g.rows.sort((a, b) => a.day.localeCompare(b.day));
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const visibleGroups: Group[] = useMemo(() => {
    if (selectedKey === '') return [];
    if (selectedKey === 'ALL') return groups;
    return groups.filter(g => g.key === selectedKey);
  }, [groups, selectedKey]);

  // TEMP handler; we’ll replace with modal after you confirm it appears
  const onEdit = (row: Row) => {
    alert(`Edit clicked: ${row.staff_name} — ${row.day}`);
  };

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

      {/* Debug so you can SEE the state on iPad */}
      <div style={{fontSize:12, color:'#666', marginTop:6}}>
        session: <b>{meEmail ?? '(none)'}</b> · isAdmin: <b>{String(isAdmin)}</b>
      </div>

      <div style={{display:'flex', gap:12, flexWrap:'wrap', marginTop:12, alignItems:'center'}}>
        <div>
          <div style={{fontSize:12, color:'#777'}}>Year</div>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={input} />
        </div>
        <div>
          <div style={{fontSize:12, color:'#777'}}>Month</div>
          <input type="number" min={1} max={12} value={month} onChange={e => setMonth(Number(e.target.value))} style={input} />
        </div>
        <div>
          <div style={{fontSize:12, color:'#777'}}>Day (optional)</div>
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={e => setDay(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="(optional)"
            style={input}
          />
        </div>
        <button onClick={reload} style={btn} disabled={loading}>
          {loading ? 'Loading…' : 'Reload'}
        </button>

        {/* Staff dropdown */}
        <div>
          <div style={{fontSize:12, color:'#777'}}>Staff</div>
          <select
            value={selectedKey}
            onChange={e => setSelectedKey(e.target.value)}
            style={{ ...bigInput, width: 280 }}
          >
            <option value="">— Choose staff to view —</option>
            <option value="ALL">All staff</option>
            {groups.map(g => (
              <option key={g.key} value={g.key}>{g.name} ({g.email})</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{marginTop:10, fontSize:14, color:'#666'}}>
        Period: <b>{String(month).padStart(2,'0')}/{year}</b>
        {day !== '' ? `, Day ${day}` : ''}
      </div>

      <div style={{marginTop:18}}>
        {visibleGroups.length === 0 && (
          <div style={{color:'#666'}}>Pick a staff from the dropdown above.</div>
        )}

        {visibleGroups.map(group => {
          const lateTotal = group.rows.reduce((acc, r) => acc + (r.late_min ?? 0), 0);
          const absentDays = group.rows.reduce((acc, r) => acc + ((!r.check_in_kl && !r.override) ? 1 : 0), 0);

          return (
            <div key={group.key} style={{marginTop:24}}>
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
                      {isAdmin && <th style={th}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(r => {
                      const absent = !r.check_in_kl && !r.override;
                      const statusEl = r.override
                        ? <span style={grayPill}>{r.override}</span>
                        : (absent ? <span style={redCell}>Absent</span> : <span style={greenPill}>Present</span>);
                      const lateEl = r.override ? '—' : (r.late_min && r.late_min > 0 ? r.late_min : '—');

                      return (
                        <tr key={`${group.key}-${r.day}`}>
                          <td style={td}>{r.day}</td>
                          <td style={td}>{r.check_in_kl ?? '—'}</td>
                          <td style={td}>{r.check_out_kl ?? '—'}</td>
                          <td style={{...td, ...(r.late_min && r.late_min > 0 ? redCell : {})}}>{lateEl}</td>
                          <td style={td}>{statusEl}</td>
                          {isAdmin && (
                            <td style={td}>
                              <button
                                style={{...btn, padding:'6px 10px'}}
                                onClick={() => onEdit(r)}
                              >
                                Edit
                              </button>
                            </td>
                          )}
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