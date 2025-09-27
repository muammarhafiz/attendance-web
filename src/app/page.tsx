'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabaseClient';

const CurrentMap = dynamic(() => import('@/components/CurrentMap'), { ssr: false });

type SubmitResult = { ok?: boolean; msg?: string; distance_m?: number } | null;

type Cfg = { lat: number; lon: number; radius: number };

function SignOutButton() {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };
  return (
    <button
      onClick={handleSignOut}
      style={{ padding: 8, border: '1px solid #ccc', borderRadius: 6, background: '#fff' }}
    >
      Sign Out
    </button>
  );
}

export default function HomePage() {
  const [email, setEmail] = useState<string>('');
  const [statusText, setStatusText] = useState<string>('Waiting for location…');
  const [busy, setBusy] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<SubmitResult>(null);
  const [canShowLogBtn, setCanShowLogBtn] = useState<boolean>(false);

  // config from DB (single source of truth)
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [cfgError, setCfgError] = useState<string>('');

  // Guard: must be signed in; also get email
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      setEmail(data.session.user.email ?? '');
    })();
  }, []);

  // Load workshop config from DB (one source)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('config')
        .select('workshop_lat, workshop_lon, radius_m')
        .limit(1)
        .single();

      if (error) {
        setCfgError(error.message);
        return;
      }
      if (!data?.workshop_lat || !data?.workshop_lon || !data?.radius_m) {
        setCfgError('Workshop config missing: set workshop_lat, workshop_lon, radius_m in public.config');
        return;
      }
      setCfg({ lat: Number(data.workshop_lat), lon: Number(data.workshop_lon), radius: Number(data.radius_m) });
    })();
  }, []);

  // Called by the map; informational
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

        // Server uses signed-in email + DB config
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

  const shell: React.CSSProperties = { padding: 16, fontFamily: 'system-ui', maxWidth: 640, margin: '0 auto' };
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
    <main style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Workshop Attendance</h2>
        <SignOutButton />
      </div>

      {/* Signed-in banner */}
      <div style={box}>
        <div style={{ color: '#555' }}>
          Signed in as <b>{email || '(not signed in)'}</b>
        </div>
      </div>

      {/* Config load status */}
      {!cfg && (
        <div style={{ ...box, color: cfgError ? '#b91c1c' : '#666' }}>
          {cfgError ? `Config error: ${cfgError}` : 'Loading workshop location…'}
        </div>
      )}

      {/* Map uses DB config only */}
      {cfg && (
        <div style={box}>
          <div style={{ marginBottom: 8, color: '#555' }}>
            Workshop: <b>{cfg.lat.toFixed(6)}, {cfg.lon.toFixed(6)}</b> • Radius: <b>{cfg.radius} m</b>
          </div>
          <CurrentMap
            workshop={{ lat: cfg.lat, lon: cfg.lon }}
            radiusM={cfg.radius}
            onLocationChange={onLocationChange}
          />
        </div>
      )}

      {/* Status + actions */}
      <div style={box}>
        <div id="status" style={{ color: '#666', marginBottom: 8 }}>
          {statusText}
        </div>
        <button
          onClick={() => submit('Check-in')}
          disabled={busy || !cfg}
          style={{ ...btn, background: '#16a34a', opacity: busy || !cfg ? 0.7 : 1 }}
        >
          {busy ? 'Checking in…' : 'Check in'}
        </button>
        <button
          onClick={() => submit('Check-out')}
          disabled={busy || !cfg}
          style={{ ...btn, background: '#0ea5e9', opacity: busy || !cfg ? 0.7 : 1 }}
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
                background: '#fff',
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