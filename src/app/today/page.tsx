'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type DayRow = {
  staff_name: string;
  staff_email: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
  status?: string | null; // MC / Offday / etc
};

type StaffRow = { email: string; name: string | null };
type StatusRow = { staff_email: string; status: string | null };

// --- KL helpers (pure, local) ---
function klNowDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
}
function klTodayISO(): string {
  const n = klNowDate();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function isPast1030KL(): boolean {
  const now = klNowDate();
  const cutoff = new Date(now);
  cutoff.setHours(10, 30, 0, 0);
  return now >= cutoff;
}

export default function TodayPage() {
  const [dateISO] = useState<string>(klTodayISO());
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    setNotice('');

    // 1) today’s attendance
    const { data: attData, error: attError } = await supabase
      .rpc('day_attendance_v2', { p_date: dateISO });

    // 2) all staff (requires sign-in)
    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('email,name')
      .order('name', { ascending: true });

    // 3) today statuses (MC/Offday/etc)
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

    // fallback if staff blocked by RLS
    if (staffError || !staffData || staffData.length === 0) {
      if (staffError) {
        setNotice('Showing only checked-in staff. Sign in to view all staff & statuses.');
      }
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

    // build maps for merge
    const byEmail = new Map<string, DayRow>();
    for (const r of dayRows) byEmail.set(r.staff_email.toLowerCase(), r);

    const statusMap = new Map<string, string | null>();
    if (!statError && statData) {
      for (const s of statData as StatusRow[]) statusMap.set(s.staff_email.toLowerCase(), s.status);
    }

    // left-join staff with attendance, then attach status
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
  const past1030 = isPast1030KL();

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
              const adminStatus = r.status && r.status.trim() !== '' ? r.status!.trim() : null;
              const noCheckIn = !r.check_in_kl;
              const autoAbsent = !adminStatus && past1030 && noCheckIn;

              const displayStatus = adminStatus ?? (autoAbsent ? 'Absent' : '—');

              const late = typeof r.late_min === 'number' ? r.late_min : null;
              const lateIsPositive = !adminStatus && late !== null && late > 0;
              const isStatusBlocking = !!adminStatus || autoAbsent;

              return (
                <tr key={r.staff_email}>
                  <td style={{ padding: 8 }}>{dateISO}</td>
                  <td style={{ padding: 8 }}>{r.staff_name}</td>
                  <td style={{ padding: 8, fontWeight: 600 }}>
                    {displayStatus}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      color: isStatusBlocking ? '#9CA3AF' : (lateIsPositive ? '#dc2626' : 'inherit'),
                      fontWeight: 400, // keep original weight (no layout shift)
                    }}
                  >
                    {isStatusBlocking ? '—' : (r.check_in_kl ?? '—')}
                  </td>
                  <td style={{ padding: 8, color: isStatusBlocking ? '#9CA3AF' : 'inherit' }}>
                    {isStatusBlocking ? '—' : (r.check_out_kl ?? '—')}
                  </td>
                  <td
                    style={{
                      padding: 8,
                      color: isStatusBlocking ? '#9CA3AF' : (lateIsPositive ? '#dc2626' : 'inherit'),
                      fontWeight: lateIsPositive ? 700 : 400, // your original “Late (min)” emphasis
                    }}
                  >
                    {isStatusBlocking ? '—' : (late ?? '—')}
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