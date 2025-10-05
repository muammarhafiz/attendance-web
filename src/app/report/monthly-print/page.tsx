'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/** Row exactly as provided by month_ui */
type Row = {
  staff_email: string;
  staff_name: string;
  day: string;                  // YYYY-MM-DD
  check_in_kl: string | null;   // HH:MM
  check_out_kl: string | null;  // HH:MM
  late_min: number | null;      // minutes late vs 09:30
  status: 'Present' | 'Absent' | 'OFFDAY' | 'MC' | '—';
  lat?: number | null;
  lon?: number | null;
  distance_m?: number | null;
};

type StaffGroup = {
  staff_email: string;
  staff_name: string;
  rows: Row[];
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

export default function MonthlyPrintPage() {
  const sp = useSearchParams();
  const year = Number(sp.get('year') ?? '0');
  const month = Number(sp.get('month') ?? '0');

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // Fetch the exact same dataset used by the Report page
  useEffect(() => {
    (async () => {
      if (!year || !month) {
        setErr('Missing ?year=YYYY&month=MM in the URL');
        return;
      }
      setLoading(true);
      setErr('');
      try {
        const { data, error } = await supabase.rpc('month_ui', {
          p_year: year,
          p_month: month,
        });
        if (error) throw error;
        setRows((data as Row[]) ?? []);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [year, month]);

  // Group by staff, sort, and compute stats USING server status
  const groups: StaffGroup[] = useMemo(() => {
    const m = new Map<string, StaffGroup>();
    for (const r of rows) {
      const key = r.staff_email;
      if (!m.has(key)) {
        m.set(key, { staff_email: r.staff_email, staff_name: r.staff_name, rows: [], late_total: 0, absent_days: 0 });
      }
      m.get(key)!.rows.push(r);
    }
    for (const g of m.values()) {
      g.rows.sort((a, b) => a.day.localeCompare(b.day));
      g.absent_days = g.rows.reduce((acc, r) => acc + (r.status === 'Absent' ? 1 : 0), 0);
      g.late_total  = g.rows.reduce((acc, r) => acc + ((r.status === 'Present' && typeof r.late_min === 'number') ? r.late_min : 0), 0);
    }
    return Array.from(m.values()).sort((a, b) => a.staff_name.localeCompare(b.staff_name));
  }, [rows]);

  // 3 staff blocks per printed page
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
        @media print { .no-print { display: none !important; } }
        body {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
          font-size: 9pt;
          color: #111;
        }
        .toolbar {
          display: flex; gap: 8px; align-items: center;
          padding: 10px 14px; border-bottom: 1px solid #eee; background: #fafafa;
          position: sticky; top: 0; z-index: 10;
        }
        .wrap { padding: 12px 16px; }
        .page { page-break-after: always; margin: 0; padding: 0; }
        .staff-block {
          page-break-inside: avoid;
          border: 1px solid #e5e7eb; border-radius: 8px;
          padding: 10px 12px; margin-bottom: 8mm;
        }
        .staff-header {
          display: flex; justify-content: space-between; align-items: baseline;
          margin-bottom: 6px;
        }
        .staff-title { font-weight: 700; font-size: 10pt; }
        .muted { color: #666; font-weight: 400; font-size: 9pt; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 4px 6px; border-bottom: 1px solid #f0f0f0; text-align: left; white-space: nowrap; }
        thead th { border-bottom: 1px solid #e5e7eb; background: #f8fafc; font-weight: 700; }
        .stats { font-size: 9pt; color: #333; }
        .pill-off { padding: 1px 6px; border-radius: 999px; background: #f0f0f0; color: #333; font-weight: 600; font-size: 8pt; }
        .pill-present { padding: 1px 6px; border-radius: 999px; background: #e8f5e9; color: #1b5e20; font-weight: 600; font-size: 8pt; }
        .pill-absent { padding: 1px 6px; border-radius: 999px; background: #fdecea; color: #b42318; font-weight: 700; font-size: 8pt; }
        .number { text-align: right; }
      `}</style>

      {/* Toolbar (hidden in print) */}
      <div className="toolbar no-print">
        <div style={{fontWeight: 700}}>Monthly Attendance (A4 Landscape, 3/staff per page)</div>
        <div className="muted">Period: {year && month ? titleForMonth(year, month) : '—'}</div>
        <div style={{flex: 1}} />
        <button
          onClick={() => window.print()}
          style={{padding:'8px 12px', border:'1px solid #ddd', borderRadius:8, cursor:'pointer', background:'#f5f5f5'}}
        >
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
                      // Render status pill directly from server status
                      const pill =
                        r.status === 'Present' ? (
                          <span className="pill-present">Present</span>
                        ) : r.status === 'Absent' ? (
                          <span className="pill-absent">Absent</span>
                        ) : r.status === 'OFFDAY' || r.status === 'MC' ? (
                          <span className="pill-off">{r.status}</span>
                        ) : (
                          <span>—</span>
                        );

                      const distTxt =
                        r.distance_m != null ? `${r.distance_m} m` : '—';
                      const coordsTxt =
                        r.lat != null && r.lon != null
                          ? `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`
                          : '—';

                      return (
                        <tr key={`${g.staff_email}-${r.day}`}>
                          <td>{r.day}</td>
                          <td>{r.check_in_kl ?? '—'}</td>
                          <td>{r.check_out_kl ?? '—'}</td>
                          <td className="number">{r.late_min ?? '—'}</td>
                          <td>{pill}</td>
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