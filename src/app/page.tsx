'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import PageShell from '@/components/PageShell';
import { Card, CardBody } from '@/components/ui/Card';
import { WORKSHOP } from '@/config/workshop';

dayjs.extend(utc);
dayjs.extend(timezone);

// Use the map component that supports onLocationChange
const Map = dynamic(() => import('@/components/CurrentMap'), { ssr: false });

type Pos = { lat: number; lon: number };

function haversineMeters(a: Pos, b: Pos) {
  const R = 6371000; // meters
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function HomePage() {
  const [now, setNow] = useState<string>('');
  const [me, setMe] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | null>(null);

  // update clock every second (KL time)
  useEffect(() => {
    const t = setInterval(() => {
      setNow(dayjs().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY, h:mm:ss a'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // distance to workshop (meters)
  const distance = useMemo(() => {
    if (!me) return null;
    return Math.round(
      haversineMeters(me, { lat: WORKSHOP.lat, lon: WORKSHOP.lon })
    );
  }, [me]);

  const inside = useMemo(() => {
    if (distance == null) return false;
    return distance <= WORKSHOP.radiusM;
  }, [distance]);

  const onLoc = useCallback((pos: Pos, a?: number) => {
    setMe(pos);
    if (typeof a === 'number') setAcc(a);
  }, []);

  const onCheckIn = () => {
    if (!inside) return;
    alert('Check-in pressed (preview). We will wire this to Supabase next.');
  };

  const onCheckOut = () => {
    if (!inside) return;
    alert('Check-out pressed (preview). We will wire this to Supabase next.');
  };

  return (
    <PageShell title="Workshop Attendance" subtitle={now}>
      <Card>
        <CardBody className="p-0">
          {/* Map */}
          <div className="w-full">
            <Map
              radiusM={WORKSHOP.radiusM}
              workshop={{ lat: WORKSHOP.lat, lon: WORKSHOP.lon }}
              onLocationChange={onLoc}
            />
          </div>

          {/* Info + action panel */}
          <div className="p-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-2">
                <strong>Your location:</strong>{' '}
                {me
                  ? `${me.lat.toFixed(6)}, ${me.lon.toFixed(6)}${
                      acc ? ` (±${Math.round(acc)} m)` : ''
                    }`
                  : 'Waiting for location…'}
              </p>

              <p className="mb-4">
                <strong>Distance to workshop:</strong>{' '}
                {distance == null ? '—' : `${distance} m`}{' '}
                {distance == null ? '' : inside ? (
                  <span className="text-green-600">✓ inside radius</span>
                ) : (
                  <span className="text-red-600">✗ outside radius</span>
                )}
              </p>

              <div className="flex gap-3">
                <button
                  className={`rounded-md px-4 py-2 text-white ${
                    inside ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-300'
                  }`}
                  disabled={!inside}
                  onClick={onCheckIn}
                >
                  Check in
                </button>
                <button
                  className={`rounded-md px-4 py-2 text-white ${
                    inside ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300'
                  }`}
                  disabled={!inside}
                  onClick={onCheckOut}
                >
                  Check out
                </button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </PageShell>
  );
}