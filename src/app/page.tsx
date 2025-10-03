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

function toKLDateISO(): string {
  // YYYY-MM-DD for Asia/Kuala_Lumpur
  const kl = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const y = kl.getFullYear();
  const m = String(kl.getMonth() + 1).padStart(2, '0');
  const d = String(kl.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

  // live clock
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
      );
      setNowText(
        d.toLocaleString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // read workshop config from DB (table: public.config with columns workshop_lat, workshop_lon, radius_m)
  const loadConfig = useCallback(async () => {
    setCfg({ status: 'loading' });
    const { data, error } = await supabase
      .from('config')
      .select('workshop_lat, workshop_lon, radius_m')
      .limit(1)
      .maybeSingle();

    if (error) {
      setCfg({ status: 'error', message: error.message });
      return;
    }
    const lat = Number(data?.workshop_lat ?? NaN);
    const lon = Number(data?.workshop_lon ?? NaN);
    const radiusM = Number(data?.radius_m ?? NaN);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) {
      setCfg({ status: 'error', message: 'Invalid config values in table "config".' });
      return;
    }
    setCfg({ status: 'ok', workshop: { lat, lon }, radiusM });
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const distanceM = useMemo(() => {
    if (cfg.status !== 'ok' || !me) return null;
    return haversineMeters(me, cfg.workshop);
  }, [cfg, me]);

  const insideRadius = useMemo(() => {
    if (cfg.status !== 'ok' || distanceM === null) return false;
    return distanceM <= cfg.radiusM;
  }, [cfg, distanceM]);

  // called by map when user refreshes location
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
      if (!email) {
        setMsg('Please sign in first.');
        return;
      }

      const action = kind === 'in' ? 'Check-in' : 'Check-out';
      const day = toKLDateISO();

      const { error } = await supabase.from('attendance').insert({
        action,                            // required (NOT NULL)
        ts: new Date().toISOString(),      // server time
        lat: me?.lat ?? null,
        lon: me?.lon ?? null,
        distance_m: distanceM ?? null,     // integer is fine; supabase will coerce number
        day,
        staff_email: email,
        staff_name: email.split('@')[0],
        note: null
      });

      if (error) {
        setMsg('Error: ' + error.message);
        return;
      }
      setMsg(action + ' recorded.');
    } catch (e) {
      setMsg('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------- render --------------------------------- */

  return (
    <PageShell title="Workshop Attendance" subtitle={nowText}>
      <Card>
        <CardBody>
          {/* tiny status ribbon */}
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #d1fae5',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              marginBottom: 8
            }}
          >
            {cfg.status === 'loading' && <>Loading workshop location…</>}
            {cfg.status === 'error' && (
              <span style={{ color: '#b91c1c' }}>
                Config error: {cfg.message}
              </span>
            )}
            {cfg.status === 'ok' && (
              <>
                Workshop: <b>{cfg.workshop.lat.toFixed(6)}, {cfg.workshop.lon.toFixed(6)}</b>{' '}
                (radius {cfg.radiusM} m)
                <span style={{
                  marginLeft: 8, fontSize: 10, padding: '2px 6px',
                  background: '#d1fae5', borderRadius: 999
                }}>DB</span>
              </>
            )}
          </div>

          {/* Map */}
          <div className="h-[360px] w-full">
            {cfg.status === 'ok' && (
              <CurrentMap
                workshop={{ lat: cfg.workshop.lat, lon: cfg.workshop.lon }}
                radiusM={cfg.radiusM}
                onLocationChange={onLocationChange}
              />
            )}
          </div>

          {/* Readout + actions */}
          <div style={{
            marginTop: 12,
            padding: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#fff'
          }}>
            <div style={{ marginBottom: 8, fontSize: 14 }}>
              {me ? (
                <>
                  You: <b>{me.lat.toFixed(6)}, {me.lon.toFixed(6)}</b>{' '}
                  {accM !== null && <span>(±{accM} m)</span>}
                  {cfg.status === 'ok' && distanceM !== null && (
                    <>
                      {' '} • Distance to workshop:{' '}
                      <b>{distanceM} m</b>{' '}
                      {insideRadius ? (
                        <span style={{ color: '#16a34a' }}>✓ inside radius</span>
                      ) : (
                        <span style={{ color: '#dc2626' }}>✗ outside radius</span>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>Waiting for location… Tap <b>Refresh location</b> on the map.</>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => void handleCheck('in')}
                disabled={saving || !insideRadius}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: insideRadius ? '#16a34a' : '#9ca3af',
                  color: '#fff',
                  fontWeight: 600
                }}
              >
                Check in
              </button>
              <button
                onClick={() => void handleCheck('out')}
                disabled={saving || !insideRadius}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: insideRadius ? '#2563eb' : '#9ca3af',
                  color: '#fff',
                  fontWeight: 600
                }}
              >
                Check out
              </button>
            </div>

            {msg && (
              <div style={{ marginTop: 10, color: msg.startsWith('Error:') ? '#b91c1c' : '#166534' }}>
                {msg}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}