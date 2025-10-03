'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import PageShell from '../components/PageShell';
import { Card, CardBody } from '../components/ui/Card';

// Dynamically import your Leaflet map (no SSR)
const Map = dynamic(() => import('../components/Map'), { ssr: false });

type ConfigRow = { key: string; value: string };
type SessionEmail = string | null;

const CODE_FALLBACK = {
  lat: 3.115646, // fallback latitude (edit if you want a different default)
  lon: 101.655377, // fallback longitude
  radiusM: 80, // fallback radius in meters
};

export default function HomePage() {
  // live time (simple)
  const [nowStr, setNowStr] = useState<string>('');
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
      );
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      setNowStr(`${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // auth email
  const [email, setEmail] = useState<SessionEmail>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // config from DB (workshop_lat/lon/radius_m)
  const [cfg, setCfg] = useState<{ lat: number; lon: number; radiusM: number; source: 'DB' | 'CODE' }>({
    lat: CODE_FALLBACK.lat,
    lon: CODE_FALLBACK.lon,
    radiusM: CODE_FALLBACK.radiusM,
    source: 'CODE',
  });
  const [cfgErr, setCfgErr] = useState<string>('');

  const loadConfig = useCallback(async () => {
    setCfgErr('');
    // read all config, then pick the keys we care about
    const { data, error } = await supabase
      .from('config')
      .select('key, value')
      .returns<ConfigRow[]>();
    if (error) {
      setCfgErr(error.message);
      return; // keep fallback
    }

    const rows = data ?? [];

    const getNum = (k: string, def: number): number => {
      const found = rows.find((r) => r.key === k)?.value;
      const n = found ? Number(found) : NaN;
      return Number.isFinite(n) ? n : def;
    };

    const lat = getNum('workshop_lat', CODE_FALLBACK.lat);
    const lon = getNum('workshop_lon', CODE_FALLBACK.lon);
    const radiusM = getNum('radius_m', CODE_FALLBACK.radiusM);

    const usedDB =
      rows.some((r) => r.key === 'workshop_lat') &&
      rows.some((r) => r.key === 'workshop_lon');

    setCfg({
      lat,
      lon,
      radiusM,
      source: usedDB ? 'DB' : 'CODE',
    });
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // user live location from Map
  const [me, setMe] = useState<{ lat: number; lon: number; acc?: number } | null>(null);

  const inRadius = useMemo(() => {
    if (!me) return false;
    // rough haversine-lite (meters)
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(me.lat - cfg.lat);
    const dLon = toRad(me.lon - cfg.lon);
    const lat1 = toRad(cfg.lat);
    const lat2 = toRad(me.lat);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    return dist <= cfg.radiusM;
  }, [me, cfg.lat, cfg.lon, cfg.radiusM]);

  // check in/out actions
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string>('');

  async function doAction(kind: 'in' | 'out') {
    setActionMsg('');
    if (!email) {
      // not signed in → go to /auth
      window.location.href = '/auth';
      return;
    }
    if (!me) {
      setActionMsg('Please refresh your location first.');
      return;
    }
    setActionBusy(true);
    try {
      // Adjust the column names here if your table differs
      const { error } = await supabase
        .from('attendance')
        .insert({
          staff_email: email,
          ts: new Date().toISOString(),
          lat: me.lat,
          lon: me.lon,
          action: kind, // remove this line if your table doesn't have `action`
        });
      if (error) {
        setActionMsg('Insert failed: ' + error.message);
      } else {
        setActionMsg(kind === 'in' ? 'Checked in successfully.' : 'Checked out successfully.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActionMsg('Exception: ' + msg);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <PageShell title="Workshop Attendance" subtitle={nowStr}>
      <Card>
        <CardBody className="p-0">
          <div className="h-[360px] w-full">
            {/* Pass DB (or fallback) coords into the Map */}
            <Map
              workshop={{ lat: cfg.lat, lon: cfg.lon }}
              radiusM={cfg.radiusM}
              // capture current device location
              onLocationChange={(p, acc) => setMe({ lat: p.lat, lon: p.lon, acc })}
            />
          </div>
        </CardBody>
      </Card>

      <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
        <div>
          <span className="font-medium">Workshop:</span>{' '}
          <span>
            {cfg.lat.toFixed(6)}, {cfg.lon.toFixed(6)} (radius {cfg.radiusM} m)
          </span>{' '}
          <span className="ml-2 rounded bg-gray-100 px-2 py-0.5">{cfg.source}</span>
          {cfgErr ? <span className="ml-2 text-red-600">[config error: {cfgErr}]</span> : null}
        </div>
        <div>
          {me ? (
            <span>
              You: {me.lat.toFixed(6)}, {me.lon.toFixed(6)}
              {typeof me.acc === 'number' ? ` (±${Math.round(me.acc)} m)` : ''}
            </span>
          ) : (
            <span>Tap “Refresh location” on the map to get your position</span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        {!email ? (
          <Link
            href="/auth"
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Sign in to Check in/out
          </Link>
        ) : (
          <>
            <button
              onClick={() => doAction('in')}
              disabled={actionBusy || !inRadius || !me}
              className="rounded-md bg-green-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-green-700"
            >
              {actionBusy ? 'Working…' : 'Check in'}
            </button>
            <button
              onClick={() => doAction('out')}
              disabled={actionBusy || !inRadius || !me}
              className="rounded-md bg-gray-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-black"
            >
              {actionBusy ? 'Working…' : 'Check out'}
            </button>
            {!inRadius && (
              <span className="text-sm text-red-600">
                You are outside the workshop radius.
              </span>
            )}
          </>
        )}
      </div>

      {actionMsg ? (
        <p className="mt-2 text-sm text-gray-800">{actionMsg}</p>
      ) : null}
    </PageShell>
  );
}