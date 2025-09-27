'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  id: number;
  day: string;                 // YYYY-MM-DD (generated from ts in KL)
  ts: string;                  // ISO
  staff_name: string | null;
  staff_email: string;
  action: 'Check-in' | 'Check-out';
  distance_m: number | null;
  lat: number | null;
  lon: number | null;
};

const th: React.CSSProperties = { textAlign: 'left', padding: '10px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px', borderBottom: '1px solid #f0f0f0', verticalAlign:'top' };

export default function TodayPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // ---- Login guard
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login?next=/today');
      } else {
        setEmail(data.session.user.email ?? null);
      }
      setSessionChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
        router.replace('/login?next=/today');
      } else {
        setEmail(session.user.email ?? null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // ---- Fetch today's rows (uses generated day column; KL date already encoded in it)
  const todayStr = useMemo(() => {
    // use KL explicitly to avoid edge cases
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(now); // YYYY-MM-DD
  }, []);

  const fetchToday = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('attendance')
      .select('id, day, ts, staff_name, staff_email, action, distance_m, lat, lon')
      .eq('day', todayStr)
      .order('ts', { ascending: true });

    if (error) setErr(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!sessionChecked || !email) return;
    fetchToday();
  }, [sessionChecked, email, todayStr]);

  // ---- Filtered view
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter(r =>
      (r.staff_name ?? '').toLowerCase().includes(k) ||
      r.staff_email.toLowerCase().includes(k)
    );
  }, [rows, q]);

  // Late rule: after 09:30 KL
  function isLate(r: Row): boolean {
    if (r.action !== 'Check-in' || !r.ts) return false;
    const t = new Date(r.ts);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(t);
    const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    return (hh > 9) || (hh === 9 && mm > 30);
    // if you want >=09:31 strict, change `mm > 30` to `mm >= 31`
  }

  if (!sessionChecked) return <div style={{ padding: 16 }}>Checking login…</div>;
  if (!email) return <div style={{ padding: 16 }}>Redirecting to login…</div>;

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap:'wrap' }}>
        <h2 style={{ margin: 0 }}>Today&apos;s Logs</h2>
        <div style={{ color: '#666' }}>({todayStr})</div>
        <div style={{ flex: 1 }} />
        <input
          placeholder="Filter by name or email"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ padding: 8, border: '1px solid #ccc', borderRadius: 8, minWidth: 240 }}
        />
        <button onClick={fetchToday} style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}>
          Reload
        </button>
        <button
          onClick={() => {
            const now = new Date();
            const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            window.open(`/report?month=${ym}`, '_blank');
          }}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 8 }}
        >
          Month report (PDF)
        </button>
      </div>

      <div style={{ margin: '10px 0', color: '#555' }}>
        Signed in as <b>{email}</b>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: '#b91c1c' }}>{err}</p>}

      {!loading && !err && filtered.length === 0 && (
        <div style={{ marginTop: 16, color: '#666' }}>
          No records for today. If you just checked in, hit <b>Reload</b>.
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 8, marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#f6f6f6' }}>
                <th style={th}>Time (KL)</th>
                <th style={th}>Action</th>
                <th style={th}>Staff</th>
                <th style={th}>Email</th>
                <th style={th}>Distance (m)</th>
                <th style={th}>Map</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const t = r.ts ? new Date(r.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }) : '—';
                const late = isLate(r);
                const actStyle = r.action === 'Check-in'
                  ? { color: late ? '#b91c1c' : '#16a34a', fontWeight: 600 }
                  : { color: '#0ea5e9', fontWeight: 600 };

                return (
                  <tr key={r.id}>
                    <td style={td}>{t}</td>
                    <td style={{ ...td, ...actStyle }}>
                      {r.action}{late && r.action === 'Check-in' ? ' (Late)' : ''}
                    </td>
                    <td style={td}>{r.staff_name || '—'}</td>
                    <td style={td}>{r.staff_email}</td>
                    <td style={td}>{r.distance_m ?? '—'}</td>
                    <td style={td}>
                      {(r.lat != null && r.lon != null)
                        ? <a href={`https://www.google.com/maps?q=${r.lat},${r.lon}`} target="_blank" rel="noreferrer">Open map</a>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}