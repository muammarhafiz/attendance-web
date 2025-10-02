'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type DayRow = {
  staff_name: string;
  staff_email: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
  status?: string | null; // <- MC / Offday / etc (from day_status)
};

type StaffRow = { email: string; name: string | null };
type StatusRow = { staff_email: string; status: string | null };

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

    // 1) Today's attendance (existing RPC)
    const { data: attData, error: attError } = await supabase
      .rpc('day_attendance_v2', { p_date: dateISO });

    // 2) All staff (needs sign-in per RLS)
    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('email,name')
      .order('name', { ascending: true });

    // 3) Today statuses (MC/Offday/etc). If table name/cols differ, tell me and I’ll tweak.
    const { data: statData, error: statError } = await supabase
      .from('day_status')
      .select('staff_email,status')
      .eq('day', dateISO);

    if (attError) {
      setErrorText(attError.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const dayRows = (attData as DayRow[]) ?? [];

    // If staff is blocked by RLS (not signed in), fall back to only attendance rows.
    if (staffError || !staffData || staffData.length === 0) {
      if (staffError) {
        setNotice('Showing only checked-in staff. Sign in to view all staff & statuses.');
      }
      // Even in fallback, try to attach statuses where we can
      const statusMap = new Map<string, string | null>();
      if (!statError && statData) {
        for (const s of statData as StatusRow[]) statusMap.set(s.staff_email.toLowerCase(), s.status);
      }
      const mergedFallback = dayRows.map(r => ({
        ...r,
        status: statusMap.get(r.staff_email.toLowerCase()) ?? null,
      }));
      setRows(mergedFallback);
      setLoading(false);
      return;
    }

    // Build maps for merging
    const byEmail = new Map<string, DayRow>();
    for (const r of dayRows) byEmail.set(r.staff_email.toLowerCase(), r);

    const statusMap = new Map<string, string | null>();
    if (!statError && statData) {
      for (const s of statData as StatusRow[]) statusMap.set(s.staff_email.toLowerCase(), s.status);
    }

    // Merge: left-join staff with attendance, then attach status
    const merged: DayRow[] = (staffData as StaffRow[]).map((s) => {
      const key = s.email.toLowerCase();
      const hit = byEmail.get(key);
      return {
        staff_name: s.name ?? s.email.split('@')[0],
        staff_email: s.email,
        check_in_kl: hit?.check_in_kl ?? null,
        check_out_kl: hit?.check_out_kl ?? null,
        late_min: hit?.late_min ?? null,
        status: statusMap.get(key) ?? null,
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
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Check-in</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Check-out</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Late (min)</th>
            </tr>
          </thead>
          <tbody>
            {!hasData && (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: '#555' }}>
                  {loading ? 'Loading…' : 'No rows.'}
                </td>
              </tr>
            )}
            {(rows ?? []).map((r) => {
              const showStatus = r.status && r.status.trim() !== '';
              return (
                <tr key={r.staff_email}>
                  <td style={{ padding: 8 }}>{dateISO}</td>
                  <td style={{ padding: 8 }}>{r.staff_name}</td>
                  <td style={{ padding: 8, fontWeight: 600 }}>
                    {showStatus ? r.status : '—'}
                  </td>
                  <td style={{ padding: 8, color: showStatus ? '#9CA3AF' : 'inherit' }}>
                    {showStatus ? '—' : (r.check_in_kl ?? '—')}
                  </td>
                  <td style={{ padding: 8, color: showStatus ? '#9CA3AF' : 'inherit' }}>
                    {showStatus ? '—' : (r.check_out_kl ?? '—')}
                  </td>
                  <td style={{ padding: 8, color: showStatus ? '#9CA3AF' : 'inherit' }}>
                    {showStatus ? '—' : (r.late_min ?? '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}