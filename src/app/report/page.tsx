'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type LogRow = {
  ts: string;
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out' | string;
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
  is_late: boolean | null;
  minutes_late: number | null;
};

type SummaryRow = {
  staff_email: string;
  staff_name: string | null;
  total_minutes_late: number;
  absent_days: number;
  mc_days: number;
  off_days: number;
};

type Staff = { email: string; name: string | null; is_admin: boolean };
type DayStatus = 'ABSENT' | 'MC' | 'OFFDAY';

export default function ReportPage() {
  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<'logs' | 'summary'>('logs');

  // period controls
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>('');

  // admin/staff
  const [isAdmin, setIsAdmin] = useState(false);
  const [staffList, setStaffList] = useState<Staff[]>([]);

  // logs state
  const [rows, setRows] = useState<LogRow[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // summary state
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  // admin panel state
  const [selEmail, setSelEmail] = useState('');
  const [selDate, setSelDate] = useState<string>(''); // yyyy-mm-dd
  const [selStatus, setSelStatus] = useState<DayStatus>('ABSENT');
  const [selNote, setSelNote] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // init admin + staff list
  useEffect(() => {
    const boot = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email ?? null;

      // is admin?
      if (email) {
        const { data: adm } = await supabase
          .from('staff')
          .select('is_admin')
          .eq('email', email)
          .maybeSingle();
        setIsAdmin(Boolean(adm?.is_admin));
      }

      // staff list
      const { data: st, error } = await supabase
        .from('staff')
        .select('email,name,is_admin')
        .order('name', { ascending: true });
      if (!error && st) setStaffList(st as Staff[]);
    };
    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const email = s?.user?.email ?? null;
      if (!email) setIsAdmin(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const reloadLogs = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setRows([]);

    const { data, error } = await supabase.rpc('month_attendance', {
      p_year: year,
      p_month: month,
      p_day: day === '' ? null : day,
    });

    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }
    setRows((data as LogRow[]) ?? []);
    setLoading(false);
  }, [year, month, day]);

  const reloadSummary = useCallback(async () => {
    setSumLoading(true);
    setSumErr(null);
    setSummary([]);

    const { data, error } = await supabase.rpc('month_summary', {
      p_year: year,
      p_month: month,
    });

    if (error) {
      setSumErr(error.message);
      setSumLoading(false);
      return;
    }
    setSummary((data as SummaryRow[]) ?? []);
    setSumLoading(false);
  }, [year, month]);

  useEffect(() => {
    void reloadLogs();
    void reloadSummary();
  }, [reloadLogs, reloadSummary]);

  const filtered = rows.filter(r => {
    if (!q.trim()) return true;
    const hay = `${r.staff_name ?? ''} ${r.staff_email ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const handlePrint = () => window.print();

  const saveStatus = async () => {
    setSaveMsg(null);
    if (!isAdmin) { setSaveMsg('Only admin can set day status'); return; }
    if (!selEmail || !selDate || !selStatus) { setSaveMsg('Pick staff, date, and status'); return; }
    const { error } = await supabase.rpc('set_day_status', {
      p_email: selEmail,
      p_day: selDate,
      p_status: selStatus,
      p_note: selNote || null
    });
    if (error) { setSaveMsg(error.message); return; }
    setSaveMsg('Saved');
    setSelNote('');
    void reloadSummary();
  };

  // styles
  const wrap = { maxWidth: 1100, margin: '0 auto', padding: 16, fontFamily: 'system-ui' } as const;
  const row = { borderBottom: '1px solid #eee' } as const;
  const th  = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' } as const;
  const td  = { padding: '10px 12px', verticalAlign: 'top' } as const;
  const pill = { padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff' } as const;

  const onStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as DayStatus;
    setSelStatus(v);
  };

  return (
    <main style={wrap}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          table { page-break-inside: avoid; }
        }
      `}</style>

      <h2 style={{margin:'8px 0 12px'}}>Attendance Report</h2>

      {/* Controls */}
      <div className="no-print" style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Year</div>
          <input type="number" value={year}
                 onChange={e=>setYear(parseInt(e.target.value || '0') || now.getFullYear())}
                 style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:100}}/>
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Month</div>
          <input type="number" value={month}
                 onChange={e=>setMonth(Math.max(1, Math.min(12, parseInt(e.target.value||'0') || month)))}
                 style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:80}}/>
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Day (optional)</div>
          <input placeholder="optional" value={day}
                 onChange={e=>{
                   const v = e.target.value.trim();
                   if (v === '') setDay('');
                   else setDay(Math.max(1, Math.min(31, parseInt(v) || 1)));
                 }}
                 style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:110}}/>
        </div>

        <button onClick={()=>{void reloadLogs(); void reloadSummary();}} disabled={loading || sumLoading} style={pill}>
          {(loading || sumLoading) ? 'Loading…' : 'Reload'}
        </button>
        <button onClick={handlePrint} style={pill}>Print / Save PDF</button>

        <div style={{marginLeft:8, color:'#6b7280'}}>
          Period: <b>{String(month).padStart(2,'0')}/{year}</b>{day!=='' ? `, Day ${day}`:''}
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print" style={{display:'flex', gap:8, marginBottom:12}}>
        <button onClick={()=>setTab('logs')}    style={{...pill, background: tab==='logs' ? '#e5f6ff' : '#fff'}}>Logs</button>
        <button onClick={()=>setTab('summary')} style={{...pill, background: tab==='summary' ? '#e5f6ff' : '#fff'}}>Summary</button>
      </div>

      {tab === 'logs' && (
        <>
          <input
            className="no-print"
            placeholder="Filter by staff name/email…"
            value={q}
            onChange={e=>setQ(e.target.value)}
            style={{width:'100%', padding:12, border:'1px solid #d1d5db', borderRadius:8, marginBottom:8}}
          />

          {err && <div style={{color:'#b91c1c', margin:'8px 0'}}>Failed to load report: {err}</div>}

          <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8, marginBottom:16}}>
            <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
              <thead>
                <tr>
                  <th style={th}>Date/Time (KL)</th>
                  <th style={th}>Staff</th>
                  <th style={th}>Email</th>
                  <th style={th}>Action</th>
                  <th style={th}>Distance (m)</th>
                  <th style={th}>Late (min)</th>
                  <th style={th}>Loc</th>
                  <th style={th}>Map</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{...td, color:'#6b7280'}}>No rows.</td></tr>
                )}
                {filtered.map((r, i) => {
                  const d = new Date(r.ts);
                  const kl = new Intl.DateTimeFormat('en-MY', {
                    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur'
                  }).format(d);
                  const mins = (r.action === 'Check-in' ? (r.minutes_late ?? 0) : 0);
                  const locText = (r.lat!=null && r.lon!=null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '-';
                  const gmaps = (r.lat!=null && r.lon!=null) ? `https://www.google.com/maps?q=${r.lat},${r.lon}` : null;
                  return (
                    <tr key={i} style={{...row, background: mins > 0 ? '#fff1f2' : undefined}}>
                      <td style={td}>{kl}</td>
                      <td style={td}>{r.staff_name ?? '-'}</td>
                      <td style={td}>{r.staff_email ?? '-'}</td>
                      <td style={td}>{r.action}</td>
                      <td style={td}>{r.distance_m ?? '-'}</td>
                      <td style={td}>{mins}</td>
                      <td style={td}>{locText}</td>
                      <td style={td}>{gmaps ? <a href={gmaps} target="_blank" rel="noreferrer">Open</a> : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Admin panel to set Absent/MC/Offday */}
          <div className="no-print" style={{border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'#fcfcfc'}}>
            <div style={{fontWeight:600, marginBottom:8}}>Admin: Set day status (Absent / MC / Offday)</div>
            {!isAdmin && <div style={{color:'#b91c1c'}}>You are not an admin.</div>}
            <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
              <select
                value={selEmail}
                onChange={(e) => setSelEmail(e.target.value)}
                style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, minWidth:240}}
              >
                <option value="">Select staff…</option>
                {staffList.map(s => (
                  <option key={s.email} value={s.email}>{s.name ?? s.email} — {s.email}</option>
                ))}
              </select>

              <input
                type="date"
                value={selDate}
                onChange={(e) => setSelDate(e.target.value)}
                style={{padding:10, border:'1px solid #d1d5db', borderRadius:8}}
              />

              <select
                value={selStatus}
                onChange={onStatusChange}
                style={{padding:10, border:'1px solid #d1d5db', borderRadius:8}}
              >
                <option value="ABSENT">ABSENT</option>
                <option value="MC">MC</option>
                <option value="OFFDAY">OFFDAY</option>
              </select>

              <input
                placeholder="note (optional)"
                value={selNote}
                onChange={(e) => setSelNote(e.target.value)}
                style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, minWidth:240}}
              />

              <button onClick={saveStatus} disabled={!isAdmin} style={pill}>Save</button>
              {saveMsg && <span style={{marginLeft:8, color: saveMsg==='Saved' ? '#16a34a' : '#b91c1c'}}>{saveMsg}</span>}
            </div>
          </div>
        </>
      )}

      {tab === 'summary' && (
        <>
          {sumErr && <div style={{color:'#b91c1c', margin:'8px 0'}}>Failed to load summary: {sumErr}</div>}
          <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8}}>
            <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
              <thead>
                <tr>
                  <th style={th}>Staff</th>
                  <th style={th}>Email</th>
                  <th style={th}>Late (total min)</th>
                  <th style={th}>Absent (days)</th>
                  <th style={th}>MC (days)</th>
                  <th style={th}>Offday (days)</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 && (
                  <tr><td colSpan={6} style={{...td, color:'#6b7280'}}>No data.</td></tr>
                )}
                {summary.map((r, i) => (
                  <tr key={i} style={row}>
                    <td style={td}>{r.staff_name ?? '-'}</td>
                    <td style={td}>{r.staff_email}</td>
                    <td style={td}>{r.total_minutes_late}</td>
                    <td style={td}>{r.absent_days}</td>
                    <td style={td}>{r.mc_days}</td>
                    <td style={td}>{r.off_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}