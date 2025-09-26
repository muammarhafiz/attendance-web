'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

type Row = {
  id: string;
  ts: string;          // timestamp column in your table
  staff_id: string;
  staff_name: string | null;
  action: 'Check-in' | 'Check-out';
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// start-of-today (local)
function startOfTodayISO() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.toISOString();
}

export default function TodayPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const fromISO = startOfTodayISO();

    // adjust table/column names if yours differ
    const { data, error } = await supabase
      .from('attendance')
      .select(
        'id, ts, staff_id, staff_name, action, lat, lon, distance_m'
      )
      .gte('ts', fromISO)
      .order('ts', { ascending: false });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows(data as Row[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Today’s Logs</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: '#b91c1c' }}>
          {err}
        </div>
      )}

      {!loading && rows.length === 0 && !err && (
        <p style={{ color: '#666', marginTop: 12 }}>No logs yet today.</p>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ border: '1px solid #ddd', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>{r.staff_name ?? r.staff_id}</strong>
              <span style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: r.action === 'Check-in' ? '#dcfce7' : '#e0f2fe',
                color: '#111'
              }}>
                {r.action}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#555' }}>
              <div>Time: {new Date(r.ts).toLocaleString()}</div>
              {r.distance_m != null && <div>Distance: {Math.round(r.distance_m)} m</div>}
              {(r.lat != null && r.lon != null) && (
                <div>Loc: {r.lat.toFixed(6)}, {r.lon.toFixed(6)}</div>
              )}
              <div style={{ marginTop: 6, fontSize: 12, color: '#777' }}>ID: {r.id}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
