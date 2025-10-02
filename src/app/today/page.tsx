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
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');

    // 1) Fetch all staff (name + email)
    const { data: staff, error: staffErr } = await supabase
      .from('staff')
      .select('email,name')
      .order('name', { ascending: true });

    if (staffErr) {
      setErrorText(`Staff load error: ${staffErr.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    // 2) Fetch today's computed attendance rows (keeps your existing logic)
    const { data: att, error: attErr } = await supabase
      .rpc('day_attendance_v2', { p_date: dateISO });

    if (attErr) {
      setErrorText(`Attendance load error: ${attErr.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const attendance = (att as AttendanceRow[]) ?? [];
    const staffList = (staff as StaffRow[]) ?? [];

    // 3) Index attendance by email for quick merge
    const byEmail = new Map<string, AttendanceRow>();
    for (const r of attendance) byEmail.set(r.staff_email, r);

    // 4) Merge: one row per staff, fill blanks with "—"
    const merged: AttendanceRow[] = staffList.map((s) => {
      const found = byEmail.get(s.email);
      return {
        staff_email: s.email,
        staff_name: s.name,
        check_in_kl: found?.check_in_kl ?? null,
        check_out_kl: found?.check_out_kl ?? null,
        late_min: found?.late_min ?? null,
      };
    });

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