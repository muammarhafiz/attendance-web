'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import NextDynamic from 'next/dynamic';
import { WORKSHOP } from '../config/workshop';
import { supabase } from '../lib/supabaseClient';

// Map without SSR
const CurrentMap = NextDynamic(() => import('../components/CurrentMap'), { ssr: false });

// Haversine distance (meters)
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

type RpcResult = { ok?: boolean; msg?: string } | null;
function errMsgFromUnknown(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export default function Page() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [showLogBtn, setShowLogBtn] = useState(false);

  // Auth gate
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login';
      } else {
        setSessionEmail(data.session.user.email ?? null);
      }
    });
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const submit = async (action: 'Check-in' | 'Check-out') => {
    const staffIdInput = document.getElementById('staffId') as HTMLInputElement | null;
    const staffNameInput = document.getElementById('staffName') as HTMLInputElement | null;
    const msgEl = document.getElementById('msg') as HTMLDivElement | null;
    const statusEl = document.getElementById('status') as HTMLDivElement | null;

    setShowLogBtn(false);

    const staffId = (staffIdInput?.value ?? '').trim();
    const staffName = (staffNameInput?.value ?? '').trim();

    if (!msgEl || !statusEl) return;
    if (!staffId) { msgEl.style.color = 'red'; msgEl.textContent = 'Enter Staff ID.'; return; }
    if (!pos) { msgEl.style.color = 'red'; msgEl.textContent = 'No location yet. Tap "Refresh location" on the map.'; return; }

    const d = Math.round(dist(pos.lat, pos.lon, WORKSHOP.lat, WORKSHOP.lon));
    statusEl.innerHTML =
      `Workshop: <b>${WORKSHOP.lat.toFixed(6)}, ${WORKSHOP.lon.toFixed(6)}</b> (r=${WORKSHOP.radiusM} m)<br>` +
      `Your location: <b>${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}</b><br>` +
      `Accuracy: ${acc ? `~${Math.round(acc)} m` : 'n/a'}<br>` +
      `Distance to workshop: <b>${d}</b> m ${d > WORKSHOP.radiusM ? '<span style="color:#b91c1c">(outside radius)</span>' : ''}`;

    msgEl.style.color = 'black';
    msgEl.textContent = 'Submitting…';

    // Try RPC first (if you kept it); otherwise direct insert
    let ok = false;
    let errText: string | null = null;

    try {
      const { data, error } = await supabase.rpc('submit_attendance', {
        p_action: action,
        p_lat: pos.lat,
        p_lon: pos.lon,
        p_staff_id: staffId,
        p_staff_name: staffName || null,
      });
      if (error) errText = error.message;
      else {
        const r: RpcResult = data as RpcResult;
        ok = !!(r && (r.ok === true || typeof r.msg === 'string'));
      }
    } catch (e: unknown) {
      errText = errMsgFromUnknown(e);
    }

    if (!ok) {
      try {
        const { error: insErr } = await supabase.from('attendance').insert([{
          action,
          lat: pos.lat,
          lon: pos.lon,
          staff_id: staffId,
          staff_name: staffName || null,
          distance_m: d,
        }]);
        if (!insErr) { ok = true; errText = null; }
        else errText = insErr.message;
      } catch (e: unknown) {
        errText = errMsgFromUnknown(e);
      }
    }

    if (!ok) { msgEl.style.color = 'red'; msgEl.textContent = errText ?? 'Submit failed.'; return; }

    msgEl.style.color = 'green';
    msgEl.textContent = 'Saved';
    if (d <= WORKSHOP.radiusM) setShowLogBtn(true);
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Workshop Attendance</h2>
        <div style={{ fontSize: 14, color: '#555' }}>
          {sessionEmail && <span style={{ marginRight: 8 }}>{sessionEmail}</span>}
          <button onClick={signOut} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ margin: '12px 0' }}>
        <CurrentMap onLocationChange={(p, a) => { setPos(p); setAcc(a ?? null); }} />
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
        <label>Staff ID</label>
        <input id="staffId" placeholder="e.g. S001" style={{ width: '100%', padding: 12, border: '1px solid #ccc', borderRadius: 8 }} />
        <label style={{ marginTop: 10, display: 'block' }}>Display name (optional)</label>
        <input id="staffName" placeholder="e.g. Ali" style={{ width: '100%', padding: 12, border: '1px solid #ccc', borderRadius: 8 }} />
      </div>

      <div id="status" style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0', color: '#666' }}>
        Waiting for location…
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
        <button onClick={() => submit('Check-in')}  style={{ width: '100%', padding: 14, border: 0, borderRadius: 8, background: '#16a34a', color: '#fff', fontSize: 16, marginTop: 6 }}>Check in</button>
        <button onClick={() => submit('Check-out')} style={{ width: '100%', padding: 14, border: 0, borderRadius: 8, background: '#0ea5e9', color: '#fff', fontSize: 16, marginTop: 6 }}>Check out</button>

        {showLogBtn && (
          <a href="/today" style={{ display: 'inline-block', textDecoration: 'none', marginTop: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}>
            View Today’s Log
          </a>
        )}
        <div id="msg" style={{ marginTop: 10 }} />
      </div>
    </main>
  );
}