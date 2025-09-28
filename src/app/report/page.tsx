'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// ---------- Types ----------
type AttRow = {
  ts: string | null;                 // ISO timestamp (UTC) or null
  day: number | null;                // 1..31 (if known)
  action?: string;                   // 'Check-in' | 'Check-out' (case-insensitive)
  staff_name: string | null;
  staff_email: string;
  distance_m: number | null;
  is_late: boolean | null;
  late_minutes: number | null;
};

type DayLine = {
  day: number;                       // 1..31
  checkIn: Date | null;
  checkOut: Date | null;
  lateMin: number | null;
  status: 'Present' | 'Late' | 'Absent' | '—';
};

type StaffTable = {
  email: string;
  name: string;
  days: DayLine[];
  absentCount: number;
  lateTotalMin: number;
};

// ---------- Helpers ----------
const KL_TZ = 'Asia/Kuala_Lumpur';
const WORK_START_MIN = 9 * 60 + 30; // 09:30

function toKLDate(d: Date): Date {
  // Render same instant but show clock as KL for formatting
  const s = d.toLocaleString('en-GB', { timeZone: KL_TZ });
  return new Date(s);
}
function fmtTimeKL(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { timeZone: KL_TZ, hour: '2-digit', minute: '2-digit' });
}
function daysInMonth(year: number, month1to12: number) {
  return new Date(year, month1to12, 0).getDate();
}
function ymdUTC(year: number, mon1to12: number, day: number) {
  return new Date(Date.UTC(year, mon1to12 - 1, day));
}

