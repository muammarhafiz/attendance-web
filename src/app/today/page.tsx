'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type DayRow = {
  staff_name: string;
  staff_email: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
};

type StaffRow = { email: string; name: string | null };

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
  const [dateISO/* , setDateISO */] = useState<string>(klTodayISO());
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    setNotice('');

    // 1) Get today's attendance rows (what you had before)
    const { data: attData, error: attError } = await supabase
      .rpc('day_attendance_v2', { p_date: dateISO });

    // 2) Get all staff (requires sign-in per your RLS)
    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('email,name')
      .order('name', { ascending: true });

    if (attError) {
      setErrorText(attError.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const dayRows = (attData as DayRow[]) ?? [];
    // If we couldn't read staff (likely not signed in), fall back to just attendance rows.
    if (staffError || !staffData || staffData.length === 0) {
      if (staffError) {
        setNotice('Showing only checked-in staff. Sign in to view all staff.');
      }
      setRows(dayRows);
      setLoading(false);
      return;
    }

    // Merge: left-join staff with today's attendance by email
    const byEmail = new Map<string, DayRow>();
    for (const r of dayRows) byEmail.set(r.staff_email.toLowerCase(), r);

    const merged: DayRow[] = (staffData as StaffRow[]).map((s) => {
      const hit = byEmail.get(s.email.toLowerCase());
      return {
        staff_name: s.name ?? s.email.split('@')[0],
        staff_email: s.email,
        check_in_kl: hit?.check_in_kl ?? null,
        check_out_kl: hit?.check_out_kl ?? null,
        late_min: hit?.late_min ?? null,
      };
    });

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

      {notice && (
        <p style={{ color: '#374151', background:'#f3f4f6', padding:'8px 10px', borderRadius:8, marginBottom:12 }}>
          {notice}
        </p>
      )}
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