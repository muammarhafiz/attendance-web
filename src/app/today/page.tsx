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

function klTodayISO(): string {
  const klNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
  );
  const y = klNow.getFullYear();
  const m = String(klNow.getMonth() + 1).padStart(2, '0');
  const d = String(klNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Grab HH:MM from strings like "11:27", "2025-10-03 11:27:05", "11:27 am"
function extractHHMM(s: string | null): { hh: number; mm: number } | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { hh, mm };
}
function isAfter930(checkInKL: string | null): boolean {
  const t = extractHHMM(checkInKL);
  if (!t) return false;
  return (t.hh * 60 + t.mm) > (9 * 60 + 30);
}
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

  // keep past10:30 live so Absent flips without reload
  const [, setTick] = useState(0);
  const [past1030, setPast1030] = useState<boolean>(computePast1030());
  useEffect(() => {
    const id = setInterval(() => {
      setPast1030(computePast1030());
      setTick(t => t + 1);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    setNotice('');

    const { data: attData, error: attError } = await supabase
      .rpc('day_attendance_v2', { p_date: dateISO });

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('email,name')
      .order('name', { ascending: true });

    const { data: statData, error: statError } = await supabase
      .from('v_day_status_effective')
      .select('staff_email,status')
      .eq('day', dateISO);

    if (attError) {
      setErrorText(attError.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const dayRows = (attData as DayRow[]) ?? [];

    if (staffError || !staffData || staffData.length === 0) {
      if (staffError) {
        setNotice('Showing only checked-in staff. Sign in to view all staff & statuses.');
      }
      const statusMap = new Map<string, string | null>();
      if (!statError && statData) {
        for (const s of statData as StatusRow[]) {
          statusMap.set(s.staff_email.toLowerCase(), s.status);
        }
      }
      const mergedFallback = dayRows.map(r => ({
        ...r,
        status: statusMap.get(r.staff_email.toLowerCase()) ?? null,
      }));
      setRows(mergedFallback);
      setLoading(false);
      return;
    }

    const byEmail = new Map<string, DayRow>();
    for (const r of dayRows) byEmail.set(r.staff_email.toLowerCase(), r);

    const statusMap = new Map<string, string | null>();
    if (!statError && statData) {
      for (const s of statData as StatusRow[]) {
        statusMap.set(s.staff_email.toLowerCase(), s.status);
      }
    }

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

    console.table(merged); // DEBUG: confirm what front-end receives
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
              const hasAdminStatus = !!r.status && r.status.trim() !== '';
              const after930 = isAfter930(r.check_in_kl);
              const autoAbsent = !hasAdminStatus && past1030 && !r.check_in_kl;
              const blockTimes = hasAdminStatus || autoAbsent;
              const isLateMin = typeof r.late_min === 'number' && r.late_min > 0;

              return (
                <>
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
                        color: blockTimes ? '#9CA3AF' : (after930 ? '#dc2626' : '#111827'),
                        fontWeight: 400,
                      }}
                    >
                      {blockTimes ? '—' : (r.check_in_kl ?? '—')}
                    </td>

                    <td style={{ padding: 8, color: blockTimes ? '#9CA3AF' : '#111827' }}>
                      {blockTimes ? '—' : (r.check_out_kl ?? '—')}
                    </td>

                    {/* Late(min): red & bold when >0, unless blocked */}
                    <td
                      style={{
                        padding: 8,
                        color: blockTimes ? '#9CA3AF' : (isLateMin ? '#dc2626' : '#111827'),
                        fontWeight: isLateMin ? 700 : 400,
                      }}
                    >
                      {blockTimes ? '—' : (typeof r.late_min === 'number' ? r.late_min : '—')}
                    </td>
                  </tr>

                  {/* ===== DEBUG LINE (temporary): remove after verification) ===== */}
                  <tr>
                    <td colSpan={6} style={{ padding: 6, fontSize: 12, color: '#6b7280' }}>
                      <code>
                        {`email=${r.staff_email} | check_in_kl=${r.check_in_kl ?? 'null'} | after930=${after930} | past1030=${past1030} | autoAbsent=${autoAbsent} | hasAdminStatus=${hasAdminStatus}`}
                      </code>
                    </td>
                  </tr>
                  {/* ===== END DEBUG ===== */}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}