// ---------- Component ----------
export default function ReportPage() {
  const nowKL = useMemo(() => toKLDate(new Date()), []);
  const [year, setYear] = useState<number>(nowKL.getFullYear());
  const [month, setMonth] = useState<number>(nowKL.getMonth() + 1); // 1..12
  const [day, setDay] = useState<number | ''>('');                   // optional day filter for RPC (kept for future)
  const [rows, setRows] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [filterText, setFilterText] = useState<string>('');          // free text filter
  const [selectedEmail, setSelectedEmail] = useState<string>('');    // "" = all staff

  const periodStartISO = useMemo(
    () => new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    [year, month]
  );
  const periodEndISO = useMemo(
    () => new Date(Date.UTC(year, month, 1)).toISOString(),
    [year, month]
  );

  // fetch month data: try RPC month_attendance(), fallback to raw attendance
  const fetchMonth = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // Try RPC
      const { data: rpcData, error: rpcErr } = await supabase.rpc('month_attendance', {
        p_year: year,
        p_month: month,
        p_day: day === '' ? null : Number(day),
      });

      if (!rpcErr && rpcData) {
        const normalized: AttRow[] = (rpcData as unknown[]).map((r0) => {
          const r = r0 as Record<string, unknown>;
          const ts =
            (r['ts'] as string | null) ??
            (r['timestamp'] as string | null) ??
            (r['t'] as string | null) ??
            null;

          const lateMin =
            (r['late_minutes'] as number | null) ??
            (r['late_min'] as number | null) ??
            null;

          return {
            ts,
            day: (r['day'] as number | null) ?? (ts ? new Date(ts).getUTCDate() : null),
            action: (r['action'] as string | undefined) ?? undefined,
            staff_name:
              ((r['staff_name'] as string | null) ??
                (r['staff'] as string | null)) ?? null,
            staff_email: (r['staff_email'] as string) ?? (r['email'] as string) ?? '',
            distance_m:
              (r['distance_m'] as number | null) ??
              (r['distance'] as number | null) ??
              null,
            is_late: (r['is_late'] as boolean | null) ?? (lateMin != null ? lateMin > 0 : null),
            late_minutes: lateMin,
          };
        });
        setRows(normalized);
      } else {
        // Fallback to direct table
        const { data, error } = await supabase
          .from('attendance')
          .select('ts, action, staff_name, staff_email, distance_m, late_minutes')
          .gte('ts', periodStartISO)
          .lt('ts', periodEndISO)
          .order('ts', { ascending: true });

        if (error) throw error;

        const safe = Array.isArray(data) ? (data as unknown[]) : [];
        const normalized: AttRow[] = safe.map((row0) => {
          const row = row0 as Record<string, unknown>;
          const ts = (row['ts'] as string | null) ?? null;
          const late = (row['late_minutes'] as number | null) ?? null;
          return {
            ts,
            day: ts ? new Date(ts).getUTCDate() : null,
            action: (row['action'] as string | undefined) ?? undefined,
            staff_name: (row['staff_name'] as string | null) ?? null,
            staff_email: (row['staff_email'] as string) ?? '',
            distance_m: (row['distance_m'] as number | null) ?? null,
            is_late: late != null ? late > 0 : null,
            late_minutes: late,
          };
        });
        setRows(normalized);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day, periodStartISO, periodEndISO]);

  useEffect(() => {
    fetchMonth();
  }, [fetchMonth]);

  // Build staff list (name fallback to email local-part)
  const staffIndex = useMemo(() => {
    const m = new Map<string, string>(); // email -> name
    rows.forEach((r) => {
      const nm = (r.staff_name ?? '').trim() || r.staff_email.split('@')[0];
      if (!m.has(r.staff_email)) m.set(r.staff_email, nm);
    });
    return m;
  }, [rows]);

  const staffOptions = useMemo(
    () =>
      Array.from(staffIndex.entries())
        .map(([email, name]) => ({ email, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [staffIndex]
  );

  // Build tables for selected/all staff
  const tables: StaffTable[] = useMemo(() => {
    const maxDay = daysInMonth(year, month);
    const todayKL = toKLDate(new Date());
    const todayY = todayKL.getFullYear();
    const todayM = todayKL.getMonth() + 1;
    const todayD = todayKL.getDate();

    const staffPairs =
      selectedEmail && staffIndex.has(selectedEmail)
        ? [[selectedEmail, staffIndex.get(selectedEmail)!] as const]
        : Array.from(staffIndex.entries());

    const q = filterText.trim().toLowerCase();

    return staffPairs
      .filter(([email, name]) => {
        if (!q) return true;
        return email.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      })
      .map(([email, name]) => {
        const my = rows.filter((r) => r.staff_email === email);

        const days: DayLine[] = [];
        let absent = 0;
        let lateTotal = 0;

        for (let d = 1; d <= maxDay; d++) {
          const items = my.filter((r) => (r.day ?? 0) === d || (r.ts ? new Date(r.ts).getUTCDate() === d : false));
          // earliest check-in, latest check-out
          const inItem = items
            .filter((r) => (r.action ?? '').toLowerCase().includes('in'))
            .sort((a, b) => (a.ts && b.ts ? a.ts.localeCompare(b.ts) : 0))[0];
          const outItem = items
            .filter((r) => (r.action ?? '').toLowerCase().includes('out'))
            .sort((a, b) => (a.ts && b.ts ? b.ts.localeCompare(a.ts) : 0))[0];

          const checkIn = inItem?.ts ? new Date(inItem.ts) : null;
          const checkOut = outItem?.ts ? new Date(outItem.ts) : null;

          // late minutes (prefer stored value; else compute from checkIn)
          let lateMin: number | null = null;
          if (inItem?.late_minutes != null) {
            lateMin = Math.max(0, Math.round(inItem.late_minutes));
          } else if (checkIn) {
            const h = checkIn.getUTCHours();
            const m = checkIn.getUTCMinutes();
            const minSinceMidnight = h * 60 + m;
            lateMin = Math.max(0, minSinceMidnight - WORK_START_MIN);
          }

          // Status
          let status: DayLine['status'] = '—';
          const isFuture =
            year > todayY ||
            (year === todayY && month > todayM) ||
            (year === todayY && month === todayM && d > todayD);

          if (checkIn) {
            const isLate = (lateMin ?? 0) > 0;
            status = isLate ? 'Late' : 'Present';
            if (isLate) lateTotal += lateMin ?? 0;
          } else if (!isFuture) {
            status = 'Absent';
            absent += 1;
          }

          days.push({
            day: d,
            checkIn,
            checkOut,
            lateMin,
            status,
          });
        }

        return {
          email,
          name,
          days,
          absentCount: absent,
          lateTotalMin: lateTotal,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, staffIndex, selectedEmail, filterText, year, month]);

  const onPrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ marginBottom: 12 }}>Attendance Report</h2>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ marginLeft: 6, width: 90, padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </label>
        <label>
          Month
          <input
            type="number"
            value={month}
            min={1}
            max={12}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{ marginLeft: 6, width: 70, padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </label>
        <button onClick={fetchMonth} disabled={loading}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: loading ? '#f3f4f6' : '#fff' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>

        {/* Staff dropdown */}
        <label style={{ marginLeft: 8 }}>
          Staff
          <select
            value={selectedEmail}
            onChange={(e) => setSelectedEmail(e.target.value)}
            style={{ marginLeft: 6, padding: 8, minWidth: 220, border: '1px solid #ddd', borderRadius: 6 }}
          >
            <option value="">All staff</option>
            {staffOptions.map((s) => (
              <option key={s.email} value={s.email}>
                {s.name} ({s.email})
              </option>
            ))}
          </select>
        </label>

        {/* Free-text filter */}
        <input
          placeholder="Filter by name or email…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ padding: 8, minWidth: 240, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <span style={{ marginLeft: 'auto' }}>
          Period: <b>{String(month).padStart(2, '0')}/{year}</b>
        </span>

        <button onClick={onPrint}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8 }}>
          Print
        </button>
      </div>

      {errorMsg && <div style={{ color: '#b91c1c', marginTop: 10 }}>Failed to load: {errorMsg}</div>}

      {/* Tables */}
      <div style={{ marginTop: 16, display: 'grid', gap: 24 }}>
        {tables.length === 0 && !loading && (
          <div style={{ border: '1px solid #e5e7eb', padding: 16, borderRadius: 8, background: '#fafafa' }}>
            No rows for this period.
          </div>
        )}

        {tables.map((t) => (
          <section key={t.email} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc'
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{t.name}</div>
                <div style={{ color: '#666' }}>{t.email}</div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>Absent: <b>{t.absentCount}</b></div>
                <div>Late total: <b>{t.lateTotalMin} min</b></div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Date', 'Check-in', 'Check-out', 'Late (min)', 'Status'].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.days.map((d) => {
                  const isLate = (d.lateMin ?? 0) > 0;
                  const isAbsent = d.status === 'Absent';
                  return (
                    <tr key={d.day} style={{ background: isLate ? '#fff4f2' : undefined }}>
                      <td style={td}>{String(d.day).padStart(2, '0')}/{String(month).padStart(2, '0')}/{year}</td>
                      <td style={td}>{fmtTimeKL(d.checkIn)}</td>
                      <td style={td}>{fmtTimeKL(d.checkOut)}</td>
                      <td style={td}>{d.lateMin ?? '—'}</td>
                      <td style={{ ...td, color: isAbsent ? '#b91c1c' : isLate ? '#b45309' : '#065f46' }}>
                        {d.status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
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
  borderBottom: '1px solid #eef2f7',
  fontSize: 14,
};