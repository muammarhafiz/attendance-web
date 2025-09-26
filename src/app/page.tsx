'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import NextDynamic from 'next/dynamic';
import { WORKSHOP } from '../config/workshop';
import { supabase } from '../lib/supabaseClient';

const CurrentMap = NextDynamic(() => import('../components/CurrentMap'), { ssr: false });

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
function errMsg(e: unknown) {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export default function Page() {
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [showLogBtn, setShowLogBtn] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info'|'ok'|'err'; text: string } | null>(null);

  // Auth gate — wait for session; don't instantly bounce to /login
  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) {
        setEmail(session.user.email ?? null);
        setAuthReady(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setEmail(data.session.user.email ?? null);
        setAuthReady(true);
      } else {
        // Give time for Supabase to parse tokens after redirect
        setTimeout(async () => {
          const again = await supabase.auth.getSession();
          if (!again.data.session) window.location.href = '/login';
        }, 1500);
      }
    });

    return () => sub.data.subscription.unsubscribe();
  }, []);

  const submit = async (action: 'Check-in' | 'Check-out') => {
    if (busy) return;
    setShowLogBtn(false);

    const staffId = (document.getElementById('staffId') as HTMLInputElement | null)?.value.trim() ?? '';
    const staffName = (document.getElementById('staffName') as HTMLInputElement | null)?.value.trim() ?? '';

    if (!staffId) { setBanner({ kind:'err', text:'Enter Staff ID.' }); return; }
    if (!pos)     { setBanner({ kind:'err', text:'No location yet. Tap “Refresh location” on the map and allow permission.' }); return; }

    const d = Math.round(dist(pos.lat, pos.lon, WORKSHOP.lat, WORKSHOP.lon));
    setBanner({ kind:'info', text:'Submitting…' });
    setBusy(true);

    try {
      const { error } = await supabase.from('attendance').insert([{
        action,
        lat: pos.lat,
        lon: pos.lon,
        staff_id: staffId,
        staff_name: staffName || null,
        distance_m: d,
      }]);

      if (error) {
        setBanner({ kind:'err', text:`Error: ${error.message}` });
        console.error('Insert error', error);
      } else {
        setBanner({ kind:'ok', text:'Saved' });
        if (d <= WORKSHOP.radiusM) setShowLogBtn(true);
      }
    } catch (e) {
      setBanner({ kind:'err', text:`Error: ${errMsg(e)}` });
    } finally {
      setBusy(false);
    }
  };

  if (!authReady) {
    return (
      <main style={{ padding: 16, fontFamily: 'system-ui' }}>
        <h2>Workshop Attendance</h2>
        <div style={{ marginTop: 12, color:'#666' }}>Checking session…</div>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Workshop Attendance</h2>
        <div style={{ fontSize: 14, color: '#555' }}>
          {email && <span style={{ marginRight: 8 }}>{email}</span>}
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.href='/login'; }}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}
          >
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
        {pos
          ? <>Workshop: <b>{WORKSHOP.lat.toFixed(6)}, {WORKSHOP.lon.toFixed(6)}</b> (r={WORKSHOP.radiusM} m)<br/>
              Your location: <b>{pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}</b><br/>
              Accuracy: {acc ? `~${Math.round(acc)} m` : 'n/a'}<br/>
              Distance to workshop: <b>{Math.round(dist(pos.lat, pos.lon, WORKSHOP.lat, WORKSHOP.lon))}</b> m</>
          : 'Waiting for location… Tap “Refresh location” on the map and allow permission.'}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0' }}>
        <button onClick={() => submit('Check-in')}  disabled={busy}
          style={{ width: '100%', padding: 14, border: 0, borderRadius: 8, background: '#16a34a', color: '#fff', fontSize: 16, marginTop: 6, opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : 'Check in'}
        </button>
        <button onClick={() => submit('Check-out')} disabled={busy}
          style={{ width: '100%', padding: 14, border: 0, borderRadius: 8, background: '#0ea5e9', color: '#fff', fontSize: 16, marginTop: 6, opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : 'Check out'}
        </button>

        {showLogBtn && (
          <a href="/today" style={{ display: 'inline-block', textDecoration: 'none', marginTop: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}>
            View Today’s Log
          </a>
        )}

        {banner && (
          <div style={{
            marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid',
            borderColor: banner.kind === 'err' ? '#dc2626' : banner.kind === 'ok' ? '#16a34a' : '#d4d4d4',
            color: banner.kind === 'err' ? '#dc2626' : banner.kind === 'ok' ? '#16a34a' : '#4b5563',
            background: banner.kind === 'err' ? '#fef2f2' : banner.kind === 'ok' ? '#f0fdf4' : '#fff'
          }}>
            {banner.text}
          </div>
        )}
      </div>
    </main>
  );
}