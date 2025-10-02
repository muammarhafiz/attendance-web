'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type AttendanceRow = {
  staff_name: string;
  staff_email: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
};

type StaffRow = {
  email: string;
  name: string;
};

type MergedRow = {
  staff_email: string;
  staff_name: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
};

function klTodayISO(): string {
  // YYYY-MM-DD for Asia/Kuala_Lumpur
  const klNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  const y = klNow.getFullYear();
  const m = String(klNow.getMonth() + 1).padStart(2, '0');
  const d = String(klNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function TodayPage() {
  const [dateISO] = useState<string>(klTodayISO());
  const [rows, setRows] = useState<MergedRow[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');

    // 1) Get full staff list
    const staffPromise = supabase
      .from('staff')
      .select('email,name')
      .order('name', { ascending: true });

    // 2) Get today's attendance via your RPC
    const attendancePromise = supabase
      .rpc('day_attendance_v2', { p_date: dateISO });

    const [staffRes, attendanceRes] = await Promise.all([staffPromise, attendancePromise]);

    // Handle errors
    if (staffRes.error) {
      setErrorText(`Staff fetch error: ${staffRes.error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }
    if (attendanceRes.error) {
      setErrorText(`Attendance fetch error: ${attendanceRes.error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const staff: StaffRow[] = (staffRes.data ?? []) as StaffRow[];
    const attendance: AttendanceRow[] = (attendanceRes.data ?? []) as AttendanceRow[];

    // Build a lookup from attendance by email
    const byEmail: Record<string, AttendanceRow> = {};
    for (const a of attendance) {
      if (a.staff_email) byEmail[a.staff_email] = a;
    }

    // Merge: ensure every staff member appears exactly once
    const merged: MergedRow[] = staff.map((s) => {
      const a = byEmail[s.email];
      return {
        staff_email: s.email,
        staff_name: s.name,
        check_in_kl: a?.check_in_kl ?? null,
        check_out_kl: a?.check_out_kl ?? null,
        late_min: a?.late_min ?? null,
      };
    });

    // Add any attendance rows whose email isn't in staff (unlikely, but safe)
    for (const a of attendance) {
      if (!staff.find((s) => s.email === a.staff_email)) {
        merged.push({
          staff_email: a.staff_email,
          staff_name: a.staff_name,
          check_in_kl: a.check_in_kl,
          check_out_kl: a.check_out_kl,
          late_min: a.late_min,
        });
      }
    }

    // Optional: keep it nicely sorted by staff_name
    merged.sort((x, y) => x.staff_name.localeCompare(y.staff_name));

    setRows(merged);
    setLoading(false);
  }, [dateISO]);

  useEffect(() => { reload(); }, [reload]);

  const hasData = useMemo(() => (rows?.length ?? 0) > 0, [rows]);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Today</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={reload} style={{ padding: '8px 12px' }}>
          Reload
        </button>
        <span>KL Date: {dateISO}</span>
      </div>

      {errorText && (
        <p style={{ color: '#b00020', marginBottom: 12 }}>{errorText}</p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f7fb' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Date (KL)</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Staff</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Check-in</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Check-out</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Late (min)</th>
            </tr>
          </thead>
          <tbody>
            {!hasData && (
              <tr>
                <td colSpan={5} style={{ padding: 12, color: '#555' }}>
                  {loading ? 'Loading…' : 'No rows.'}
                </td>
              </tr>
            )}
            {(rows ?? []).map((r) => (
              <tr key={r.staff_email}>
                <td style={{ padding: 8 }}>{dateISO}</td>
                <td style={{ padding: 8 }}>{r.staff_name}</td>
                <td style={{ padding: 8 }}>{r.check_in_kl ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.check_out_kl ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.late_min ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}