'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

type Row = {
  id: string;
  ts: string;                          // timestamp with time zone
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

// KL time helpers
const KL_TZ = 'Asia/Kuala_Lumpur';
function isSameKLDday(tsISO: string): boolean {
  const nowKL = new Date().toLocaleDateString('en-CA', { timeZone: KL_TZ });
  const dKL = new Date(tsISO).toLocaleDateString('en-CA', { timeZone: KL_TZ });
  return dKL === nowKL; // YYYY-MM-DD strings
}

function fmtKL(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', { timeZone: KL_TZ, hour12: false });
}

export default function TodayPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(''); // staff name filter

  const load = async () => {
    setLoading(true);
    setErr(null);

    // Query attendance. If your RLS limits to today, this returns only today's rows.
    const { data, error } = await supabase
      .from('attendance')
      .select('id, ts, staff_id, staff_name, action, lat, lon, distance_m')
      .order('ts', { ascending: false });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      const list = (data ?? []) as Row[];
      setRows(list.filter(r => isSameKLDday(r.ts)));
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
          {(r.lat != null && r.lon != null)
            ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`
            : '-'}
        </td>
        <td style={td}>
          {(r.lat != null && r.lon != null)
            ? <a href={`