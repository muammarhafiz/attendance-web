'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabaseClient';

const CurrentMap = dynamic(() => import('@/components/CurrentMap'), { ssr: false });

type SubmitResult = { ok?: boolean; msg?: string; distance_m?: number } | null;

const WLAT = Number(process.env.NEXT_PUBLIC_WORKSHOP_LAT);
const WLON = Number(process.env.NEXT_PUBLIC_WORKSHOP_LON);
const RADIUS_M = Number(process.env.NEXT_PUBLIC_RADIUS_M || 120);

export default function HomePage() {
  const [email, setEmail] = useState<string>('');
  const [statusText, setStatusText] = useState<string>('Waiting for location…');
  const [busy, setBusy] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<SubmitResult>(null);
  const [canShowLogBtn, setCanShowLogBtn] = useState<boolean>(false);

  // show who is signed in
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? '');
    });
  }, []);

  // Called by the map on refresh; purely informational
  const onLocationChange = (pos: { lat: number; lon: number }, acc?: number) => {
    const accTxt = acc ? ` (±${Math.round(acc)} m)` : '';
    setStatusText(`Your location: ${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}${accTxt}`);
  };

  const submit = async (action: 'Check-in' | 'Check-out') => {
    setBusy(true);
    setLastResult(null);
    setStatusText('Getting location…');

    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude;
        const lon = p.coords.longitude;
        const acc = Math.round(p.coords.accuracy);
        setStatusText(`Your location: ${lat.toFixed(6)}, ${lon.toFixed(6)} (±${acc} m)`);

        // Server-side: uses your signed-in email + staff name mapping
        const { data, error } = await supabase.rpc('submit_attendance_auto', {
          p_action: action,
          p_lat: lat,
          p_lon: lon,
        });

        if (error) {
          setLastResult({ ok: false, msg: error.message });
          setCanShowLogBtn(false);
        } else {
          const res = (data as SubmitResult) ?? { ok: false, msg: 'No response' };
          setLastResult(res);
          setCanShowLogBtn(!!res?.ok);
        }
        setBusy(false);
      },
      (err) => {
        setLastResult({ ok: false, msg: `Location error: ${err.message}` });
        setBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  const box: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' };
  const btn: React.CSSProperties = {
    width: '100%',
    padding: 14,
    border: 0,
    borderRadius: 8,
    color: '#fff',
    fontSize: 16,
    marginTop: 6,
    cursor: 'pointer',
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 640, margin: '0 auto' }}>
      <h2>Workshop Attendance</h2>

      {/* Signed-in banner */}
      <div style={box}>
        <div style={{ color: '#555' }}>
          Signed in as <b>{email || '(not signed in)'}</b>
        </div>
      </div>

      {/* Map */}
      <div style={box}>
        <CurrentMap
          workshop={{ lat: WLAT, lon: WLON }}
          radiusM={RADIUS_M}
          onLocationChange={onLocationChange}
        />
      </div>

      {/* Status + actions */}
      <div style={box}>
        <div id="status" style={{ color: '#666', marginBottom: 8 }}>
          {statusText}
        </div>
        <button
          onClick={() => submit('Check-in')}
          disabled={busy}
          style={{ ...btn, background: '#16a34a', opacity: busy ? 0.7 : 1 }}
        >
          {busy ? 'Checking in…' : 'Check in'}
        </button>
        <button
          onClick={() => submit('Check-out')}
          disabled={busy}
          style={{ ...btn, background: '#0ea5e9', opacity: busy ? 0.7 : 1 }}
        >
          {busy ? 'Checking out…' : 'Check out'}
        </button>
        <div id="msg" style={{ marginTop: 10, color: lastResult?.ok ? '#16a34a' : '#b91c1c' }}>
          {lastResult?.msg}
        </div>

        {canShowLogBtn && (
          <div style={{ marginTop: 10 }}>
            <a
              href="/today"
              style={{
                display: 'inline-block',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #ddd',
                textDecoration: 'none',
              }}
            >
              View Today Log
            </a>
          </div>
        )}
      </div>
    </main>
  );
}