'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type AttRow = {
  id: string;
  staff_name: string | null;
  staff_email: string;
  action: 'in' | 'out';
  ts: string;          // timestamptz -> ISO string
  day: string;         // date (YYYY-MM-DD)
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

type PerStaff = {
  name: string;
  email: string;
  checkIn?: Date;
  checkOut?: Date;
  lateMin?: number;
};

const fmtKL = (d?: Date) =>
  d ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).format(d) : '—';

const LATE_CUTOFF_H = 9;
const LATE_CUTOFF_M = 30;

export default function Today() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AttRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const todayISO = useMemo(() => {
    // Use KL date to match your DB “day” (which is date without tz).
    const now = new Date();
    const klDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now); // YYYY-MM-DD
    return klDateStr;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('attendance')
      .select('id, staff_name, staff_email, action, ts, day, distance_m, lat, lon')
      .eq('day', todayISO)
      .order('ts', { ascending: true });

    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as AttRow[]);
    }
    setLoading(false);
  }, [todayISO]);

  useEffect(() => {
    load();
  }, [load]);

  // Group to one row per staff for today
  const perStaff: PerStaff[] = useMemo(() => {
    const map = new Map<string, PerStaff>();
    for (const r of rows) {
      const key = r.staff_email;
      const rec = map.get(key) ?? {
        name: r.staff_name ?? r.staff_email.split('@')[0],
        email: r.staff_email,
      };
      const ts = new Date(r.ts);
      if (r.action === 'in') {
        // first check-in
        if (!rec.checkIn || ts < rec.checkIn) rec.checkIn = ts;
      } else if (r.action === 'out') {
        // last check-out
        if (!rec.checkOut || ts > rec.checkOut) rec.checkOut = ts;
      }
      map.set(key, rec);
    }
    // compute late minutes from KL 09:30
    for (const rec of map.values()) {
      if (rec.checkIn) {
        const d = rec.checkIn;
        // Build a KL "09:30" for that same calendar day
        const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric' }).format(d);
        const m = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit' }).format(d);
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit' }).format(d);
        const cutoffStr = `${y}-${m}-${day}T${String(LATE_CUTOFF_H).padStart(2,'0')}:${String(LATE_CUTOFF_M).padStart(2,'0')}:00`;
        const cutoff = new Date(cutoffStr + '+08:00'); // KL offset
        const diffMin = Math.max(0, Math.round((d.getTime() - cutoff.getTime()) / 60000));
        rec.lateMin = diffMin || undefined;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Today</h2>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        {loading ? <span>Loading…</span> : <button onClick={load}>Reload</button>}
        <span>KL Date: {todayISO}</span>
      </div>

      {error && <div style={{ color: 'crimson', marginBottom: 8 }}>{error}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Date (KL)</th>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Staff</th>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Check-in</th>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Check-out</th>
              <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Late (min)</th>
            </tr>
          </thead>
          <tbody>
            {perStaff.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 12, color: '#555' }}>No rows.</td>
              </tr>
            )}
            {perStaff.map((r) => {
              const lateStyle = r.lateMin && r.lateMin > 0 ? { color: '#a00', fontWeight: 600 } : undefined;
              return (
                <tr key={r.email}>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{todayISO}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.name}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{fmtKL(r.checkIn)}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{fmtKL(r.checkOut)}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee', ...lateStyle }}>
                    {r.lateMin ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}