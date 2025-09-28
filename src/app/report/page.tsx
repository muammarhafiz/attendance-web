'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// ---------- Types ----------
type AttRow = {
  // from month_attendance() or attendance table
  ts?: string | null;            // ISO timestamp (UTC)
  day?: number | null;           // 1..31 (from function) – optional
  action?: 'check-in' | 'check-out' | string;
  staff_name?: string | null;
  staff_email: string;
  distance_m?: number | null;
  is_late?: boolean | null;
  late_minutes?: number | null;
  // Fallback fields when reading raw attendance
  t?: string | null;             // timestamp col alias (ts)
  staff?: string | null;         // name
  email?: string | null;         // email
};

type DayLine = {
  date: Date;
  day: number;
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

function toKL(d: Date) {
  // Render Date in KL without mutating underlying UTC
  return new Date(
    d.toLocaleString('en-US', { timeZone: KL_TZ })
  );
}
function fmtDT(d: Date | null) {
  if (!d) return '—';
  const k = toKL(d);
  return k.toLocaleString('en-GB', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
  });
}
function withinMonth(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate(); // month is 1..12
}

// ---------- Component ----------
export default function ReportPage() {
  const now = useMemo(() => toKL(new Date()), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12
  const [day, setDay] = useState<number | ''>('');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<string>(''); // "" = All staff

  // fetch month data: prefer RPC month_attendance, fallback to raw attendance
  const fetchMonth = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // 1) Try the RPC if it exists
      const rpc = await supabase.rpc('month_attendance', {
        p_year: year,
        p_month: month,
        p_day: day === '' ? null : Number(day),
      });

      if (!rpc.error && rpc.data) {
        // Normalize potential field names
        const data = (rpc.data as any[]).map((r) => ({
          ts: r.ts ?? r.timestamp ?? r.t ?? null,
          day: r.day ?? null,
          action: r.action,
          staff_name: r.staff_name ?? r.staff ?? null,
          staff_email: r.staff_email ?? r.email,
          distance_m: r.distance_m ?? r.distance ?? null,
          is_late: r.is_late ?? null,
          late_minutes: r.late_minutes ?? r.late_min ?? null,
        })) as AttRow[];
        setRows(data);
      } else {
        // 2) Fallback to direct query
        const first = `${year}-${String(month).padStart(2, '0')}-01`;
        const until = `${year}-${String(month + 1).padStart(2, '0')}-01`;

        const q = supabase
          .from('attendance')
          .select('ts:ts, action, staff_name, staff_email, distance_m, late_minutes')
          .gte('ts', first)
          .lt('ts', until)
          .order('ts', { ascending: true });

        const { data, error } = await q;
        if (error) throw error;

        const dataN = (data ?? []).map((r: any) => ({
          ts: r.ts,
          day: new Date(r.ts).getDate(),
          action: r.action,
          staff_name: r.staff_name ?? null,
          staff_email: r.staff_email,
          distance_m: r.distance_m ?? null,
          is_late: (r.late_minutes ?? 0) > 0,
          late_minutes: r.late_minutes ?? null,
        })) as AttRow[];

        setRows(dataN);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load report');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day]);

  useEffect(() => {
    fetchMonth();
  }, [fetchMonth]);

  // Build staff map
  const byStaff = useMemo(() => {
    const map = new Map<string, { name: string }>();
    rows.forEach((r) => {
      const email = r.staff_email;
      const name = (r.staff_name ?? '').trim() || email.split('@')[0];
      if (!map.has(email)) map.set(email, { name });
    });
    return map;
  }, [rows]);

  // Dropdown list (sorted by name)
  const staffOptions = useMemo(
    () =>
      Array.from(byStaff.entries())
        .map(([email, v]) => ({ email, name: v.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [byStaff]
  );

  // Build tables per staff (or only selected)
  const tables: StaffTable[] = useMemo(() => {
    const endDay = daysInMonth(year, month);
    const todayKL = toKL(new Date());
    const isCurrentMonth = todayKL.getFullYear() === year && todayKL.getMonth() + 1 === month;

    const wantedStaff =
      selectedEmail && byStaff.has(selectedEmail)
        ? [[selectedEmail, byStaff.get(selectedEmail)!]]
        : Array.from(byStaff.entries());

    // Filter by top text filter (name/email)
    const q = filter.trim().toLowerCase();
    const pool = wantedStaff.filter(([email, v]) => {
      if (!q) return true;
      return email.toLowerCase().includes(q) || v.name.toLowerCase().includes(q);
    });

    const out: StaffTable[] = [];

    pool.forEach(([email, v]) => {
      // rows for this staff
      const mine = rows.filter((r) => r.staff_email === email);

      // build day lines 1..endDay
      const days: DayLine[] = [];
      let absent = 0;
      let lateTotal = 0;

      for (let d = 1; d <= endDay; d++) {
        const items = mine.filter((r) => (r.day ?? new Date(r.ts ?? '').getDate()) === d);
        const checkInItem = items.find((r) => (r.action ?? '').toLowerCase().includes('in'));
        const checkOutItem = items.find((r) => (r.action ?? '').toLowerCase().includes('out'));

        const checkIn = checkInItem?.ts ? new Date(checkInItem.ts) : null;
        const checkOut = checkOutItem?.ts ? new Date(checkOutItem.ts) : null;

        const lateMin =
          checkInItem?.late_minutes != null
            ? Math.max(0, Math.round(checkInItem.late_minutes))
            : null;

        // Status
        let status: DayLine['status'] = '—';
        const dayDate = withinMonth(year, month, d);
        const dayIsFuture =
          dayDate > withinMonth(todayKL.getFullYear(), todayKL.getMonth() + 1, todayKL.getDate());
        if (checkIn) {
          status = lateMin && lateMin > 0 ? 'Late' : 'Present';
          if (lateMin) lateTotal += lateMin;
        } else if (!dayIsFuture) {
          status = 'Absent';
          absent += 1;
        }

        days.push({ date: dayDate, day: d, checkIn, checkOut, lateMin, status });
      }

      out.push({
        email,
        name: v.name,
        days,
        absentCount: absent,
        lateTotalMin: lateTotal,
      });
    });

    // Sort staff tables by name for stable UI
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, byStaff, year, month, filter, selectedEmail]);

  // Print
  const onPrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2 style={{ marginBottom: 12 }}>Attendance Report</h2>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ marginLeft: 6, width: 90, padding: 8 }}
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
            style={{ marginLeft: 6, width: 70, padding: 8 }}
          />
        </label>
        <label>
          Day (optional)
          <input
            type="number"
            value={day}
            min={1}
            max={31}
            onChange={(e) => {
              const v = e.target.value;
              setDay(v === '' ? '' : Number(v));
            }}
            style={{ marginLeft: 6, width: 90, padding: 8 }}
          />
        </label>

        <button onClick={fetchMonth} disabled={loading} style={{ padding: '8px 12px' }}>
          {loading ? 'Loading…' : 'Reload'}
        </button>

        {/* Staff dropdown */}
        <label style={{ marginLeft: 12 }}>
          Staff
          <select
            value={selectedEmail}
            onChange={(e) => setSelectedEmail(e.target.value)}
            style={{ marginLeft: 6, padding: 8, minWidth: 220 }}
          >
            <option value="">All staff</option>
            {staffOptions.map((s) => (
              <option key={s.email} value={s.email}>
                {s.name} ({s.email})
              </option>
            ))}
          </select>
        </label>

        {/* Free text filter (name/email) */}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by staff name/email…"
          style={{ padding: 8, minWidth: 260 }}
        />

        <span style={{ marginLeft: 'auto' }}>
          Period:&nbsp;
          <b>
            {String(month).padStart(2, '0')}/{year}
          </b>
        </span>

        <button onClick={onPrint} style={{ padding: '8px 12px' }}>
          Print
        </button>
      </div>

      {errorMsg && (
        <p style={{ color: 'crimson', marginTop: 12 }}>Failed to load report: {errorMsg}</p>
      )}

      {/* Tables */}
      <div style={{ marginTop: 16, display: 'grid', gap: 24 }}>
        {tables.length === 0 && !loading && (
          <div
            style={{
              border: '1px solid #e4e4e7',
              borderRadius: 8,
              padding: 16,
              background: '#fafafa',
            }}
          >
            No rows.
          </div>
        )}

        {tables.map((t) => (
          <section
            key={t.email}
            style={{ border: '1px solid #e4e4e7', borderRadius: 8, overflow: 'hidden' }}
          >
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'baseline',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: '#f6f7fb',
                borderBottom: '1px solid #e4e4e7',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{t.name}</div>
                <div style={{ color: '#666' }}>{t.email}</div>
              </div>
              <div style={{ display: 'flex', gap: 16, color: '#111' }}>
                <div>
                  Absent:&nbsp;<b>{t.absentCount}</b>
                </div>
                <div>
                  Late total:&nbsp;<b>{t.lateTotalMin} min</b>
                </div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f9fafb' }}>
                <tr>
                  {['Date', 'Check-in', 'Check-out', 'Late (min)', 'Status'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderBottom: '1px solid #e4e4e7',
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.days.map((d) => {
                  const isLate = (d.lateMin ?? 0) > 0;
                  const isAbsent = d.status === 'Absent';
                  return (
                    <tr
                      key={d.day}
                      style={{
                        background: isLate ? '#fff4f2' : undefined,
                      }}
                    >
                      <td style={td}>{`${String(d.day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`}</td>
                      <td style={td}>{fmtDT(d.checkIn)}</td>
                      <td style={td}>{fmtDT(d.checkOut)}</td>
                      <td style={td}>{d.lateMin ?? '—'}</td>
                      <td style={{ ...td, color: isAbsent ? 'crimson' : isLate ? '#b45309' : '#065f46' }}>
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

const td: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #e4e4e7',
};