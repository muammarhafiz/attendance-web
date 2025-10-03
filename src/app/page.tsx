'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '@/lib/supabaseClient';
import PageShell from '@/components/PageShell';
import { Card, CardBody } from '@/components/ui/Card';

dayjs.extend(utc);
dayjs.extend(timezone);

// Load the Leaflet map client-side
const CurrentMap = dynamic(() => import('@/components/CurrentMap'), { ssr: false });

/** Fallback (used only if DB `config` row is missing) */
const CODE_FALLBACK = {
  lat: 2.952535, // Putrajaya plant (example)
  lon: 101.731364,
  radiusM: 120,
} as const;

type Cfg = {
  lat: number;
  lon: number;
  radiusM: number;
  source: 'DB' | 'CODE';
};

type Pos = { lat: number; lon: number };

function haversineMeters(a: Pos, b: Pos): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return Math.round(R * c);
}

export default function HomePage() {
  // Clock
  const [now, setNow] = useState<string>('');

  // Config (workshop)
  const [cfg, setCfg] = useState<Cfg>({
    lat: CODE_FALLBACK.lat,
    lon: CODE_FALLBACK.lon,
    radiusM: CODE_FALLBACK.radiusM,
    source: 'CODE',
  });
  const [cfgErr, setCfgErr] = useState<string>('');

  // Location from the map component
  const [pos, setPos] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  // Check-in/out UI
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>('');

  // --- live clock ---
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // --- read config from DB (single row) ---
  const loadConfig = useCallback(async () => {
    setCfgErr('');
    const { data, error } = await supabase
      .from('config')
      .select('workshop_lat, workshop_lon, radius_m')
      .single();

    if (error) {
      setCfgErr(error.message);
      // keep CODE fallback already in state
      return;
    }

    if (data) {
      setCfg({
        lat: data.workshop_lat ?? CODE_FALLBACK.lat,
        lon: data.workshop_lon ?? CODE_FALLBACK.lon,
        radiusM: data.radius_m ?? CODE_FALLBACK.radiusM,
        source: 'DB',
      });
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // distance + radius gate
  const distanceM = useMemo(() => {
    if (!pos) return null;
    return haversineMeters({ lat: cfg.lat, lon: cfg.lon }, pos);
  }, [cfg.lat, cfg.lon, pos]);

  const inside = useMemo(() => {
    if (distanceM == null) return false;
    return distanceM <= cfg.radiusM;
  }, [distanceM, cfg.radiusM]);

  // Map callback
  const onLocationChange = (p: Pos, accuracy?: number) => {
    setPos(p);
    setAcc(accuracy ?? null);
  };

  // Basic logger (one row per click)
  const logAttendance = async (kind: 'in' | 'out') => {
    try {
      setBusy(true);
      setMsg('');

      // need an email (RLS)
      const { data: u } = await supabase.auth.getUser();
      const email = u.user?.email ?? null;
      if (!email) {
        setMsg('Please sign in first.');
        setBusy(false);
        return;
      }

      if (!inside || !pos) {
        setMsg('You must be inside the workshop radius.');
        setBusy(false);
        return;
      }

      // simple name guess (left of @); your app may upsert into staff separately
      const staff_name = email.split('@')[0];

      // Insert a log row. Your DB triggers/views handle in/out aggregation.
      const { error } = await supabase.from('attendance').insert({
        staff_email: email,
        staff_name,
        // optional: store raw coords if your table has these columns; ignored otherwise
        lat: pos.lat,
        lon: pos.lon,
        note: kind === 'in' ? 'check-in' : 'check-out',
      } as any);

      if (error) setMsg('Error: ' + error.message);
      else setMsg(kind === 'in' ? 'Checked in.' : 'Checked out.');
    } catch (e) {
      setMsg('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      <Card>
        <CardBody className="p-0">
          {/* Small debug/status strip */}
          <div className="px-3 py-2 text-xs">
            <div className="mb-2 rounded-md bg-[#eef6ff] px-2 py-1 text-[#0b57d0]">
              Workshop: {cfg.lat.toFixed(6)}, {cfg.lon.toFixed(6)} (radius {cfg.radiusM} m){' '}
              <span
                className={`ml-2 rounded px-1.5 py-[2px] text-[10px] ${
                  cfg.source === 'DB'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                {cfg.source}
              </span>
              {cfgErr && (
                <span className="ml-2 text-red-600">
                  [config error: {cfgErr}]
                </span>
              )}
            </div>
          </div>

          {/* Map */}
          <div className="h-[360px] w-full">
            <CurrentMap
              workshop={{ lat: cfg.lat, lon: cfg.lon }}
              radiusM={cfg.radiusM}
              onLocationChange={onLocationChange}
            />
          </div>

          {/* Footer / actions */}
          <div className="px-4 py-4">
            <div className="mb-2 text-sm">
              You:{' '}
              {pos ? (
                <>
                  {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)}{' '}
                  {acc ? <>(±{Math.round(acc)} m)</> : null}
                </>
              ) : (
                '—'
              )}
              <span className="mx-2">•</span>
              Distance to workshop:{' '}
              {distanceM == null ? '—' : `${distanceM} m`}{' '}
              {distanceM != null && (
                <span className={inside ? 'text-green-600' : 'text-red-600'}>
                  {inside ? '✓ inside radius' : '✗ outside radius'}
                </span>
              )}
            </div>

            <div className="flex gap-3">
              <button
                disabled={busy || !inside || !pos}
                onClick={() => logAttendance('in')}
                className={`rounded px-4 py-2 text-white ${
                  busy || !inside || !pos ? 'bg-green-300' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                Check in
              </button>
              <button
                disabled={busy || !inside || !pos}
                onClick={() => logAttendance('out')}
                className={`rounded px-4 py-2 text-white ${
                  busy || !inside || !pos ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Check out
              </button>
            </div>

            {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}