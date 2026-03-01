'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type DayRow = {
  staff_email: string;
  staff_name: string;
  check_in_kl: string | null;
  check_out_kl: string | null;
  late_min: number | null;
  status: string | null;
  no_check_in?: boolean | null;
  is_past_1030_kl?: boolean | null;
  auto_absent?: boolean | null;
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

/** Extract first HH:MM we can find */
function extractHHMM(s: string | null): { hh: number; mm: number } | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { hh, mm };
}

/** True if HH:MM is strictly after 09:30 */
function isAfter930(checkInKL: string | null): boolean {
  const t = extractHHMM(checkInKL);
  if (!t) return false;
  const minutes = t.hh * 60 + t.mm;
  return minutes > 9 * 60 + 30;
}

/** True if *now* in KL is >= 10:30 */
function computePast1030(): boolean {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  const cutoff = new Date(now);
  cutoff.setHours(10, 30, 0, 0);
  return now.getTime() >= cutoff.getTime();
}

export default function TodayPage() {
  const [dateISO] = useState<string>(klTodayISO());
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>('');
  const [notice, setNotice] = useState<string>('');

  const [, setTick] = useState(0);
  const [past1030, setPast1030] = useState<boolean>(computePast1030());

  // Tick every 30s so "auto Absent after 10:30" flips without reload
  useEffect(() => {
    const id = setInterval(() => {
      setPast1030(computePast1030());
      setTick((n) => n + 1);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Basic client-side guard (real fix is middleware later)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('is_admin');
      if (error || data !== true) {
        window.location.href = '/';
      }
    })();
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    setNotice('');

    // Admin-only RPC: returns rows only if public.is_admin() is true
    const { data, error } = await supabase.rpc('get_today_ui_v1');

    if (error) {
      setErrorText(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const out = (data as DayRow[]) ?? [];
    if (!out.length) {
      setNotice('No rows returned. If you are not admin, access is blocked.');
    }

    setRows(out);
    setLoading(false);
  }, []);

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

      {notice && (
        <p
          style={{
            color: '#374151',
            background: '#f3f4f6',
            padding: '8px 10px',
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {notice}
        </p>
      )}

      {errorText && <p style={{ color: '#b00020', marginBottom: 12 }}>{errorText}</p>}

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
              const hasAdminStatus = !!(r.status && r.status.trim() !== '');
              const after930 = isAfter930(r.check_in_kl);

              // Your original behavior: auto-mark absent after 10:30 if no status and no check-in
              const autoAbsent = !hasAdminStatus && past1030 && !r.check_in_kl;

              // Grey-out times whenever status exists (MC/OFFDAY) or we auto-mark Absent
              const blockTimes = hasAdminStatus || autoAbsent;

              const isLateMin = typeof r.late_min === 'number' && r.late_min > 0;

              return (
                <tr key={r.staff_email}>
                  <td style={{ padding: 8 }}>{dateISO}</td>
                  <td style={{ padding: 8 }}>{r.staff_name}</td>

                  <td style={{ padding: 8, fontWeight: 600 }}>
                    {hasAdminStatus ? r.status : autoAbsent ? 'Absent' : '—'}
                  </td>

                  <td
                    style={{
                      padding: 8,
                      color: blockTimes ? '#9CA3AF' : after930 ? '#dc2626' : 'inherit',
                      fontWeight: 400,
                    }}
                  >
                    {blockTimes ? '—' : r.check_in_kl ?? '—'}
                  </td>

                  <td style={{ padding: 8, color: blockTimes ? '#9CA3AF' : 'inherit' }}>
                    {blockTimes ? '—' : r.check_out_kl ?? '—'}
                  </td>

                  <td
                    style={{
                      padding: 8,
                      color: blockTimes ? '#9CA3AF' : isLateMin ? '#dc2626' : 'inherit',
                      fontWeight: isLateMin ? 700 : 400,
                    }}
                  >
                    {blockTimes ? '—' : typeof r.late_min === 'number' ? r.late_min : '—'}
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