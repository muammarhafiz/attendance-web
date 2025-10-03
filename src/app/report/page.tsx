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

type TimeOverride = {
  id?: string;
  day: string;                  // yyyy-mm-dd
  staff_email: string;
  check_in_kl: string | null;   // 'HH:MM' or null
  check_out_kl: string | null;  // 'HH:MM' or null
  reason: string | null;
};

type EditModalState = {
  open: boolean;
  day: string;
  staff_email: string;
  staff_name: string;
  check_in_kl: string;   // input friendly
  check_out_kl: string;  // input friendly
  reason: string;
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

// helpers
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function toISO(y: number, m: number, d: number) {
  const mm = String(clamp(m, 1, 12)).padStart(2, '0');
  const dd = String(clamp(d, 1, 31)).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}
// normalize "HH:MM" or return null
function normHHMM(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

export default function ReportPage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>(''); // optional
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // staff selection (defaults to none)
  const [selectedKey, setSelectedKey] = useState<string>(''); // '' = show nothing, 'ALL' = all staff, otherwise an email key

  // overrides & modal
  const [overrides, setOverrides] = useState<Record<string, TimeOverride>>({}); // key = `${day}|${email}`
  const [editModal, setEditModal] = useState<EditModalState>({
    open: false, day: '', staff_email: '', staff_name: '', check_in_kl: '', check_out_kl: '', reason: ''
  });

  // session guard + admin check
  useEffect(() => {
  const getSession = async () => {
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email ?? null;
    setMeEmail(email);

    if (email) {
      const { data: adminFlag, error } = await supabase.rpc('is_admin', {});
      setIsAdmin(!error && adminFlag === true);
    } else {
      setIsAdmin(false);
    }
  };

  getSession();
  const { data: sub } = supabase.auth.onAuthStateChange(() => getSession());
  return () => { sub.subscription.unsubscribe(); };
}, []);

  // compute period range for fetching overrides
  const firstDayISO = useMemo(() => {
    const d = day === '' ? 1 : Number(day);
    return day === '' ? toISO(year, month, 1) : toISO(year, month, d);
  }, [year, month, day]);

  const lastDayISO = useMemo(() => {
    if (day !== '') return toISO(year, month, Number(day));
    // last day of month
    const last = new Date(year, month, 0).getDate();
    return toISO(year, month, last);
  }, [year, month, day]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p_day = day === '' ? null : Number(day);

      // 1) report rows
      const { data, error } = await supabase.rpc('month_attendance', {
        p_year: Number(year),
        p_month: Number(month),
        p_day,
      });
      if (error) throw error;
      const casted: Row[] = (data as Row[]) ?? [];
      setRows(casted);

      // 2) overrides for the same period
      const { data: ovData, error: ovErr } = await supabase
        .from('day_time_override')
        .select('id, day, staff_email, check_in_kl, check_out_kl, reason')
        .gte('day', firstDayISO)
        .lte('day', lastDayISO);

      if (ovErr) {
        console.warn('Overrides load failed:', ovErr.message);
        setOverrides({});
      } else {
        const map: Record<string, TimeOverride> = {};
        for (const r of (ovData ?? [])) {
          const key = `${r.day}|${r.staff_email.toLowerCase()}`;
          // Normalize TIME to HH:MM for display if it arrives as HH:MM:SS
          const ci = r.check_in_kl ? String(r.check_in_kl).slice(0,5) : null;
          const co = r.check_out_kl ? String(r.check_out_kl).slice(0,5) : null;
          map[key] = {
            id: r.id,
            day: r.day,
            staff_email: r.staff_email,
            check_in_kl: ci,
            check_out_kl: co,
            reason: r.reason ?? null,
          };
        }
        setOverrides(map);
      }
    } catch (e) {
      alert(`Failed to load report: ${(e as Error).message}`);
      setRows([]);
      setOverrides({});
    } finally {
      setLoading(false);
    }
  }, [year, month, day, firstDayISO, lastDayISO]);

  useEffect(() => { reload(); }, [reload]);

  // group rows by staff (email key)
  type Group = { key: string; name: string; email: string; rows: Row[] };
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of rows) {
      const key = r.staff_email; // use email as stable key
      if (!m.has(key)) m.set(key, { key, name: r.staff_name, email: r.staff_email, rows: [] });
      m.get(key)!.rows.push(r);
    }
    for (const g of m.values()) g.rows.sort((a, b) => a.day.localeCompare(b.day));
    // sort staff by name
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // which groups to show based on dropdown
  const visibleGroups: Group[] = useMemo(() => {
    if (selectedKey === '' ) return [];           // show none by default
    if (selectedKey === 'ALL') return groups;     // show all
    return groups.filter(g => g.key === selectedKey);
  }, [groups, selectedKey]);

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
                      const ovKey = `${r.day}|${r.staff_email.toLowerCase()}`;
                      const ov = overrides[ovKey];

                      // Effective values (override wins)
                      const effIn  = ov?.check_in_kl ?? r.check_in_kl;
                      const effOut = ov?.check_out_kl ?? r.check_out_kl;

                      const absent = !effIn && !r.override;
                      const statusEl = r.override
                        ? <span style={grayPill}>{r.override}</span>
                        : (absent ? <span style={redCell}>Absent</span> : <span style={greenPill}>Present</span>);

                      const lateEl = r.override ? '—' : (r.late_min && r.late_min > 0 ? r.late_min : '—');

                      return (
                        <tr key={`${group.key}-${r.day}`}>
                          <td style={td}>{r.day}</td>
                          <td style={td}>{effIn ?? '—'}</td>
                          <td style={td}>{effOut ?? '—'}</td>
                          <td style={{...td, ...(r.late_min && r.late_min > 0 ? redCell : {})}}>{lateEl}</td>
                          <td style={td}>{statusEl}</td>
                          {isAdmin && (
                            <td style={td}>
                              <button
                                onClick={() => {
                                  setEditModal({
                                    open: true,
                                    day: r.day,
                                    staff_email: r.staff_email,
                                    staff_name: r.staff_name,
                                    check_in_kl: (effIn ?? '').slice(0,5),
                                    check_out_kl: (effOut ?? '').slice(0,5),
                                    reason: ov?.reason ?? '',
                                  });
                                }}
                                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:6, background:'#fff', cursor:'pointer' }}
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

      {/* Edit modal */}
      {isAdmin && editModal.open && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:60
        }}>
          <div style={{ background:'#fff', width:360, padding:16, borderRadius:10, boxShadow:'0 10px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin:0, marginBottom:12 }}>Edit Times</h3>
            <div style={{ fontSize:13, color:'#374151', marginBottom:8 }}>
              <div><strong>Day:</strong> {editModal.day}</div>
              <div><strong>Staff:</strong> {editModal.staff_name} <span style={{ color:'#6b7280' }}>({editModal.staff_email})</span></div>
            </div>

            <label style={{ display:'block', fontSize:13, marginTop:8 }}>Check-in (HH:MM)</label>
            <input
              type="text"
              placeholder="09:30"
              value={editModal.check_in_kl}
              onChange={e => setEditModal(m => ({ ...m, check_in_kl: e.target.value }))}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:6 }}
            />

            <label style={{ display:'block', fontSize:13, marginTop:8 }}>Check-out (HH:MM)</label>
            <input
              type="text"
              placeholder="18:00"
              value={editModal.check_out_kl}
              onChange={e => setEditModal(m => ({ ...m, check_out_kl: e.target.value }))}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:6 }}
            />

            <label style={{ display:'block', fontSize:13, marginTop:8 }}>Reason (optional)</label>
            <input
              type="text"
              placeholder="E.g. device issue"
              value={editModal.reason}
              onChange={e => setEditModal(m => ({ ...m, reason: e.target.value }))}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:6 }}
            />

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
              <button
                onClick={() => setEditModal(m => ({ ...m, open:false }))}
                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:6, background:'#fff' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Validate HH:MM → normalize or null
                  const ci = normHHMM(editModal.check_in_kl) ?? null;
                  const co = normHHMM(editModal.check_out_kl) ?? null;

                  const payload = {
                    day: editModal.day,
                    staff_email: editModal.staff_email,
                    check_in_kl: ci,
                    check_out_kl: co,
                    reason: editModal.reason.trim() || null,
                  };

                  const { error } = await supabase
                    .from('day_time_override')
                    .upsert(payload, { onConflict: 'day,staff_email' });

                  if (error) {
                    alert('Save failed: ' + error.message);
                    return;
                  }
                  setEditModal(m => ({ ...m, open:false }));
                  await reload();
                }}
                style={{ padding:'6px 12px', borderRadius:6, background:'#111827', color:'#fff', border:'none' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}