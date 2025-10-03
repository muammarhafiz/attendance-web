'use client';

import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import PageShell from '../components/PageShell';
import { Card, CardBody } from '../components/ui/Card';
import { supabase } from '@/lib/supabaseClient';
import CurrentMap from '../components/CurrentMap';
import { WORKSHOP } from '../config/workshop';

dayjs.extend(utc);
dayjs.extend(timezone);

type Cfg = { lat: number; lon: number; radiusM: number };
type Source = 'db' | 'code';

export default function HomePage() {
  const [now, setNow] = useState<string>('');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [src, setSrc] = useState<Source>('code'); // default until DB load finishes
  const [error, setError] = useState<string>('');

  // live clock (KL)
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // fetch workshop config (DB -> fallback to code)
  useEffect(() => {
    (async () => {
      setError('');
      // optimistic: prefill with code values so the map can render immediately
      setCfg({ lat: WORKSHOP.lat, lon: WORKSHOP.lon, radiusM: WORKSHOP.radiusM });
      setSrc('code');

      const { data, error } = await supabase
        .from('config')
        .select('workshop_lat, workshop_lon, radius_m')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        // keep code fallback, but show the reason
        setError(error.message);
        return;
      }

      if (data && data.workshop_lat != null && data.workshop_lon != null && data.radius_m != null) {
        setCfg({
          lat: Number(data.workshop_lat),
          lon: Number(data.workshop_lon),
          radiusM: Number(data.radius_m),
        });
        setSrc('db');
      } else {
        // no row or incomplete row -> stick with code fallback, but tell user
        setError('No complete config row found; using code fallback.');
      }
    })();
  }, []);

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      {/* Debug strip shows EXACT source and values the map uses */}
      <div
        style={{
          background: src === 'db' ? '#ecfeff' : '#fef9c3',
          border: '1px solid',
          borderColor: src === 'db' ? '#bae6fd' : '#fde68a',
          color: '#0c4a6e',
          fontSize: 13,
          padding: '6px 10px',
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>
            <b>Source:</b> {src === 'db' ? 'DB (config table)' : 'Code (config/workshop.ts)'}
          </span>
          {cfg && (
            <span>
              <b>lat</b>: {cfg.lat} · <b>lon</b>: {cfg.lon} · <b>radius</b>: {cfg.radiusM}m
            </span>
          )}
          {error && <span style={{ color: '#b91c1c' }}>Note: {error}</span>}
        </div>
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="h-[360px] w-full">
            {cfg ? (
              <CurrentMap
                workshop={{ lat: cfg.lat, lon: cfg.lon }}
                radiusM={cfg.radiusM}
              />
            ) : (
              <div
                style={{
                  height: 360,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6b7280',
                  fontSize: 14,
                }}
              >
                Loading map…
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}