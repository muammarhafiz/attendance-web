'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Staff = {
  email: string;
  name: string;
};

type AttendanceRow = {
  staff_name: string;
  staff_email: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
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

    // Fetch staff list (public.get_staff_public) and today's attendance in parallel
    const [staffRes, attRes] = await Promise.all([
      supabase.rpc('get_staff_public'),
      supabase.rpc('day_attendance_v2', { p_date: dateISO }),
    ]);

    // Handle staff fetch errors
    if (staffRes.error) {
      setErrorText(`Staff load error: ${staffRes.error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    // Handle attendance fetch errors
    if (attRes.error) {
      setErrorText(`Attendance load error: ${attRes.error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const staff: Staff[] = (staffRes.data as Staff[]) ?? [];
    const attendance: AttendanceRow[] = (attRes.data as AttendanceRow[]) ?? [];

    // Create a quick lookup by email from attendance
    const byEmail = new Map<string, AttendanceRow>();
    for (const r of attendance) {
      byEmail.set(r.staff_email.toLowerCase(), r);
    }

    // Merge to ensure every staff shows up
    const merged: MergedRow[] = staff.map((s) => {
      const found = byEmail.get(s.email.toLowerCase());
      return {
        staff_email: s.email,
        staff_name: s.name,
        check_in_kl: found?.check_in_kl ?? null,
        check_out_kl: found?.check_out_kl ?? null,
        late_min: found?.late_min ?? null,
      };
    });

    // Sort by staff_name (case-insensitive)
    merged.sort((a, b) =>
      a.staff_name.localeCompare(b.staff_name, undefined, { sensitivity: 'base' })
    );

    setRows(merged);
    setLoading(false);
  }, [dateISO]);

  useEffect(() => {
    reload();
  }, [reload]);

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