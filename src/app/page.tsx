'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '@/lib/supabaseClient';
import PageShell from '../components/PageShell';
import { Card, CardBody } from '../components/ui/Card';

dayjs.extend(utc);
dayjs.extend(timezone);

// Map component (client-only)
const Map = dynamic(() => import('../components/CurrentMap'), { ssr: false });

// ---------- helpers ----------
type WorkshopCfg = { lat: number; lon: number; radiusM: number };

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000; // meters
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const s1 =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
  return Math.round(R * c);
}

function fmtLatLon(n: number) {
  return n.toFixed(6);
}

const KL = 'Asia/Kuala_Lumpur';

// ---------- page ----------
export default function HomePage() {
  const [now, setNow] = useState<string>('');
  const [cfg, setCfg] = useState<WorkshopCfg | null>(null);

  // live clock
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz(KL).format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // read config table (lat/lon/radius)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('config')
        .select('workshop_lat, workshop_lon, radius_m')
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setCfg({
          lat: Number(data.workshop_lat),
          lon: Number(data.workshop_lon),
          radiusM: Number(data.radius_m ?? 120),
        });
      } else {
        // fallback if table empty
        setCfg({ lat: 2.952535, lon: 101.731364, radiusM: 120 });
      }
    })();
  }, []);

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      {/* Small, pale debug strip so you can see DB values came through */}
      <div
        style={{
          background: '#ecf5ff',
          color: '#1e3a8a',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 12,
          marginBottom: 10,
          opacity: 0.9,
        }}
      >
        {cfg
          ? `DB → lat=${cfg.lat} lon=${cfg.lon} r=${cfg.radiusM}m`
          : 'Loading workshop config…'}
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="h-[360px] w-full">
            {cfg && (
              <Map
                workshop={{ lat: cfg.lat, lon: cfg.lon }}
                radiusM={cfg.radiusM}
                onLocationChange={() => { /* handled by panel below */ }}
              />
            )}
          </div>
        </CardBody>
      </Card>

      <CheckPanel cfg={cfg} />
    </PageShell>
  );
}

// ---------- bottom panel with buttons ----------
function CheckPanel({ cfg }: { cfg: WorkshopCfg | null }) {
  const [me, setMe] = useState<{ lat: number; lon: number; acc?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  // get current auth + staff name (if available)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const em = data.user?.email ?? null;
      setEmail(em || null);

      if (em) {
        const { data: s } = await supabase
          .from('staff')
          .select('name')
          .eq('email', em)
          .maybeSingle();
        setName(s?.name ?? (em.split('@')[0] || null));
      }
    })();
  }, []);

  // pick up location updates emitted by the map
  useEffect(() => {
    // simple event bus via window for minimal wiring
    function handler(e: any) {
      if (e?.detail?.type === 'location') {
        setMe({ lat: e.detail.lat, lon: e.detail.lon, acc: e.detail.acc });
      }
    }
    window.addEventListener('attendance-location', handler as EventListener);
    return () =>
      window.removeEventListener('attendance-location', handler as EventListener);
  }, []);

  const distance = useMemo(() => {
    if (!cfg || !me) return null;
    return haversineMeters(me, { lat: cfg.lat, lon: cfg.lon });
  }, [cfg, me]);

  const inside = useMemo(() => {
    if (distance == null || !cfg) return false;
    return distance <= cfg.radiusM;
  }, [distance, cfg]);

  async function ensureSignedIn() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // redirect to auth flow
      window.location.href = '/auth';
      return false;
    }
    return true;
  }

  async function doCheck(kind: 'in' | 'out') {
    setBusy(true);
    setMsg('');
    try {
      const ok = await ensureSignedIn();
      if (!ok) return;

      if (!email || !name) {
        setMsg('Missing profile (email/name).');
        return;
      }
      if (!inside) {
        setMsg('You are outside the radius.');
        return;
      }

      // Write to attendance_today (matches your existing successful schema)
      const { error } = await supabase.from('attendance_today').insert({
        staff_email: email,
        staff_name: name,
        ts: new Date().toISOString(), // server will store timestamptz
        // ts_kl can be derived in DB if you set a trigger; otherwise omit
        // add a small marker column if you like (optional):
        // action: kind,
        // lat: me?.lat, lon: me?.lon
      });

      if (error) {
        setMsg('Error: ' + error.message);
      } else {
        setMsg(kind === 'in' ? 'Checked in!' : 'Checked out!');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 12,
        background: '#fff',
      }}
    >
      <div style={{ marginBottom: 8, fontSize: 14 }}>
        {me ? (
          <>
            <b>Your location:</b> {fmtLatLon(me.lat)}, {fmtLatLon(me.lon)}
            {me.acc ? ` (±${Math.round(me.acc)} m)` : ''}
          </>
        ) : (
          <>Waiting for location… Tap <b>Refresh location</b> on the map.</>
        )}
      </div>

      <div style={{ marginBottom: 12, fontSize: 14 }}>
        {cfg && distance != null ? (
          <>
            <b>Distance to workshop:</b> {distance} m{' '}
            {inside ? (
              <span style={{ color: '#16a34a' }}>✓ inside radius</span>
            ) : (
              <span style={{ color: '#b91c1c' }}>✗ outside radius</span>
            )}
          </>
        ) : (
          <>Calculating distance…</>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          disabled={!inside || busy}
          onClick={() => doCheck('in')}
          style={{
            background: inside ? '#16a34a' : '#9ca3af',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 8,
            border: 0,
            fontWeight: 600,
          }}
        >
          Check in
        </button>

        <button
          disabled={!inside || busy}
          onClick={() => doCheck('out')}
          style={{
            background: inside ? '#2563eb' : '#9ca3af',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 8,
            border: 0,
            fontWeight: 600,
          }}
        >
          Check out
        </button>
      </div>

      {msg && (
        <div style={{ marginTop: 10, color: msg.startsWith('Error') ? '#b91c1c' : '#166534' }}>
          {msg}
        </div>
      )}
    </div>
  );
}