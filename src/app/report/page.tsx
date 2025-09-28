'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type AttRow = {
  ts: string;                 // ISO
  action: 'Check-in' | 'Check-out';
  staff_name: string | null;
  staff_email: string;
};

type DaySummary = {
  in?: Date;
  out?: Date;
  lateMin?: number;
};

const KL_TZ = 'Asia/Kuala_Lumpur';
const WORK_START_MIN = 9 * 60 + 30; // 09:30

function toKL(d: Date): Date {
  // Convert by formatting then re-parsing to keep “KL clock” without shifting the local date parts
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KL_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d).reduce<Record<string,string>>((acc, p) => (p.type !== 'literal' && (acc[p.type] = p.value), acc), {});
  const y = Number(parts.year), m = Number(parts.month), da = Number(parts.day);
  const h = Number(parts.hour), mi = Number(parts.minute), s = Number(parts.second);
  return new Date(Date.UTC(y, m - 1, da, h, mi, s));
}

function fmtTimeKL(d?: Date): string {
  if (!d) return '–';
  return d.toLocaleTimeString('en-GB', { timeZone: KL_TZ, hour: '2-digit', minute: '2-digit' });
}

function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}

export default function ReportPage() {
  // auth gate (must be signed in)
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
    })();
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const nowKL = toKL(new Date());
  const [year, setYear]   = useState<number>(nowKL.getUTCFullYear());
  const [month, setMonth] = useState<number>(nowKL.getUTCMonth() + 1); // 1..12
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<AttRow[]>([]);

  const periodStartISO = useMemo(() => new Date(Date.UTC(year, month - 1, 1)).toISOString(), [year, month]);
  const periodEndISO   = useMemo(() => new Date(Date.UTC(year, month, 1)).toISOString(), [year, month]);

  const reload = async () => {
    setLoading(true);
    setErrorMsg(null);
    const { data, error } = await supabase
      .from('attendance')
      .select('ts, action, staff_name, staff_email')
      .gte('ts', periodStartISO).lt('ts', periodEndISO)
      .order('ts', { ascending: true });

    if (error) {
      setErrorMsg(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as AttRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { if (email) reload(); }, [email, periodStartISO, periodEndISO]); // load when signed in and period changes

  // Build per-staff summaries (1..days)
  const byStaff = useMemo(() => {
    const dmax = daysInMonth(year, month);
    type StaffKey = string; // email
    const map = new Map<StaffKey, { name: string; email: string; days: DaySummary[] }>();
    for (const r of rows) {
      const dKL = toKL(new Date(r.ts));
      const day = dKL.getUTCDate(); // 1..dmax
      if (day < 1 || day > dmax) continue;

      const key = r.staff_email;
      if (!map.has(key)) {
        map.set(key, { name: r.staff_name ?? r.staff_email.split('@')[0], email: r.staff_email, days: Array(dmax).fill(null).map(() => ({})) });
      }
      const bucket = map.get(key)!;
      const ds = bucket.days[day - 1];

      if (r.action === 'Check-in') {
        if (!ds.in) ds.in = dKL; // keep earliest
      } else if (r.action === 'Check-out') {
        ds.out = dKL; // keep last (later writes overwrite)
      }
    }
    // compute late minutes for each day
    for (const v of map.values()) {
      v.days.forEach((ds) => {
        if (ds.in) {
          const mins = ds.in.getUTCHours() * 60 + ds.in.getUTCMinutes();
          const late = Math.max(0, mins - WORK_START_MIN);
          ds.lateMin = late;
        }
      });
    }
    return map;
  }, [rows, year, month]);

  // filter staff by name/email
  const staffEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const arr = Array.from(byStaff.entries()).map(([emailKey, v]) => ({ email: emailKey, ...v }));
    if (!q) return arr;
    return arr.filter(x =>
      x.email.toLowerCase().includes(q) ||
      x.name.toLowerCase().includes(q)
    );
  }, [byStaff, filter]);

  if (!email) {
    return (
      <main style={{ padding: 16 }}>
        <h2>Report</h2>
        <p>You must be signed in to view this page. Go to <a href="/login">/login</a>.</p>
      </main>
    );
  }

  const dmax = daysInMonth(year, month);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Attendance Report</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label>Year
          <input type="number" value={year} onChange={(e)=>setYear(parseInt(e.target.value || '0',10))}
                 style={{ marginLeft: 6, width: 90, padding: 6, border: '1px solid #ddd', borderRadius: 6 }} />
        </label>
        <label>Month
          <input type="number" min={1} max={12} value={month} onChange={(e)=>setMonth(parseInt(e.target.value || '0',10))}
                 style={{ marginLeft: 6, width: 70, padding: 6, border: '1px solid #ddd', borderRadius: 6 }} />
        </label>
        <button onClick={reload} disabled={loading}
                style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: loading ? '#eee' : '#fff' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
        <div style={{ marginLeft: 8, color: '#555' }}>
          Period: {String(month).padStart(2,'0')}/{year}
        </div>
      </div>

      <input
        placeholder="Filter by staff name or email…"
        value={filter}
        onChange={(e)=>setFilter(e.target.value)}
        style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}
      />

      {errorMsg && <div style={{ color: '#b91c1c', marginBottom: 12 }}>Failed to load report: {errorMsg}</div>}

      {staffEntries.length === 0 ? (
        <div>No staff rows for this period.</div>
      ) : (
        staffEntries.map((s) => (
          <section key={s.email} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>{s.name}</h3>
              <div style={{ color: '#666' }}>{s.email}</div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={th}>Day</th>
                  <th style={th}>Check-in</th>
                  <th style={th}>Check-out</th>
                  <th style={th}>Late (min)</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: dmax }, (_, i) => i + 1).map((day) => {
                  const ds: DaySummary = s.days[day - 1] ?? {};
                  const isLate = (ds.lateMin ?? 0) > 0;
                  return (
                    <tr key={day} style={{ background: isLate ? '#fff1f2' : undefined }}>
                      <td style={td}>{String(day).padStart(2,'0')}</td>
                      <td style={td}>{fmtTimeKL(ds.in)}</td>
                      <td style={td}>{fmtTimeKL(ds.out)}</td>
                      <td style={td}>{ds.in ? (ds.lateMin ?? 0) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid #e5e7eb',
  fontWeight: 600,
  fontSize: 14,
};
const td: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  fontSize: 14,
};