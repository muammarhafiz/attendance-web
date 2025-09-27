'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

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
  // --- state ---
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- load data ---
  const reload = useCallback(async () => {
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
  }, [year, month, day]);

  useEffect(() => {
    // initial load
    reload();
  }, [reload]);

  // --- filtering ---
  const filtered = rows.filter(r => {
    if (!q.trim()) return true;
    const hay = `${r.staff_name ?? ''} ${r.staff_email ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  // --- print ---
  const handlePrint = () => window.print();

  // --- styles ---
  const wrap = { maxWidth: 1000, margin: '0 auto', padding: 16, fontFamily: 'system-ui' } as const;
  const row = { borderBottom: '1px solid #eee' } as const;
  const th  = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' } as const;
  const td  = { padding: '10px 12px' } as const;
  const pill = { padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff' } as const;
  const badge = (ok: boolean | null) =>
    ({ display:'inline-block', padding:'2px 8px', borderRadius:9999, background: ok ? '#fee2e2' : '#e5f6ff', border:'1px solid #e5e7eb' } as const);

  return (
    <main style={wrap}>
      {/* print-only CSS */}
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
          <input
            type="number"
            value={year}
            onChange={e=>setYear(parseInt(e.target.value || '0') || now.getFullYear())}
            style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:100}}
          />
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Month</div>
          <input
            type="number"
            value={month}
            onChange={e=>setMonth(Math.max(1, Math.min(12, parseInt(e.target.value || '0') || month)))}
            style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:80}}
          />
        </div>
        <div>
          <div style={{fontSize:12, color:'#6b7280'}}>Day (optional)</div>
          <input
            placeholder="optional"
            value={day}
            onChange={e=>{
              const v = e.target.value.trim();
              if (v === '') setDay('');
              else setDay(Math.max(1, Math.min(31, parseInt(v) || 1)));
            }}
            style={{padding:10, border:'1px solid #d1d5db', borderRadius:8, width:110}}
          />
        </div>

        <button onClick={reload} disabled={loading} style={pill}>
          {loading ? 'Loading…' : 'Reload'}
        </button>

        <button onClick={handlePrint} style={pill}>Print / Save PDF</button>

        <div style={{marginLeft:8, color:'#6b7280'}}>
          Period: <b>{String(month).padStart(2,'0')}/{year}</b>{day!=='' ? `, Day ${day}`:''}
        </div>
      </div>

      <input
        className="no-print"
        placeholder="Filter by staff name/email…"
        value={q}
        onChange={e=>setQ(e.target.value)}
        style={{width:'100%', padding:12, border:'1px solid #d1d5db', borderRadius:8, marginBottom:8}}
      />

      {err && <div style={{color:'#b91c1c', margin:'8px 0'}}>Failed to load report: {err}</div>}

      {/* Table */}
      <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8}}>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
          <thead>
            <tr>
              <th style={th}>Date/Time (KL)</th>
              <th style={th}>Staff</th>
              <th style={th}>Email</th>
              <th style={th}>Action</th>
              <th style={th}>Distance (m)</th>
              <th style={th}>Late</th>
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
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: 'Asia/Kuala_Lumpur'
              }).format(d);
              const locText = (r.lat!=null && r.lon!=null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '-';
              const gmaps = (r.lat!=null && r.lon!=null)
                ? `https://www.google.com/maps?q=${r.lat},${r.lon}`
                : null;
              const late = Boolean(r.is_late) && r.action === 'Check-in';
              const danger = late;

              return (
                <tr key={i} style={{...row, background: danger ? '#fff1f2' : undefined}}>
                  <td style={td}>{kl}</td>
                  <td style={td}>{r.staff_name ?? '-'}</td>
                  <td style={td}>{r.staff_email ?? '-'}</td>
                  <td style={td}>{r.action}</td>
                  <td style={td}>{r.distance_m ?? '-'}</td>
                  <td style={td}>
                    <span style={badge(late)}>{late ? 'Yes' : 'No'}</span>
                  </td>
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