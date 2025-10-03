'use client';

import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import PageShell from '../components/PageShell';
import { Card, CardBody } from '../components/ui/Card';
import { supabase } from '@/lib/supabaseClient';

// ⚠️ IMPORTANT: use the map component that accepts props
// (we pass {workshop, radiusM}). Your "CurrentMap.tsx" does.
import CurrentMap from '../components/CurrentMap';

dayjs.extend(utc);
dayjs.extend(timezone);

type Cfg = { lat: number; lon: number; radiusM: number };

export default function HomePage() {
  const [now, setNow] = useState<string>('');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [error, setError] = useState<string>('');

  // clock
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // fetch workshop config from Supabase (no caching, client-side)
  useEffect(() => {
    (async () => {
      setError('');
      const { data, error } = await supabase
        .from('config')
        .select('workshop_lat, workshop_lon, radius_m')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        setError(error.message);
        return;
      }
      if (data) {
        setCfg({
          lat: Number(data.workshop_lat),
          lon: Number(data.workshop_lon),
          radiusM: Number(data.radius_m),
        });
      } else {
        setError('No row found in config table.');
      }
    })();
  }, []);

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      {/* Debug strip shows exactly what the page is using */}
      <div style={{
        background:'#ecfeff',
        border:'1px solid #bae6fd',
        color:'#0c4a6e',
        fontSize:13,
        padding:'6px 10px',
        borderRadius:8,
        marginBottom:12
      }}>
        {cfg
          ? <>DB → lat:<b>{cfg.lat}</b> lon:<b>{cfg.lon}</b> · r:<b>{cfg.radiusM}m</b></>
          : error
            ? <>Config load error: <b>{error}</b></>
            : <>Loading workshop config…</>
        }
      </div>

      <Card>
        <CardBody className="p-0">
          <div className="h-[360px] w-full">
            {/* Only render map once config is loaded */}
            {cfg ? (
              <CurrentMap
                workshop={{ lat: cfg.lat, lon: cfg.lon }}
                radiusM={cfg.radiusM}
                // onLocationChange is optional; keep behaviour the same
              />
            ) : (
              <div style={{
                height:360, display:'flex', alignItems:'center', justifyContent:'center',
                color:'#6b7280', fontSize:14
              }}>
                {error ? 'Error loading config' : 'Loading map…'}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}