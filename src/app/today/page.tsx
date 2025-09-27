'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  id: number;
  timestamp: string;           // ISO
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out';
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #eee' };
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f3f3f3' };
const btn: React.CSSProperties = { padding: '10px 14px', border: '1px solid #ccc', borderRadius: 8, background: '#fff' };

export default function TodayPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [email, setEmail] = useState<string | null>(null);

  // session email
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, []);

  const reload = async () => {
    setLoading(true);
    setErr('');
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('attendance')
        .select('id,timestamp,staff_name,staff_email,action,distance_m,lat,lon')
        .gte('timestamp', start.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw new Error(error.message);
      setRows((data ?? []) as Row[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  // initial load
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      r =>
        (r.staff_name ?? '').toLowerCase().includes(f) ||
        (r.staff_email ?? '').toLowerCase().includes(f)
    );
  }, [rows, filter]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour12: false,
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Today’s Logs</h2>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ opacity: 0.9 }}>{email ?? '—'}</div>
        <button style={btn} onClick={signOut}>Sign out</button>
        <button style={btn} onClick={() => { setFilter(''); }}>Clear</button>
        <input
          placeholder="Filter by staff name..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: 10, border: '1px solid #ccc', borderRadius: 8, minWidth: 220, flex: '1 1 220px' }}
        />
        <button style={btn} onClick={reload} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {err && (
        <div style={{ color: '#b91c1c', margin: '6px 0 10px' }}>
          {err}
        </div>
      )}

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
        <tbody>
          {filtered.length === 0 ? (
            <tr><td style={td} colSpan={6}>No logs yet today.</td></tr>
          ) : filtered.map(r => (
            <tr key={r.id}>
              <td style={td}>{fmtTime(r.timestamp)}</td>
              <td style={td}>{r.staff_name || r.staff_email || '—'}</td>
              <td style={td}>{r.action}</td>
              <td style={td}>{typeof r.distance_m === 'number' ? Math.round(r.distance_m) : '—'}</td>
              <td style={td}>
                {(r.lat != null && r.lon != null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '—'}
              </td>
              <td style={td}>
                {(r.lat != null && r.lon != null) ? (
                  <a
                    href={`https://maps.google.com/?q=${r.lat},${r.lon}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}