'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type Row = {
  id: string;
  ts: string;
  staff_id: string;
  staff_name: string | null;
  action: 'Check-in' | 'Check-out';
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
};

const KL_TZ = 'Asia/Kuala_Lumpur';
function isSameKLDay(tsISO: string): boolean {
  const nowKL = new Date().toLocaleDateString('en-CA', { timeZone: KL_TZ });
  const dKL = new Date(tsISO).toLocaleDateString('en-CA', { timeZone: KL_TZ });
  return dKL === nowKL;
}
function fmtKL(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', { timeZone: KL_TZ, hour12: false });
}

export default function TodayPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  // Auth gate
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) window.location.href = '/login';
      else setEmail(data.session.user.email ?? null);
    });
  }, []);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('attendance')
      .select('id, ts, staff_id, staff_name, action, lat, lon, distance_m')
      .order('ts', { ascending: false });

    if (error) { setErr(error.message); setRows([]); }
    else {
      const list = (data ?? []) as Row[];
      setRows(list.filter(r => isSameKLDay(r.ts)));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return rows;
    return rows.filter(r => {
      const label = (r.staff_name ?? r.staff_id).toLowerCase();
      return label.includes(q);
    });
  }, [rows, filter]);

  const table = useMemo(() => {
    if (filtered.length === 0) {
      return (
        <tr>
          <td colSpan={6} style={{ padding: 12, color: '#666' }}>
            {rows.length === 0 ? 'No logs yet today.' : 'No matches for the current filter.'}
          </td>
        </tr>
      );
    }
    return filtered.map((r) => (
      <tr key={r.id}>
        <td style={td}>{fmtKL(r.ts)}</td>
        <td style={td}>{r.staff_name ?? r.staff_id}</td>
        <td style={td}>{r.action}</td>
        <td style={td}>{r.distance_m != null ? Math.round(r.distance_m) : '-'}</td>
        <td style={td}>
          {(r.lat != null && r.lon != null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '-'}
        </td>
        <td style={td}>
          {(r.lat != null && r.lon != null)
            ? <a href={`https://maps.google.com/?q=${r.lat},${r.lon}`} target="_blank" rel="noreferrer">Open</a>
            : '-'}
        </td>
      </tr>
    ));
  }, [filtered, rows.length]);

  const signOut = async () => { await supabase.auth.signOut(); window.location.href = '/login'; };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Today’s Logs</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {email && <span style={{ fontSize: 13, color: '#555' }}>{email}</span>}
          <button onClick={() => setFilter('')} disabled={filter.length === 0} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}>Clear</button>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by staff name…" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', minWidth: 220 }} />
          <button onClick={load} disabled={loading} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button onClick={signOut} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}>Sign out</button>
        </div>
      </div>

      {err && <div style={{ marginTop: 12, color: '#b91c1c' }}>{err}</div>}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Time (KL)</th>
              <th style={th}>Staff</th>
              <th style={th}>Action</th>
              <th style={th}>Distance (m)</th>
              <th style={th}>Location</th>
              <th style={th}>Map</th>
            </tr>
          </thead>
          <tbody>{table}</tbody>
        </table>
      </div>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8, background: '#fafafa' };
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: 8 };