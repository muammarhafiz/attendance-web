'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Row = {
  id: string;
  staff_id: string;
  staff_name: string | null;
  action: 'Check-in' | 'Check-out';
  ts: string; // ISO
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
  day: string; // YYYY-MM-DD
};

export default function TodayPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchToday = async () => {
    setLoading(true); setErr(null);
    // KL date string YYYY-MM-DD
    const d = new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).replaceAll('/', '-'); // en-CA already uses "-"; just safe
    const today = d; // e.g. 2025-09-26

    const { data, error } = await supabase
      .from('attendance')
      .select('id,staff_id,staff_name,action,ts,lat,lon,distance_m,day')
      .eq('day', today)
      .order('ts', { ascending: false });

    if (error) setErr(error.message);
    else setRows(data as Row[]);
    setLoading(false);
  };

  useEffect(() => { fetchToday(); }, []);

  return (
    <main style={{ padding:16, fontFamily:'system-ui' }}>
      <h2>Today</h2>
      <button onClick={fetchToday} style={{padding:'8px 12px', borderRadius:8, border:'1px solid #ccc', margin:'8px 0'}}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      {err && <div style={{color:'red'}}>{err}</div>}
      {rows.length === 0 && !loading && <div>No records today.</div>}
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse'}}>
          <thead>
            <tr>
              <th style={th}>Time (KL)</th>
              <th style={th}>Staff</th>
              <th style={th}>Action</th>
              <th style={th}>Distance (m)</th>
              <th style={th}>Map</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={td}>{new Date(r.ts).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12:false })}</td>
                <td style={td}>{r.staff_name || r.staff_id}</td>
                <td style={td}>{r.action}</td>
                <td style={td}>{r.distance_m ?? '-'}</td>
                <td style={td}>
                  {r.lat && r.lon ? (
                    <a href={`https://maps.google.com/?q=${r.lat},${r.lon}`} target="_blank">Open</a>
                  ) : '-' }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const th: React.CSSProperties = { textAlign:'left', borderBottom:'1px solid #ddd', padding:'8px' };
const td: React.CSSProperties = { borderBottom:'1px solid #eee', padding:'8px' };
