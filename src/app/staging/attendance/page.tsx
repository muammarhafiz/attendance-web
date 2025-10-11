'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr'; // your repo already uses @supabase/ssr
import type { Session } from '@supabase/supabase-js';

type TodayRow = {
  display_name: string | null;
  staff_email: string;
  day: string;              // 'YYYY-MM-DD'
  status: 'PRESENT' | 'ABSENT' | 'OFFDAY' | 'MC';
  check_in_kl: string | null;   // 'HH:MM:SS.mmm' or null
  check_out_kl: string | null;  // 'HH:MM:SS.mmm' or null
  late_min: number | null;
};

const box: React.CSSProperties = { maxWidth: 1080, margin: '16px auto', padding: 16 };
const btn: React.CSSProperties = { padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd' };
const badge = (text: string, tone: 'ok' | 'warn' | 'absent') => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  background:
    tone === 'ok' ? 'rgba(16,185,129,.12)' : tone === 'warn' ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)',
  color:
    tone === 'ok' ? '#065f46' : tone === 'warn' ? '#7c2d12' : '#7f1d1d',
  border:
    tone === 'ok' ? '1px solid rgba(16,185,129,.35)' : tone === 'warn' ? '1px solid rgba(245,158,11,.35)' : '1px solid rgba(239,68,68,.35)',
});

export default function StagingAttendancePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<TodayRow[]>([]);
  const [geo, setGeo] = useState<{ lat: number | null; lon: number | null; err?: string }>({ lat: null, lon: null });

  const supabase = useMemo(() => {
    // Uses your NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
    return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  }, []);

  const fetchSessionAndAdmin = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session ?? null);

    if (!session?.user?.email) {
      setIsAdmin(false);
      return;
    }
    // check admin flag
    const { data: staff, error } = await supabase
      .from('staff')
      .select('is_admin')
      .eq('email', session.user.email)
      .maybeSingle();

    if (error) {
      console.error(error);
      setIsAdmin(false);
    } else {
      setIsAdmin(!!staff?.is_admin);
    }
  }, [supabase]);

  const fetchToday = useCallback(async () => {
    const { data, error } = await supabase
      .from('v2_today') // public view -> att_v2.v_today_with_names (security_invoker)
      .select('*')
      .order('display_name', { ascending: true });

    if (error) {
      console.error(error);
      setToday([]);
      return;
    }
    setToday((data ?? []) as TodayRow[]);
  }, [supabase]);

  const getLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ lat: null, lon: null, err: 'Geolocation not supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setGeo({ lat: null, lon: null, err: err.message || 'Failed to get location' });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 }
    );
  }, []);

  const doCheck = useCallback(
    async (kind: 'in' | 'out') => {
      const fn = kind === 'in' ? 'att_v2.check_in' : 'att_v2.check_out';
      const { lat, lon } = geo;

      const { data, error } = await supabase.rpc(fn, {
        p_lat: lat ?? null,
        p_lon: lon ?? null,
        p_note: null,
      });

      if (error) {
        alert(`${kind === 'in' ? 'Check-in' : 'Check-out'} failed: ${error.message}`);
        console.error(error);
        return;
      }
      // refresh table
      await fetchToday();
    },
    [geo, supabase, fetchToday]
  );

  useEffect(() => {
    (async () => {
      await fetchSessionAndAdmin();
      await fetchToday();
      setLoading(false);
    })();
  }, [fetchSessionAndAdmin, fetchToday]);

  useEffect(() => {
    // Try to get location immediately
    getLocation();
  }, [getLocation]);

  if (loading) {
    return <div style={box}><h1>Staging Attendance (v2)</h1><p>Loading…</p></div>;
  }

  if (!session) {
    return (
      <div style={box}>
        <h1>Staging Attendance (v2)</h1>
        <p>Please sign in to continue.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={box}>
        <h1>Staging Attendance (v2)</h1>
        <p>Access limited to admins. Your account is not marked as admin in <code>staff</code>.</p>
      </div>
    );
  }

  return (
    <div style={box}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Staging Attendance (v2)</h1>
      <p style={{ marginBottom: 12 }}>This page calls <code>att_v2.check_in/out</code> and reads <code>public.v2_today</code>. It does not affect your production flows.</p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button style={btn} onClick={() => getLocation()}>Get GPS</button>
        <button style={btn} onClick={() => doCheck('in')}>Check-In (v2)</button>
        <button style={btn} onClick={() => doCheck('out')}>Check-Out (v2)</button>

        {geo.err ? (
          <span style={badge('warn', 'warn')}>GPS: {geo.err}</span>
        ) : (
          <span style={badge('ok', 'ok')}>
            GPS {geo.lat?.toFixed(6) ?? '–'},{' '}{geo.lon?.toFixed(6) ?? '–'}
          </span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Today (KL)</h2>
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Name</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Email</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Status</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Check-In</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Check-Out</th>
                <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Late (min)</th>
              </tr>
            </thead>
            <tbody>
              {today.map((r, i) => {
                const isLate = (r.late_min ?? 0) > 0 && r.status === 'PRESENT';
                const isAbsent = r.status === 'ABSENT';
                return (
                  <tr key={r.staff_email + i} style={{ background: i % 2 ? '#fff' : '#fcfcfc' }}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{r.display_name ?? '—'}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{r.staff_email}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>
                      <span style={badge(r.status, isAbsent ? 'absent' : 'ok')}>{r.status}</span>
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', color: isLate ? '#b91c1c' : undefined, fontWeight: isLate ? 700 : 400 }}>
                      {r.check_in_kl ?? '—'}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>
                      {r.check_out_kl ?? '—'}
                    </td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: isLate ? '#b91c1c' : fontWeight: isLate ? 700 : 400 }}>
                      {r.late_min ?? 0}
                    </td>
                  </tr>
                );
              })}
              {!today.length && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>No rows.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
          Cutoff for late = 10:30 AM Asia/Kuala_Lumpur (staging).
        </div>
      </div>
    </div>
  );
}