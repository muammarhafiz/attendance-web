'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  id: number;
  timestamp: string;        // timestamptz
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out';
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

export default function TodayPage() {
  const [meEmail, setMeEmail] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      setMeEmail(data.session.user.email ?? '');
      await reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = async () => {
    setLoading(true);
    setErr('');
    try {
      // local midnight -> ISO -> use as lower bound
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('attendance')
        .select('id,timestamp,staff_name,staff_email,action,distance_m,lat,lon')
        .gte('timestamp', start.toISOString())
        .order('timestamp', { ascending: true });

      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r =>
      (r.staff_name ?? '').toLowerCase().includes(needle) ||
      (r.staff_email ?? '').toLowerCase().includes(needle)
    );
  }, [rows, q]);

  const fmtKL = (iso: string) =>
    new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });

  const wrap = { padding: 16, fontFamily: 'system-ui', maxWidth: 960, margin: '0 auto' } as const;
  const btn = { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' } as const;
  const input = { padding: 10, border: '1px solid #ddd', borderRadius: 8, minWidth: 240 } as const;
  const thtd = { padding: '10px 8px', borderBottom: '1px solid #eee', textAlign: 'left' } as const;

  return (
    <main style={wrap}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: '1 0 auto' }}>Today&apos;s Logs</h2>
        <div style={{ color: '#555' }}>{meEmail || '—'}</div>
        <button style={btn} onClick={() => setQ('')}>Clear</button>
        <input
          placeholder="Filter by staff name…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={input}
        />
        <button style={btn} onClick={reload} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <button
          style={btn}
          onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}
        >
          Sign out
        </button>
      </div>

      {err && <div style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div>}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
          <tr>
            <th style={thtd}>Time (KL)</th>
            <th style={thtd}>Staff</th>
            <th style={thtd}>Action</th>
            <th style={thtd}>Distance (m)</th>
            <th style={thtd}>Location</th>
            <th style={thtd}>Map</th>
          </tr>
          </thead>
          <tbody>
          {filtered.length === 0 ? (
            <tr><td style={{ ...thtd, color: '#666' }} colSpan={6}>No logs yet today.</td></tr>
          ) : filtered.map(r => (
            <tr key={r.id}>
              <td style={thtd}>{fmtKL(r.timestamp)}</td>
              <td style={thtd}>
                {r.staff_name || '(no name)'}
                <div style={{ color: '#666', fontSize: 12 }}>{r.staff_email}</div>
              </td>
              <td style={thtd}>{r.action}</td>
              <td style={thtd}>{r.distance_m ?? '—'}</td>
              <td style={thtd}>
                {r.lat != null && r.lon != null ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '—'}
              </td>
              <td style={thtd}>
                {r.lat != null && r.lon != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${r.lat},${r.lon}`}
                    target="_blank" rel="noreferrer"
                  >
                    Open
                  </a>
                ) : '—'}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}