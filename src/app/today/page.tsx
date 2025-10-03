'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

type DayRow = {
  staff_name: string;
  staff_email: string;
  check_in_kl: string | null;    // "HH:MM" from view
  check_out_kl: string | null;   // "HH:MM" from view
  late_min: number | null;       // from view
  status?: string | null;        // MC/Offday/etc from day_status (via view)
  auto_absent?: boolean;         // from view
};

function klTodayISO(): string {
  const klNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  const y = klNow.getFullYear();
  const m = String(klNow.getMonth() + 1).padStart(2, '0');
  const d = String(klNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse "HH:MM" safely and compare to 09:30. */
function isAfter930(checkInKL: string | null): boolean {
  if (!checkInKL) return false;
  const m = checkInKL.match(/(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return false;
  return (hh * 60 + mm) > (9 * 60 + 30);
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

    // Read the pre-shaped data from the view
    const { data, error } = await supabase
      .from('today_ui_v1')
      .select('staff_name, staff_email, check_in_kl, check_out_kl, late_min, status, auto_absent');

    if (error) {
      setErrorText(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as DayRow[]) ?? []);
    setLoading(false);
  }, []);

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
              const hasAdminStatus = r.status && r.status.trim() !== '';
              const after930 = isAfter930(r.check_in_kl);
              const autoAbsent = !hasAdminStatus && !!r.auto_absent;

              // Grey out times when admin status exists or auto-absent applies
              const blockTimes = hasAdminStatus || autoAbsent;

              const isLateMin = typeof r.late_min === 'number' && r.late_min > 0;

              return (
                <tr key={r.staff_email}>
                  <td style={{ padding: 8 }}>{dateISO}</td>
                  <td style={{ padding: 8 }}>{r.staff_name}</td>

                  {/* Status: admin status > auto Absent > em dash */}
                  <td style={{ padding: 8, fontWeight: 600 }}>
                    {hasAdminStatus ? r.status : (autoAbsent ? 'Absent' : '—')}
                  </td>

                  {/* Check-in: red if after 09:30, unless blocked */}
                  <td
                    style={{
                      padding: 8,
                      color: blockTimes ? '#9CA3AF' : (after930 ? '#dc2626' : 'inherit'),
                      fontWeight: 400,
                    }}
                  >
                    {blockTimes ? '—' : (r.check_in_kl ?? '—')}
                  </td>

                  <td style={{ padding: 8, color: blockTimes ? '#9CA3AF' : 'inherit' }}>
                    {blockTimes ? '—' : (r.check_out_kl ?? '—')}
                  </td>

                  {/* Late(min): red & bold when >0, unless blocked */}
                  <td
                    style={{
                      padding: 8,
                      color: blockTimes ? '#9CA3AF' : (isLateMin ? '#dc2626' : 'inherit'),
                      fontWeight: isLateMin ? 700 : 400,
                    }}
                  >
                    {blockTimes ? '—' : (typeof r.late_min === 'number' ? r.late_min : '—')}
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