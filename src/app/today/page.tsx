'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type LogRow = {
  ts: string;
  staff_name: string | null;
  staff_email: string | null;
  action: 'Check-in' | 'Check-out' | string;
  minutes_late: number | null;
};

type DayRow = {
  dayISO: string;                 // YYYY-MM-DD (KL)
  staff_name: string;
  staff_email: string;
  checkinTs?: string;             // ISO string
  checkoutTs?: string;            // ISO string
  minutes_late: number;           // for check-in (0 if none)
};

function toKLDateISO(ts: string) {
  // Format ts to YYYY-MM-DD in Asia/Kuala_Lumpur
  const d = new Date(ts);
  const fmt = new Intl.DateTimeFormat('en-CA', { // en-CA yields YYYY-MM-DD
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value ?? '0000';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

function fmtKLTime(ts?: string) {
  if (!ts) return '-';
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

export default function TodayPage() {
  const now = useMemo(() => new Date(), []);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [daily, setDaily] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Derive today's KL year/month/day
  const { y, m, d } = useMemo(() => {
    const kl = new Date(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
        .format(now)
    );
    // Above trick loses exact yyyy-mm-dd; instead compute via formatter:
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = fmt.formatToParts(now);
    const yy = Number(parts.find(p => p.type === 'year')?.value ?? '1970');
    const mm = Number(parts.find(p => p.type === 'month')?.value ?? '1');
    const dd = Number(parts.find(p => p.type === 'day')?.value ?? '1');
    return { y: yy, m: mm, d: dd };
  }, [now]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setRows([]);
    setDaily([]);

    // Use your existing RPC but for *today* only
    const { data, error } = await supabase.rpc('month_attendance', {
      p_year: y,
      p_month: m,
      p_day: d
    });

    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }

    const logs = (data as LogRow[]) ?? [];

    // Aggregate to 1 row per (day, staff_email)
    const map = new Map<string, DayRow>();
    for (const r of logs) {
      const staffEmail = r.staff_email ?? '';
      const staffName = r.staff_name ?? staffEmail ?? '';
      if (!staffEmail) continue; // skip unexpected nulls

      const dayISO = toKLDateISO(r.ts);
      const key = `${dayISO}|${staffEmail}`;

      let g = map.get(key);
      if (!g) {
        g = {
          dayISO,
          staff_name: staffName,
          staff_email: staffEmail,
          minutes_late: 0
        };
        map.set(key, g);
      }

      if (r.action === 'Check-in') {
        // earliest check-in for the day
        if (!g.checkinTs || new Date(r.ts) < new Date(g.checkinTs)) {
          g.checkinTs = r.ts;
          g.minutes_late = Math.max(0, r.minutes_late ?? 0);
        }
      } else if (r.action === 'Check-out') {
        // latest check-out for the day
        if (!g.checkoutTs || new Date(r.ts) > new Date(g.checkoutTs)) {
          g.checkoutTs = r.ts;
        }
      }
    }

    const list = Array.from(map.values())
      .sort((a, b) => a.staff_name.localeCompare(b.staff_name));

    setRows(logs);
    setDaily(list);
    setLoading(false);
  }, [y, m, d]);

  useEffect(() => { void reload(); }, [reload]);

  const wrap = { maxWidth: 980, margin: '0 auto', padding: 16, fontFamily: 'system-ui' } as const;
  const th  = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' } as const;
  const td  = { padding: '10px 12px', borderBottom: '1px solid #eee' } as const;
  const pill = { padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff' } as const;

  return (
    <main style={wrap}>
      <h2 style={{margin:'6px 0 12px'}}>Today</h2>

      <div style={{display:'flex', gap:8, alignItems:'center', margin:'8px 0 12px'}}>
        <button onClick={()=>void reload()} disabled={loading} style={pill}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
        <div style={{color:'#6b7280'}}>KL Date: <b>{String(d).padStart(2,'0')}/{String(m).padStart(2,'0')}/{y}</b></div>
      </div>

      {err && <div style={{color:'#b91c1c', marginBottom:8}}>Failed to load: {err}</div>}

      <div style={{overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:8}}>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
          <thead>
            <tr>
              <th style={th}>Date (KL)</th>
              <th style={th}>Staff</th>
              <th style={th}>Check-in</th>
              <th style={th}>Check-out</th>
              <th style={th}>Late (min)</th>
            </tr>
          </thead>
          <tbody>
            {daily.length === 0 && (
              <tr><td colSpan={5} style={{...td, color:'#6b7280'}}>No rows.</td></tr>
            )}
            {daily.map((r, i) => (
              <tr key={i} style={{ background: r.minutes_late > 0 ? '#fff1f2' : undefined }}>
                <td style={td}>{r.dayISO}</td>
                <td style={td}>{r.staff_name}</td>
                <td style={td}>{fmtKLTime(r.checkinTs)}</td>
                <td style={td}>{fmtKLTime(r.checkoutTs)}</td>
                <td style={td}>{r.minutes_late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}