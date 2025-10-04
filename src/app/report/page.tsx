'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link'
import React from 'react';

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

/* ------------ helpers ------------ */

function hhmmOrEmpty(s: string | null | undefined): string {
  if (!s) return '';
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function isValidHHMM(s: string): boolean {
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return false;
  const hh = parseInt(m[1], 10);
  return hh >= 0 && hh <= 23;
}

/** recompute late minutes vs 09:30 from "HH:MM" */
function minutesLateFrom930(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const mins = hh * 60 + mm;
  const nineThirty = 9 * 60 + 30;
  return Math.max(0, mins - nineThirty);
}

/** KL “today” in yyyy-mm-dd */
function klTodayISO(): string {
  const klNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  const y = klNow.getFullYear();
  const m = String(klNow.getMonth() + 1).padStart(2, '0');
  const d = String(klNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** true if the given yyyy-mm-dd is a Sunday */
function isSunday(isoDay: string): boolean {
  // treat as UTC midnight to avoid TZ drift
  const dow = new Date(`${isoDay}T00:00:00Z`).getUTCDay();
  return dow === 0;
}

/* ------------ main page ------------ */

export default function ReportPage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>(''); // optional

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // auth + admin
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // staff filter
  const [selectedKey, setSelectedKey] = useState<string>(''); // '' none, 'ALL' all

  // edit modal
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editIn, setEditIn] = useState<string>('');     // HH:MM
  const [editOut, setEditOut] = useState<string>('');   // HH:MM
  const [editNote, setEditNote] = useState<string>(''); // note
  const [saving, setSaving] = useState<boolean>(false);
  const [saveErr, setSaveErr] = useState<string>('');

  // session + admin (rpc)
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

      // 1) base rows from month_attendance
      const { data, error } = await supabase.rpc('month_attendance', {
        p_year: Number(year),
        p_month: Number(month),
        p_day,
      });
      if (error) throw error;
      const baseRows: Row[] = (data as Row[]) ?? [];

      // 2) fetch overrides for same period
      const y = Number(year);
      const m = Number(month);
      const startISO = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
      const endDate = (m === 12) ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
      const endISO = endDate.toISOString().slice(0, 10);

      type Ov = { day: string; staff_email: string; check_in_kl: string | null; check_out_kl: string | null; note?: string | null };
      let ovQuery = supabase
        .from('day_time_override')
        .select('day, staff_email, check_in_kl, check_out_kl, note');

      if (p_day !== null) {
        const d = String(p_day).padStart(2, '0');
        ovQuery = ovQuery.eq('day', `${year}-${String(month).padStart(2,'0')}-${d}`);
      } else {
        ovQuery = ovQuery.gte('day', startISO).lt('day', endISO);
      }

      const { data: overrides, error: ovErr } = await ovQuery;
      if (ovErr) throw ovErr;

      // 3) merge overrides into base rows by (day,email)
      const key = (d: string, e: string) => `${d}|${e.toLowerCase()}`;
      const ovMap = new Map<string, Ov>();
      (overrides ?? []).forEach(o => ovMap.set(key(o.day, o.staff_email), o));

      const merged: Row[] = baseRows.map(r => {
        const ov = ovMap.get(key(r.day, r.staff_email));
        if (!ov) return r;

        const checkIn  = ov.check_in_kl  ?? r.check_in_kl;
        const checkOut = ov.check_out_kl ?? r.check_out_kl;

        return {
          ...r,
          check_in_kl: checkIn,
          check_out_kl: checkOut,
          late_min: minutesLateFrom930(checkIn),
        };
      });

      setRows(merged);
    } catch (e) {
      alert(`Failed to load report: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day]);

  useEffect(() => { reload(); }, [reload]);

  // group rows by staff
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
    if (selectedKey === '' ) return [];
    if (selectedKey === 'ALL') return groups;
    return groups.filter(g => g.key === selectedKey);
  }, [groups, selectedKey]);

  /* ------------ edit flow ------------ */

  function openEdit(row: Row) {
    setEditRow(row);
    setEditIn(hhmmOrEmpty(row.check_in_kl));
    setEditOut(hhmmOrEmpty(row.check_out_kl));
    setEditNote('');
    setSaveErr('');
    setShowModal(true);
  }

  function closeEdit() {
    if (saving) return;
    setShowModal(false);
    setEditRow(null);
    setEditIn('');
    setEditOut('');
    setEditNote('');
    setSaveErr('');
  }

  async function saveEdit() {
    if (!editRow || !isAdmin) return;

    if (editIn !== '' && !isValidHHMM(editIn)) {
      setSaveErr('Check-in must be HH:MM (24-hour). Example: 09:15');
      return;
    }
    if (editOut !== '' && !isValidHHMM(editOut)) {
      setSaveErr('Check-out must be HH:MM (24-hour). Example: 18:00');
      return;
    }

    setSaving(true);
    setSaveErr('');
    try {
      const payload = {
        day: editRow.day,
        staff_email: editRow.staff_email,
        check_in_kl: editIn === '' ? null : editIn,
        check_out_kl: editOut === '' ? null : editOut,
        note: editNote || null,
        created_by: meEmail ?? null,
      };

      const { error } = await supabase
        .from('day_time_override')
        .upsert(payload, { onConflict: 'day,staff_email' });

      if (error) throw error;

      setShowModal(false);
      setEditRow(null);
      await reload();
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /* ------------ render ------------ */

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
                      const todayISO = klTodayISO();
                      const future = r.day > todayISO;
                      const sunday = isSunday(r.day);

                      // Status precedence:
                      // 1) Admin override (MC/OFFDAY)
                      // 2) Future day → —
                      // 3) Sunday → Offday
                      // 4) Else: Absent if no check-in, else Present
                      let statusEl: React.ReactNode;
                      if (r.override) {
                        statusEl = <span style={grayPill}>{r.override}</span>;
                      } else if (future) {
                        statusEl = <span>—</span>;
                      } else if (sunday) {
                        statusEl = <span style={grayPill}>Offday</span>;
                      } else if (!r.check_in_kl) {
                        statusEl = <span style={redCell}>Absent</span>;
                      } else {
                        statusEl = <span style={greenPill}>Present</span>;
                      }

                      // Hide times/late for future or Sunday (unless admin provided times via override,
                      // but since overrides are already merged into r, we still hide to match the brief)
                      const blockTimes = future || sunday;

                      const showIn  = !blockTimes ? (r.check_in_kl  ?? '—') : '—';
                      const showOut = !blockTimes ? (r.check_out_kl ?? '—') : '—';
                      const showLate = (!blockTimes && !r.override && r.late_min && r.late_min > 0) ? r.late_min : '—';

                      return (
                        <tr key={`${group.key}-${r.day}`}>
                          <td style={td}>{r.day}</td>
                          <td style={td}>{showIn}</td>
                          <td style={td}>{showOut}</td>
                          <td style={{ ...td, ...(typeof showLate === 'number' ? redCell : {}) }}>
                            {showLate}
                          </td>
                          <td style={td}>{statusEl}</td>
                          {isAdmin && (
                            <td style={td}>
                              <button
                                style={{...btn, padding:'6px 10px'}}
                                onClick={() => openEdit(r)}
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

      {/* -------- Modal -------- */}
      {showModal && editRow && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.35)',
            display:'flex', alignItems:'center', justifyContent:'center', zIndex:50
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeEdit();
          }}
        >
          <div style={{ background:'#fff', borderRadius:10, width:'min(520px, 92vw)', boxShadow:'0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{padding:'14px 16px', borderBottom:'1px solid #eee', fontWeight:700}}>
              Edit times — {editRow.staff_name} • {editRow.day}
            </div>
            <div style={{padding:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div>
                <div style={{fontSize:12, color:'#777', marginBottom:6}}>Check-in (HH:MM, 24h)</div>
                <input
                  style={{...input, width:'100%'}}
                  placeholder="e.g. 09:25"
                  value={editIn}
                  onChange={(e) => setEditIn(e.target.value)}
                />
              </div>
              <div>
                <div style={{fontSize:12, color:'#777', marginBottom:6}}>Check-out (HH:MM, 24h)</div>
                <input
                  style={{...input, width:'100%'}}
                  placeholder="e.g. 18:00"
                  value={editOut}
                  onChange={(e) => setEditOut(e.target.value)}
                />
              </div>
              <div style={{gridColumn:'1 / span 2'}}>
                <div style={{fontSize:12, color:'#777', marginBottom:6}}>Note (optional, short)</div>
                <input
                  style={{...input, width:'100%'}}
                  placeholder="reason / context"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />
              </div>

              {saveErr && (
                <div style={{gridColumn:'1 / span 2', color:'#b00020', marginTop:4}}>{saveErr}</div>
              )}
            </div>
            <div style={{padding:12, display:'flex', justifyContent:'flex-end', gap:8, borderTop:'1px solid #eee'}}>
              <button onClick={closeEdit} style={btn} disabled={saving}>Cancel</button>
              <button
                onClick={saveEdit}
                style={{...btn, background:'#0ea5e9', color:'#fff', borderColor:'#0ea5e9'}}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}