'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabaseClient';
import PageShell from '@/components/PageShell';
import { Card, CardBody } from '@/components/ui/Card';

// Load the Leaflet map on the client only
const CurrentMap = dynamic(() => import('@/components/CurrentMap'), { ssr: false });

/* ---------------------- small helpers (no external libs) ---------------------- */

type LatLon = { lat: number; lon: number };
type ConfigState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; workshop: LatLon; radiusM: number };

function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6371000; // m
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

/* ---------------------------------- page ---------------------------------- */

export default function HomePage() {
  const [nowText, setNowText] = useState<string>('');
  const [cfg, setCfg] = useState<ConfigState>({ status: 'loading' });

  const [me, setMe] = useState<LatLon | null>(null);
  const [accM, setAccM] = useState<number | null>(null);

  const [saving, setSaving] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>('');

  // live clock (Asia/Kuala_Lumpur)
  useEffect(() => {
    const tick = () => {
      const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
      setNowText(
        d.toLocaleString('en-GB', {
          weekday: 'short', day: '2-digit', month: 'short',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // read workshop config from DB (public.config: workshop_lat, workshop_lon, radius_m)
  const loadConfig = useCallback(async () => {
    setCfg({ status: 'loading' });
    const { data, error } = await supabase
      .from('config')
      .select('workshop_lat, workshop_lon, radius_m')
      .limit(1)
      .maybeSingle();

    if (error) { setCfg({ status: 'error', message: error.message }); return; }
    const lat = Number(data?.workshop_lat ?? NaN);
    const lon = Number(data?.workshop_lon ?? NaN);
    const radiusM = Number(data?.radius_m ?? NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) {
      setCfg({ status: 'error', message: 'Invalid config values in table "config".' });
      return;
    }
    setCfg({ status: 'ok', workshop: { lat, lon }, radiusM });
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const distanceM = useMemo(() => {
    if (cfg.status !== 'ok' || !me) return null;
    return haversineMeters(me, cfg.workshop);
  }, [cfg, me]);

  const insideRadius = useMemo(() => {
    if (cfg.status !== 'ok' || distanceM === null) return false;
    return distanceM <= cfg.radiusM;
  }, [cfg, distanceM]);

  const onLocationChange = useCallback((pos: LatLon, acc?: number) => {
    setMe(pos);
    setAccM(typeof acc === 'number' ? Math.round(acc) : null);
  }, []);

  async function handleCheck(kind: 'in' | 'out') {
    try {
      setSaving(true);
      setMsg('');
      const { data: sess } = await supabase.auth.getSession();
      const email = sess.session?.user?.email ?? '';
      if (!email) { setMsg('Please sign in first.'); return; }

      const action = kind === 'in' ? 'Check-in' : 'Check-out';
      const { error } = await supabase.from('attendance').insert({
        action,
        ts: new Date().toISOString(),
        lat: me?.lat ?? null,
        lon: me?.lon ?? null,
        distance_m: distanceM ?? null,
        staff_email: email,
        staff_name: email.split('@')[0],
        note: null,
      });
      if (error) { setMsg('Error: ' + error.message); return; }
      setMsg(action + ' recorded.');
    } catch (e) {
      setMsg('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------- render --------------------------------- */

  const isErr = msg.startsWith('Error:');

  return (
    <PageShell title="Check in" subtitle="Workshop attendance">
      {/* Live clock + range status */}
      <Card className="mb-4">
        <CardBody className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kuala Lumpur time</div>
            <div className="mt-0.5 truncate text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">{nowText || '—'}</div>
          </div>
          {cfg.status === 'ok' && me && (
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${insideRadius ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {insideRadius ? '✓ In range' : '✗ Out of range'}
            </span>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          {cfg.status === 'loading' && <p className="text-sm text-slate-500">Loading workshop location…</p>}
          {cfg.status === 'error' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Config error: {cfg.message}</div>
          )}

          {/* Map */}
          <div className="h-[320px] w-full overflow-hidden rounded-xl border border-slate-200">
            {cfg.status === 'ok' && (
              <CurrentMap
                workshop={{ lat: cfg.workshop.lat, lon: cfg.workshop.lon }}
                radiusM={cfg.radiusM}
                onLocationChange={onLocationChange}
              />
            )}
          </div>

          {/* Location readout */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {me ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>📍 <b className="tabular-nums">{me.lat.toFixed(5)}, {me.lon.toFixed(5)}</b>{accM !== null && <span className="text-slate-400"> (±{accM} m)</span>}</span>
                {distanceM !== null && (
                  <span className="text-slate-500">·  {distanceM} m from workshop</span>
                )}
              </div>
            ) : (
              <span className="text-slate-500">Waiting for location — tap <b>Refresh location</b> on the map.</span>
            )}
          </div>

          {/* Actions — big, thumb-friendly, stacked on mobile */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              onClick={() => void handleCheck('in')}
              disabled={saving || !insideRadius}
              className="inline-flex h-12 items-center justify-center rounded-xl text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 bg-emerald-600 hover:bg-emerald-700"
            >
              {saving ? '…' : 'Check in'}
            </button>
            <button
              onClick={() => void handleCheck('out')}
              disabled={saving || !insideRadius}
              className="inline-flex h-12 items-center justify-center rounded-xl text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 bg-brand-700 hover:bg-brand-800"
            >
              {saving ? '…' : 'Check out'}
            </button>
          </div>

          {cfg.status === 'ok' && me && !insideRadius && (
            <p className="text-center text-xs text-slate-400">You must be inside the workshop area to check in or out.</p>
          )}

          {msg && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${isErr ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {msg}
            </div>
          )}
        </CardBody>
      </Card>
    </PageShell>
  );
}
