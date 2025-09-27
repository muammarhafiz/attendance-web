'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  id: string;
  ts: string;                 // timestamp column
  day: string | null;         // date column
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out';
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

const box: React.CSSProperties = { padding: 16, fontFamily: 'system-ui' };
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const btn: React.CSSProperties = { padding: '10px 14px', border: '1px solid #ccc', borderRadius: 8, background: '#fff' };
const input: React.CSSProperties = { padding: '10px 12px', border: '1px solid #ccc', borderRadius: 8, flex: '1 1 280px' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', marginTop: 12 };
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ddd', padding: '10px 8px' };
const td: React.CSSProperties = { borderBottom: '1px solid #f0f0f0', padding: '10px 8px', verticalAlign: 'top' };

const fmtKL = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour12: false,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function TodayPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // get current session email
  useEffect(() => {
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setEmail(session?.user?.email ?? null);
    };
    run();
  }, []);

  const load = async () => {
    setBusy(true);
    setErr(null);

    // Start of “today” in KL time; we’ll filter by ts >= start
    const now = new Date();
    const kl = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const y = kl.find(p => p.type === 'year')!.value;
    const m = kl.find(p => p.type === 'month')!.value;
    const d = kl.find(p => p.type === 'day')!.value;
    const startISO = new Date(`${y}-${m}-${d}T00:00:00+08:00`).toISOString();

    let query = supabase
      .from('attendance')
      .select('id,ts,day,staff_name,staff_email,action,distance_m,lat,lon')
      .gte('ts', startISO)              // use ts (not created_at/timestamp)
      .order('ts', { ascending: true });

    if (q.trim()) query = query.ilike('staff_name', `%${q.trim()}%`);

    const { data, error } = await query;
    if (error) setErr(error.message);
    else setRows((data ?? []) as Row[]);
    setBusy(false);
  };

  useEffect(() => { load(); /* initial load */ }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.assign('/login');
  };

  return (
    <main style={box}>
      <h2>Today’s Logs</h2>

      <div style={row}>
        <span style={{ opacity: 0.7 }}>{email ?? 'Not signed in'}</span>
        <button style={btn} onClick={signOut}>Sign out</button>
        <button style={btn} onClick={() => { setQ(''); load(); }}>Clear</button>
        <input
          style={input}
          placeholder="Filter by staff name..."
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(); }}
        />
        <button style={btn} onClick={load} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {err && <div style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div>}

      <table style={table}>
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
          {rows.length === 0 && (
            <tr><td style={td} colSpan={6}>No logs yet today.</td></tr>
          )}
          {rows.map(r => (
            <tr key={r.id}>
              <td style={td}>{fmtKL(r.ts)}</td>
              <td style={td}>
                <div>{r.staff_name ?? '-'}</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>{r.staff_email ?? ''}</div>
              </td>
              <td style={td}>{r.action}</td>
              <td style={td}>{r.distance_m ?? '-'}</td>
              <td style={td}>
                {r.lat != null && r.lon != null ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '-'}
              </td>
              <td style={td}>
                {r.lat != null && r.lon != null ? (
                  <a
                    href={`https://www.google.com/maps?q=${r.lat},${r.lon}`}
                    target="_blank" rel="noreferrer"
                  >
                    Open
                  </a>
                ) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}