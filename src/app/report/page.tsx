'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type LogRow = {
  ts: string;
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out' | string;
  minutes_late: number | null;
};

type DayRow = {
  dayISO: string;                 // YYYY-MM-DD (KL)
  staff_name: string;
  staff_email: string;
  checkinTs?: string;
  checkoutTs?: string;
  minutes_late: number;
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

function toKLDateISO(ts: string) {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

function fmtKLTime(ts?: string) {
  if (!ts) return '-';
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

export default function ReportPage() {
  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<'logs'|'summary'>('logs');

  // period controls
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>('');

  // admin/staff
  const [isAdmin, setIsAdmin] = useState(false);
  const [staffList, setStaffList] = useState<Staff[]>([]);

  // logs state
  const [rawRows, setRawRows] = useState<LogRow[]>([]);
  const [daily, setDaily] = useState<DayRow[]>([]);
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

      if (email) {
        const { data: adm } = await supabase
          .from('staff')
          .select('is_admin')
          .eq('email', email)
          .maybeSingle();
        setIsAdmin(Boolean(adm?.is_admin));
      }

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
    setRawRows([]);
    setDaily([]);

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

    const logs = (data as LogRow[]) ?? [];

    // Aggregate to 1 row per (day, staff_email)
    const map = new Map<string, DayRow>();
    for (const r of logs) {
      const staffEmail = r.staff_email ?? '';
      const staffName = r.staff_name ?? staffEmail ?? '';
      if (!staffEmail) continue;

      const dayISO = toKLDateISO(r.ts);
      const key = `${dayISO}|${staffEmail}`;

      let g = map.get(key);
      if (!g) {
        g = {
          dayISO,
          staff_name: staffName,
          staff_email: staffEmail,
          minutes_late: 0
        };
        map.set(key, g);
      }

      if (r.action === 'Check-in') {
        if (!g.checkinTs || new Date(r.ts) < new Date(g.checkinTs)) {
          g.checkinTs = r.ts;
          g.minutes_late = Math.max(0, r.minutes_late ?? 0);
        }
      } else if (r.action === 'Check-out') {
        if (!g.checkoutTs || new Date(r.ts) > new Date(g.checkoutTs)) {
          g.checkoutTs = r.ts;
        }
      }
    }

    const list = Array.from(map.values())
      .sort((a, b) => a.dayISO.localeCompare(b.dayISO) || a.staff_name.localeCompare(b.staff_name));

    setRawRows(logs);
    setDaily(list);
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

  const filtered = daily.filter(r => {
    if (!q.trim()) return true;
    const hay = `${r.staff_name}`.toLowerCase();
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
  const row  = { borderBottom: '1px solid #eee' } as const;
  const th   = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' } as const;
  const td   = { padding: '10px 12px', verticalAlign: 'top' } as const;
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
            placeholder="Filter by staff name…"
            value={q}
            onChange={e=>setQ(e.target.value)}
            style={{width:'100%', padding:12, border:'1px solid #d1d5db', borderRadius:8, marginBottom:8}}
          />

          {err && <div style={{color:'#b91c1c', margin:'8px 0'}}>Failed to load report: {err}</div>}

          <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8, marginBottom:16}}>
            <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
              <thead>
                <tr>
                  <th style={th}>Date (KL)</th>
                  <th style={th}>Staff</th>
                  <th style={th}>Check-in</th>
                  <th style={th}>Check-out</th>
                  <th style={th}>Late (min)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{...td, color:'#6b7280'}}>No rows.</td></tr>
                )}
                {filtered.map((r, i) => (
                  <tr key={i} style={{...row, background: r.minutes_late > 0 ? '#fff1f2' : undefined}}>
                    <td style={td}>{r.dayISO}</td>
                    <td style={td}>{r.staff_name}</td>
                    <td style={td}>{fmtKLTime(r.checkinTs)}</td>
                    <td style={td}>{fmtKLTime(r.checkoutTs)}</td>
                    <td style={td}>{r.minutes_late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Admin panel for Absent/MC/Offday */}
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
                onChange={(e) => setSelStatus(e.target.value as DayStatus)}
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