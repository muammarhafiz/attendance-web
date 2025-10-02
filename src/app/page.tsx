'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import PageShell from '../components/PageShell';
import { Card, CardBody } from '../components/ui/Card';
import { supabase } from '@/lib/supabaseClient';
import { WORKSHOP as FALLBACK } from '@/config/workshop';

dayjs.extend(utc);
dayjs.extend(timezone);

// Tell TS what props the Map component accepts
type MapProps = {
  radiusM?: number;
  workshop?: { lat: number; lon: number };
  onLocationChange?: (pos: { lat: number; lon: number }, acc?: number) => void;
};

// Dynamic import with proper typing (needed for Leaflet: ssr=false)
const Map = dynamic<MapProps>(() => import('../components/Map'), { ssr: false });

type WorkshopCfg = { lat: number; lon: number; radiusM: number };

export default function HomePage() {
  const [now, setNow] = useState<string>('');
  const [src, setSrc] = useState<'fallback' | 'db' | 'error'>('fallback');
  const [cfg, setCfg] = useState<WorkshopCfg>({
    lat: FALLBACK.lat,
    lon: FALLBACK.lon,
    radiusM: FALLBACK.radiusM,
  });
  const [err, setErr] = useState<string>('');

  // ticking clock
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // load workshop config from DB (public.config, id = 1)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('config')
        .select('workshop_lat, workshop_lon, radius_m')
        .eq('id', 1)
        .single();

      if (cancelled) return;

      if (error) {
        setSrc('error');
        setErr(error.message);
        return;
      }
      if (!data) {
        setSrc('error');
        setErr('No config row with id=1');
        return;
      }

      const lat = Number(data.workshop_lat);
      const lon = Number(data.workshop_lon);
      const radiusM = Number(data.radius_m);

      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) {
        setSrc('error');
        setErr('Invalid numbers in config row');
        return;
      }

      setCfg({ lat, lon, radiusM });
      setSrc('db');
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      {/* source banner */}
      <div
        style={{
          marginBottom: 8,
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          background:
            src === 'db' ? '#ecfeff' : src === 'fallback' ? '#fff7ed' : '#fee2e2',
          fontSize: 13,
          fontFamily: 'system-ui',
        }}
      >
        {src.toUpperCase()} • lat={cfg.lat.toFixed(6)} lon={cfg.lon.toFixed(6)} r={cfg.radiusM}m
        {src === 'error' && <div style={{ color: '#b91c1c', marginTop: 4 }}>DB read failed: {err}</div>}
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="h-[360px] w-full">
            {/* pass DB (or fallback) values into the Map */}
            <Map workshop={{ lat: cfg.lat, lon: cfg.lon }} radiusM={cfg.radiusM} />
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}