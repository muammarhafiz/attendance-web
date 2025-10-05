'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/** Rows from month_attendance */
type Row = {
  staff_email: string;
  staff_name: string;
  day: string;                 // YYYY-MM-DD
  check_in_kl: string | null;  // HH:MM
  check_out_kl: string | null; // HH:MM
  late_min: number | null;
  override: 'OFFDAY' | 'MC' | null;
};

/** Extra coords we’ll merge (first check-in of the day) */
type Coords = {
  staff_email: string;
  day: string;        // YYYY-MM-DD
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
};

type MergedRow = Row & Coords;

type StaffGroup = {
  staff_email: string;
  staff_name: string;
  rows: MergedRow[];
  late_total: number;
  absent_days: number;
};

function titleForMonth(year: number, month: number) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** KL “today” in yyyy-mm-dd */
function klTodayISO(): string {
  const klNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  const y = klNow.getFullYear();
  const m = String(klNow.getMonth() + 1).padStart(2, '0');
  const d = String(klNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** true if yyyy-mm-dd is Sunday */
function isSunday(isoDay: string): boolean {
  return new Date(`${isoDay}T00:00:00Z`).getUTCDay() === 0;
}

/** recompute late minutes vs 09:30 from "HH:MM" */
function minutesLateFrom930(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return Math.max(0, (hh * 60 + mm) - (9 * 60 + 30));
}

export default function MonthlyPrintPage() {
  const sp = useSearchParams();
  const year = Number(sp.get('year') ?? '0');
  const month = Number(sp.get('month') ?? '0');

  const [rows, setRows] = useState<Row[]>([]);
  const [coords, setCoords] = useState<Coords[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Fetch data from the SAME RPC as the Report page
  useEffect(() => {
    (async () => {
      if (!year || !month) {
        setErr('Missing ?year=YYYY&month=MM in the URL');
        return;
      }
      setLoading(true);
      setErr('');
      try {
        // 1) month_attendance (same as Report page)
        const { data: mData, error: mErr } = await supabase.rpc('month_attendance', {
          p_year: year,
          p_month: month,
          p_day: null,
        });
        if (mErr) throw mErr;
        setRows((mData as Row[]) ?? []);

        // 2) first check-in coords per day (optional, for Distance/Coords columns)
        // Compute month bounds (UTC, we’ll derive KL date on server via AT TIME ZONE)
        const startISO = new Date(Date.UTC(year, month - 1, 1)).toISOString();
        const endISO = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1)).toISOString();

        type RawCI = {
          staff_email: string;
          ts: string;     // timestamptz
          lat: number | null;
          lon: number | null;
          distance_m: number | null;
        };

        // Get all check-ins for month, then compact client-side to first per staff/day
        const { data: raw, error: aErr } = await supabase
          .from('attendance')
          .select('staff_email, ts, lat, lon, distance_m')
          .eq('action', 'Check-in')
          .gte('ts', startISO)
          .lt('ts', endISO);

        if (aErr) throw aErr;

        const byKey = new Map<string, Coords>(); // key: day|email
        (raw as RawCI[] ?? []).forEach((r) => {
          // derive KL date from ts
          const tsKl = new Date(new Date(r.ts).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
          const d = `${tsKl.getFullYear()}-${String(tsKl.getMonth() + 1).padStart(2, '0')}-${String(tsKl.getDate()).padStart(2, '0')}`;
          const key = `${d}|${r.staff_email.toLowerCase()}`;
          // keep the earliest check-in we encounter for that (day,email)
          if (!byKey.has(key)) {
            byKey.set(key, {
              staff_email: r.staff_email,
              day: d,
              lat: r.lat ?? null,
              lon: r.lon ?? null,
              distance_m: r.distance_m ?? null,
            });
          }
        });
        setCoords(Array.from(byKey.values()));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [year, month]);

  const todayISO = useMemo(() => klTodayISO(), []);

  // Merge coords into the month_attendance rows
  const mergedRows: MergedRow[] = useMemo(() => {
    const map = new Map<string, Coords>();
    coords.forEach(c => map.set(`${c.day}|${c.staff_email.toLowerCase()}`, c));
    return rows.map(r => {
      const c = map.get(`${r.day}|${r.staff_email.toLowerCase()}`);
      return {
        ...r,
        lat: c?.lat ?? null,
        lon: c?.lon ?? null,
        distance_m: c?.distance_m ?? null,
      };
    });
  }, [rows, coords]);

  // Group & stats with the SAME rules you use on the Report page
  const groups: StaffGroup[] = useMemo(() => {
    const m = new Map<string, StaffGroup>();

    const isAbsent = (r: MergedRow) => {
      if (r.override) return false;         // admin MC/OFFDAY
      if (r.day > todayISO) return false;   // future not absent
      if (isSunday(r.day)) return false;    // Sunday = Offday
      return !r.check_in_kl;                // no check-in => absent
    };

    for (const r of mergedRows) {
      const key = r.staff_email;
      if (!m.has(key)) {
        m.set(key, { staff_email: r.staff_email, staff_name: r.staff_name, rows: [], late_total: 0, absent_days: 0 });
      }
      m.get(key)!.rows.push(r);
    }

    for (const g of m.values()) {
      g.rows.sort((a, b) => a.day.localeCompare(b.day));

      g.absent_days = g.rows.reduce((acc, r) => acc + (isAbsent(r) ? 1 : 0), 0);

      g.late_total = g.rows.reduce((acc, r) => {
        const future = r.day > todayISO;
        const sunday = isSunday(r.day);
        if (future || sunday || r.override || !r.check_in_kl) return acc;
        const late = typeof r.late_min === 'number' && r.late_min != null
          ? r.late_min
          : (minutesLateFrom930(r.check_in_kl) ?? 0);
        return acc + late;
      }, 0);
    }

    return Array.from(m.values()).sort((a, b) => a.staff_name.localeCompare(b.staff_name));
  }, [mergedRows, todayISO]);

  // Split into pages of 3 staff blocks
  const pages = useMemo(() => chunk(groups, 3), [groups]);

  // Auto-open print dialog once content is ready
  useEffect(() => {
    if (!loading && !err && groups.length > 0) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [loading, err, groups.length]);

  return (
    <div>
      {/* Print styles */}
      <style>{`
  @page { size: A4 landscape; margin: 10mm; }

  /* Hide navbar and UI elements during print */
  @media print {
    .no-print,
    header, nav, [role="navigation"],
    .navbar, .nav, .site-header, .site-nav,
    .app-header, .app-nav, .topbar, .header, .global-nav,
    .toolbar {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
    }
  }

  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    font-size: 6pt; color: #111;
  }

  .wrap { padding: 8px 12px; }
  .page { page-break-after: always; }
  .staff-block {
    page-break-inside: avoid;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 6px 8px;
    margin-bottom: 6mm;
  }
  .staff-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 3px;
  }
  .staff-title { font-weight: 700; font-size: 7pt; }
  .muted { color: #666; font-weight: 400; font-size: 6pt; }
  .stats { font-size: 6pt; color: #333; }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto; /* ✅ auto-fit column width */
  }
  th, td {
    padding: 2px 4px;
    border-bottom: 1px solid #eee;
    text-align: left;
    vertical-align: top;
    white-space: nowrap; /* prevent breaking text */
  }
  thead th {
    background: #f8fafc;
    font-weight: 700;
    font-size: 6pt;
    border-bottom: 1px solid #ccc;
  }

  .pill-off {
    padding: 1px 4px;
    border-radius: 999px;
    background: #f0f0f0;
    color: #333;
    font-weight: 600;
    font-size: 6pt;
  }
  .pill-present {
    padding: 1px 4px;
    border-radius: 999px;
    background: #e8f5e9;
    color: #1b5e20;
    font-weight: 600;
    font-size: 6pt;
  }
  .pill-absent {
    padding: 1px 4px;
    border-radius: 999px;
    background: #fdecea;
    color: #b42318;
    font-weight: 700;
    font-size: 6pt;
  }
  .number { text-align: right; }
`}</style>

      {/* Toolbar (hidden in print) */}
      <div className="toolbar no-print">
        <div style={{fontWeight: 700}}>Monthly Attendance (A4 Landscape, 3/staff per page)</div>
        <div className="muted">Period: {year && month ? titleForMonth(year, month) : '—'}</div>
        <div style={{flex: 1}} />
        <button onClick={() => window.print()} style={{padding:'8px 12px', border:'1px solid #ddd', borderRadius:8, cursor:'pointer', background:'#f5f5f5'}}>
          Print / Save PDF
        </button>
      </div>

      <div className="wrap">
        {err && <div style={{color:'#b00020', margin:'12px 0'}}>{err}</div>}
        {loading && <div style={{color:'#555', margin:'12px 0'}}>Loading…</div>}
        {!loading && !err && groups.length === 0 && <div style={{color:'#555', margin:'12px 0'}}>No data.</div>}

        {pages.map((grp, pageIdx) => (
          <div key={`page-${pageIdx}`} className="page">
            {grp.map((g) => (
              <div key={g.staff_email} className="staff-block">
                <div className="staff-header">
                  <div className="staff-title">
                    {g.staff_name} <span className="muted">({g.staff_email})</span>
                  </div>
                  <div className="stats">
                    Total late: <b>{g.late_total}</b> min · Absent days: <b>{g.absent_days}</b> · Period: <b>{titleForMonth(year, month)}</b>
                  </div>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th className="number">Late</th>
                      <th>Status</th>
                      <th>Distance</th>
                      <th>Coords</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const future = r.day > todayISO;
                      const sunday = isSunday(r.day);

                      // Status precedence = SAME as Report page
                      let statusEl: React.ReactNode;
                      if (r.override) {
                        statusEl = <span className="pill-off">{r.override}</span>;
                      } else if (future) {
                        statusEl = <span>—</span>;
                      } else if (sunday) {
                        statusEl = <span className="pill-off">Offday</span>;
                      } else if (!r.check_in_kl) {
                        statusEl = <span className="pill-absent">Absent</span>;
                      } else {
                        statusEl = <span className="pill-present">Present</span>;
                      }

                      const blockTimes = future || sunday;
                      const showIn  = blockTimes ? '—' : (r.check_in_kl  ?? '—');
                      const showOut = blockTimes ? '—' : (r.check_out_kl ?? '—');

                      const late = (() => {
                        if (blockTimes || r.override || !r.check_in_kl) return '—';
                        if (typeof r.late_min === 'number' && r.late_min != null) return r.late_min;
                        const recomputed = minutesLateFrom930(r.check_in_kl);
                        return recomputed == null ? '—' : recomputed;
                      })();

                      const distTxt = (r.distance_m != null) ? `${r.distance_m} m` : '—';
                      const coordsTxt =
                        (r.lat != null && r.lon != null) ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}` : '—';

                      return (
                        <tr key={`${g.staff_email}-${r.day}`}>
                          <td>{r.day}</td>
                          <td>{showIn}</td>
                          <td>{showOut}</td>
                          <td className="number">{late}</td>
                          <td>{statusEl}</td>
                          <td>{distTxt}</td>
                          <td>{coordsTxt}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}