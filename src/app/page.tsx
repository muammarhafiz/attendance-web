'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState, useCallback } from 'react';
import NextDynamic from 'next/dynamic';
import { supabase } from '@/lib/supabaseClient';

const CurrentMap = NextDynamic(() => import('../components/CurrentMap'), { ssr: false });

type Pos = { lat: number; lon: number };
type ConfigRow = { workshop_lat: number; workshop_lon: number; radius_m: number };

function toKLString(d: Date) {
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: true });
}

function haversineMeters(a: Pos, b: Pos) {
  const R = 6371e3;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function HomePage() {
  // live KL clock
  const [time, setTime] = useState<string>(() => toKLString(new Date()));
  useEffect(() => {
    const t = setInterval(() => setTime(toKLString(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  // auth
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setEmail(user?.email ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setEmail(sess?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // config (workshop)
  const [cfg, setCfg] = useState<ConfigRow | null>(null);
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('config')
        .select('workshop_lat, workshop_lon, radius_m')
        .limit(1)
        .maybeSingle();
      if (error) setCfgErr(error.message);
      else if (data) setCfg(data as ConfigRow);
    })();
  }, []);

  // map location
  const [pos, setPos] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const onLoc = useCallback((p: Pos, a?: number) => {
    setPos(p);
    if (typeof a === 'number') setAcc(a);
  }, []);

  const wk: Pos | null = useMemo(() => {
    if (!cfg) return null;
    return { lat: cfg.workshop_lat, lon: cfg.workshop_lon };
  }, [cfg]);

  const distM = useMemo(() => {
    if (!wk || !pos) return null;
    return Math.round(haversineMeters(pos, wk));
  }, [wk, pos]);

  const inside = useMemo(() => {
    if (distM == null || !cfg) return false;
    return distM <= cfg.radius_m;
  }, [distM, cfg]);

  // actions
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const doAction = async (action: 'Check-in' | 'Check-out') => {
    if (!email) return setMsg('Please sign in first.');
    if (!cfg || !wk) return setMsg('Workshop location not ready.');
    if (!pos) return setMsg('Waiting for location…');
    if (!inside && action === 'Check-in') {
      return setMsg('You are outside the allowed radius.');
    }

    setBusy(true);
    setMsg(null);
    const now = new Date();
    const nameGuess = email.split('@')[0];

    const { error } = await supabase.from('attendance').insert({
      staff_name: nameGuess,
      staff_email: email,
      action,
      ts: now.toISOString(),
      lat: pos.lat,
      lon: pos.lon,
      distance_m: distM ?? null,
    });

    if (error) {
      if (error.message.includes('attendance_one_checkin_per_day')) {
        setMsg('You already checked in today.');
      } else {
        setMsg(error.message);
      }
    } else {
      setMsg(action === 'Check-in' ? 'Checked in!' : 'Checked out!');
    }
    setBusy(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail(null);
  };

  return (
    <main style={{ fontFamily: 'system-ui', paddingBottom: 32 }}>
      {/* Header row (title • clock • sign out) */}
      <div style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
        marginBottom: 8
      }}>
        <h2 style={{ margin: 0 }}>Workshop Attendance</h2>
        <div aria-label="Kuala Lumpur time" style={{ fontWeight: 600, marginRight: 'auto', marginLeft: 12 }}>
          {time}
        </div>
        <button
          onClick={signOut}
          style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}
        >
          Sign Out
        </button>
      </div>

      {/* signed-in status */}
      <div style={{ marginBottom: 12 }}>
        {email
          ? <div style={{ padding: 10, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8fafc' }}>
              Signed in as <strong>{email}</strong>
            </div>
          : <div style={{ padding: 10, border: '1px solid #fde68a', borderRadius: 8, background: '#fffbeb' }}>
              Not signed in. Please go to <a href="/login">/login</a>.
            </div>
        }
      </div>

      {/* workshop info */}
      <div style={{ marginBottom: 8, fontSize: 16 }}>
        Workshop:{' '}
        {wk ? <strong>{wk.lat.toFixed(6)}, {wk.lon.toFixed(6)}</strong> : <em>loading…</em>}
        {' '} • Radius: <strong>{cfg?.radius_m ?? '…'} m</strong>
      </div>

      {/* map */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        {wk
          ? <CurrentMap
              radiusM={cfg?.radius_m ?? 120}
              workshop={{ lat: wk.lat, lon: wk.lon }}
              onLocationChange={onLoc}
            />
          : <div style={{ padding: 16 }}>Loading map…</div>
        }
      </div>

      {/* location + actions */}
      <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <div style={{ marginBottom: 8 }}>
          {pos
            ? <>Your location: <strong>{pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}</strong>{acc ? <> (±{Math.round(acc)} m)</> : null}</>
            : <>Waiting for location…</>
          }
          {distM != null && cfg
            ? <div style={{ marginTop: 6 }}>
                Distance to workshop: <strong>{distM} m</strong>{' '}
                {inside ? <span style={{ color: '#16a34a' }}>✓ inside radius</span> : <span style={{ color: '#b91c1c' }}>✗ outside radius</span>}
              </div>
            : null}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            disabled={!email || !pos || !inside || busy}
            onClick={() => doAction('Check-in')}
            style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', fontWeight: 600 }}
          >
            Check in
          </button>
          <button
            disabled={!email || !pos || busy}
            onClick={() => doAction('Check-out')}
            style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #0ea5e9', background: '#0ea5e9', color: '#fff', fontWeight: 600 }}
          >
            Check out
          </button>
        </div>

        {msg && <div style={{ marginTop: 10 }}>{msg}</div>}
        {cfgErr && <div style={{ marginTop: 8, color: '#b91c1c' }}>{cfgErr}</div>}
      </div>
    </main>
  );
}