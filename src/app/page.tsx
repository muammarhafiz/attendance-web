// /src/app/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Map from '../components/Map';
import { WORKSHOP } from '../config/workshop';

// Haversine distance in meters
function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sin1 = Math.sin(dLat / 2);
  const sin2 = Math.sin(dLon / 2);
  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}

type Pos = { lat: number; lon: number };

export default function HomePage() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);

  const [pos, setPos] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // read auth session once on mount (and on changes)
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      if (!mounted) return;
      setSessionEmail(user?.email ?? null);
      const metaName =
        (user?.user_metadata?.full_name as string | undefined) ||
        (user?.user_metadata?.name as string | undefined);
      setSessionName(metaName ?? (user?.email ? user.email.replace(/@.*/, '') : null));
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      mounted = false;
      sub?.subscription.unsubscribe();
    };
  }, []);

  // receive live location from the map
  const handleLocationChange = (p: Pos, accuracy?: number) => {
    setPos(p);
    setAcc(accuracy);
  };

  const dist = useMemo(() => {
    if (!pos) return null;
    return Math.round(distanceMeters(pos, { lat: WORKSHOP.lat, lon: WORKSHOP.lon }));
  }, [pos]);

  const inside = useMemo(() => {
    if (dist == null) return false;
    return dist <= WORKSHOP.radiusM;
  }, [dist]);

  const disabled = !sessionEmail || !pos || busy;

  const handleCheck = async (action: 'Check-in' | 'Check-out') => {
    if (!sessionEmail || !pos) return;
    setBusy(true);
    setMsg(null);
    try {
      const staff_name = sessionName ?? sessionEmail.replace(/@.*/, '');
      const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

      const { error } = await supabase.from('attendance').insert({
        staff_email: sessionEmail,
        staff_name,
        action,
        lat: pos.lat,
        lon: pos.lon,
        distance_m: dist ?? null,
        day,
      });

      if (error) throw new Error(error.message);
      setMsg(`${action} recorded.`);
    } catch (e: unknown) {
      setMsg(`Error: ${getErrorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 16 }}>
      {/* Banner when not signed in */}
      {!sessionEmail && (
        <div
          style={{
            background: '#fff7cc',
            border: '1px solid #f2e39a',
            color: '#6b5900',
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          Not signed in. Please go to <b>/login</b>.
        </div>
      )}

      <div style={{ marginBottom: 8, color: '#111' }}>
        <b>Workshop:</b>{' '}
        <span style={{ fontWeight: 700 }}>
          {WORKSHOP.lat.toFixed(6)}, {WORKSHOP.lon.toFixed(6)}
        </span>{' '}
        · <b>Radius:</b> {WORKSHOP.radiusM} m
      </div>

      {/* Map */}
      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <Map
          radiusM={WORKSHOP.radiusM}
          workshop={{ lat: WORKSHOP.lat, lon: WORKSHOP.lon }}
          onLocationChange={handleLocationChange}
        />
      </div>

      {/* Bottom panel (text box + buttons) */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          background: '#fff',
        }}
      >
        <div style={{ marginBottom: 12, lineHeight: 1.6 }}>
          {pos ? (
            <>
              <div>
                <b>Your location:</b> {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}{' '}
                {acc ? <span>(±{Math.round(acc)} m)</span> : null}
              </div>
              <div>
                <b>Distance to workshop:</b> {dist != null ? `${dist} m` : '—'}{' '}
                {dist != null &&
                  (inside ? (
                    <span style={{ color: '#059669' }}>✓ inside radius</span>
                  ) : (
                    <span style={{ color: '#dc2626' }}>✗ outside radius</span>
                  ))}
              </div>
            </>
          ) : (
            <span>Waiting for location…</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => handleCheck('Check-in')}
            disabled={disabled || !inside}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #047857',
              background: disabled || !inside ? '#9ca3af' : '#10b981',
              color: 'white',
              cursor: disabled || !inside ? 'not-allowed' : 'pointer',
            }}
          >
            Check in
          </button>

        <button
            onClick={() => handleCheck('Check-out')}
            disabled={disabled}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #1d4ed8',
              background: disabled ? '#9ca3af' : '#3b82f6',
              color: 'white',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            Check out
          </button>
        </div>

        {msg && (
          <div style={{ marginTop: 12, color: msg.startsWith('Error') ? '#b91c1c' : '#065f46' }}>
            {msg}
          </div>
        )}
      </div>
    </main>
  );
}