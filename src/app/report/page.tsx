'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type Row = {
  ts: string;
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out' | string;
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
  is_late: boolean | null;
};

export default function ReportPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // (optional) show who is signed in on the right of the global NavBar if you want
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
    };
    init();
  }, []);

  const reload = async () => {
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
    setRows((data as Row[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { reload(); /* run once */ }, []); // eslint-disable-line

  const filtered = rows.filter(r => {
    if (!q.trim()) return true;
    const hay = `${r.staff_name ?? ''} ${r.staff_email ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const wrap = { maxWidth: 1000, margin: '0 auto', padding: 16, fontFamily: 'system-ui' } as const;
  const row = { borderBottom: '1px solid #eee' } as const;
  const th  = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' } as const;
  const td  = { padding: '10px 12px' } as const;
  const pill = { padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff' } as const;

  return (
    <main style={wrap}>
      <h2 style={{margin:'8px 0 12px'}}>Attendance Report</h2>

      <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Year</div>
          <input type="number" value={year}
            onChange={e=>setYear(parseInt(e.target.value||'0')||now.getFullYear())}
            style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:100}}/>
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Month</div>
          <input type="number" value={month}
            onChange={e=>setMonth(Math.max(1, Math.min(12, parseInt(e.target.value||'0')||month)))}
            style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:80}}/>
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Day (optional)</div>
          <input placeholder="optional"
            value={day}
            onChange={e=>{
              const v = e.target.value.trim();
              if (v === '') setDay('');
              else setDay(Math.max(1, Math.min(31, parseInt(v)||1)));
            }}
            style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:110}}/>
        </div>

        <button onClick={reload} disabled={loading} style={pill}>{loading ? 'Loading…' : 'Reload'}</button>

        <div style={{marginLeft:8, color:'#6b7280'}}>Period: <b>{String(month).padStart(2,'0')}/{year}</b>{day!=='' ? `, Day ${day}`:''}</div>
      </div>

      <input placeholder="Filter by staff name/email…" value={q} onChange={e=>setQ(e.target.value)}
        style={{width:'100%', padding:12, border:'1px solid #d1d5db', borderRadius:8, marginBottom:8}}/>

      {err && <div style={{color:'#b91c1c', margin:'8px 0'}}>Failed to load report: {err}</div>}

      <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8}}>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
          <thead>
            <tr>
              <th style={th}>Date/Time (KL)</th>
              <th style={th}>Staff</th>
              <th style={th}>Email</th>
              <th style={th}>Action</th>
              <th style={th}>Distance (m)</th>
              <th style={th}>Loc</th>
              <th style={th}>Map</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{...td, color:'#6b7280'}}>No rows.</td></tr>
            )}
            {filtered.map((r, i) => {
              const d = new Date(r.ts);
              const kl = new Intl.DateTimeFormat('en-MY', {
                dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur'
              }).format(d);
              const locText = (r.lat!=null && r.lon!=null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '-';
              const gmaps = (r.lat!=null && r.lon!=null)
                ? `https://www.google.com/maps?q=${r.lat},${r.lon}`
                : null;
              const danger = r.is_late && r.action === 'Check-in';
              return (
                <tr key={i} style={{...row, background: danger ? '#fff1f2' : undefined}}>
                  <td style={td}>{kl}</td>
                  <td style={td}>{r.staff_name ?? '-'}</td>
                  <td style={td}>{r.staff_email ?? '-'}</td>
                  <td style={td}>{r.action}</td>
                  <td style={td}>{r.distance_m ?? '-'}</td>
                  <td style={td}>{locText}</td>
                  <td style={td}>{gmaps ? <a href={gmaps} target="_blank" rel="noreferrer">Open</a> : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}