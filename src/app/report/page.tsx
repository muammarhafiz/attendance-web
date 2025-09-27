'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type Row = {
  day?: string | null;
  staff_name?: string | null;
  staff_email: string;
  action: 'Check-in' | 'Check-out' | string;
  ts: string;                // ISO time
  distance_m?: number | null;
  lat?: number | null;
  lon?: number | null;
  is_late?: boolean | null;
};

export default function ReportPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState<number | ''>('');
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const boot = async () => {
      const { data } = await supabase.auth.getUser();
      setMe(data.user?.email ?? null);
    };
    boot();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setMe(s?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const periodLabel = useMemo(() => {
    const mm = String(month).padStart(2, '0');
    return day === '' ? `${mm}/${year}` : `${String(day).padStart(2, '0')}/${mm}/${year}`;
  }, [day, month, year]);

  const fmtKL = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' });

  const load = async () => {
    setError(null);
    setLoading(true);
    setRows([]);
    try {
      const d = day === '' ? null : Number(day);

      // Try style 1
      let { data, error } = await supabase.rpc('month_attendance', {
        year,
        month,
        day: d,
      });

      // If that fails, try style 2 (p_year / p_month / p_day)
      if (error) {
        const try2 = await supabase.rpc('month_attendance', {
          p_year: year,
          p_month: month,
          p_day: d,
        });
        data = try2.data as any;
        error = try2.error as any;
      }

      if (error) throw error;

      const list: Row[] = Array.isArray(data) ? data : [];
      list.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setRows(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (me) void load();
  }, [me]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.staff_name ?? '').toLowerCase().includes(q) ||
      (r.staff_email ?? '').toLowerCase().includes(q)
    );
  }, [rows, filter]);

  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', borderBottom: '1px solid #e5e7eb' };
  const td: React.CSSProperties = { padding: '8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };
  const lateStyle: React.CSSProperties = { color: '#b91c1c', fontWeight: 600 };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ marginBottom: 8 }}>Attendance Report</h2>

      {!me && (
        <div style={{ margin: '12px 0', padding: 12, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8 }}>
          You must be signed in to view reports. <Link href="/login" style={{ textDecoration: 'underline' }}>Go to sign in</Link>.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 12px' }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Year</div>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value || now.getFullYear()))}
                 style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 8, width: 100 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Month</div>
          <input type="number" value={month} onChange={e => setMonth(Number(e.target.value || (now.getMonth() + 1)))}
                 style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 8, width: 80 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Day (optional)</div>
          <input type="number" value={day} placeholder="(optional)"
                 onChange={e => setDay(e.target.value === '' ? '' : Number(e.target.value))}
                 style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 8, width: 110 }} />
        </div>

        <button onClick={load} disabled={loading || !me}
                style={{ padding: '10px 14px', border: 0, borderRadius: 8, background: '#0ea5e9', color: '#fff' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>

        <div style={{ marginLeft: 'auto', color: '#6b7280' }}>Period: <b>{periodLabel}</b></div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <input placeholder="Filter by staff name/email…" value={filter} onChange={e => setFilter(e.target.value)}
               style={{ padding: 10, border: '1px solid #d1d5db', borderRadius: 8, width: '100%', maxWidth: 360 }} />
      </div>

      {error && <div style={{ color: '#b91c1c', margin: '8px 0' }}>{error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={th}>Date/Time (KL)</th>
              <th style={th}>Staff</th>
              <th style={th}>Email</th>
              <th style={th}>Action</th>
              <th style={th}>Distance (m)</th>
              <th style={th}>Location</th>
              <th style={th}>Map</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td style={td} colSpan={7}>No rows.</td></tr>
            ) : filtered.map((r, i) => {
              const loc = (r.lat != null && r.lon != null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '-';
              const mapHref = (r.lat != null && r.lon != null) ? `https://www.google.com/maps?q=${r.lat},${r.lon}` : null;
              return (
                <tr key={`${r.ts}-${r.staff_email}-${i}`}>
                  <td style={td}>{fmtKL(r.ts)}</td>
                  <td style={td}>{r.staff_name || '—'}</td>
                  <td style={td}>{r.staff_email}</td>
                  <td style={{ ...td, ...(r.is_late ? { color: '#b91c1c', fontWeight: 600 } : {}) }}>
                    {r.action}{r.is_late ? ' (late)' : ''}
                  </td>
                  <td style={td}>{r.distance_m != null ? Math.round(r.distance_m) : '-'}</td>
                  <td style={td}>{loc}</td>
                  <td style={td}>{mapHref ? <a href={mapHref} target="_blank" rel="noreferrer">Open</a> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}