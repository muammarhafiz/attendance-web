'use client';
export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import NextDynamic  from 'next/dynamic';

// dynamically load map so "window" is not used on server
const CurrentMap = NextDynamic(() => import('../components/CurrentMap'), { ssr: false }); // <-- use NextDynamic


const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const WLAT = Number(process.env.NEXT_PUBLIC_WORKSHOP_LAT);
const WLON = Number(process.env.NEXT_PUBLIC_WORKSHOP_LON);
const RADIUS_M = Number(process.env.NEXT_PUBLIC_RADIUS_M || 120);

// Haversine distance
function dist(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function Page() {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  const submit = async (action: 'Check-in' | 'Check-out') => {
    const staffId = (document.getElementById('staffId') as HTMLInputElement)?.value.trim();
    const staffName = (document.getElementById('staffName') as HTMLInputElement)?.value.trim();
    const msgEl = document.getElementById('msg') as HTMLDivElement;
    const statusEl = document.getElementById('status') as HTMLDivElement;

    if (!staffId) {
      msgEl.style.color = 'red';
      msgEl.textContent = 'Enter Staff ID.';
      return;
    }
    if (!pos) {
      msgEl.style.color = 'red';
      msgEl.textContent = 'No location yet. Tap "Refresh location" on the map.';
      return;
    }

    const d = Math.round(dist(pos.lat, pos.lon, WLAT, WLON));
    statusEl.innerHTML =
      `Your location: <b>${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}</b><br>` +
      `Accuracy: ${acc ? `~${Math.round(acc)} m` : 'n/a'}<br>` +
      `Distance to workshop: <b>${d}</b> m ${
        d > RADIUS_M ? '<span style="color:#b91c1c">(outside radius)</span>' : ''
      }`;

    msgEl.style.color = 'black';
    msgEl.textContent = 'Submitting…';

    const { data, error } = await supabase.rpc('submit_attendance', {
      p_action: action,
      p_lat: pos.lat,
      p_lon: pos.lon,
      p_staff_id: staffId,
      p_staff_name: staffName || null,
    });

    if (error) {
      msgEl.style.color = 'red';
      msgEl.textContent = error.message;
      return;
    }
    msgEl.style.color = data?.ok ? 'green' : 'red';
    msgEl.textContent = data?.msg || 'Done';
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Workshop Attendance</h2>

      <div style={{ margin: '12px 0' }}>
        <CurrentMap onLocationChange={(p, a) => { setPos(p); setAcc(a ?? null); }} />
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
        <label>Staff ID</label>
        <input
          id="staffId"
          placeholder="e.g. S001"
          style={{ width: '100%', padding: 12, border: '1px solid #ccc', borderRadius: 8 }}
        />
        <label style={{ marginTop: 10, display: 'block' }}>Display name (optional)</label>
        <input
          id="staffName"
          placeholder="e.g. Ali"
          style={{ width: '100%', padding: 12, border: '1px solid #ccc', borderRadius: 8 }}
        />
      </div>

      <div
        id="status"
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 16,
          margin: '12px 0',
          color: '#666',
        }}
      >
        Waiting for location…
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
        <button
          onClick={() => submit('Check-in')}
          style={{
            width: '100%',
            padding: 14,
            border: 0,
            borderRadius: 8,
            background: '#16a34a',
            color: '#fff',
            fontSize: 16,
            marginTop: 6,
          }}
        >
          Check in
        </button>
        <button
          onClick={() => submit('Check-out')}
          style={{
            width: '100%',
            padding: 14,
            border: 0,
            borderRadius: 8,
            background: '#0ea5e9',
            color: '#fff',
            fontSize: 16,
            marginTop: 6,
          }}
        >
          Check out
        </button>
        <div id="msg" style={{ marginTop: 10 }} />
      </div>
    </main>
  );
}
