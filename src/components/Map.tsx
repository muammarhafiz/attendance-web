'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import { Icon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabase } from '@/lib/supabaseClient';
import { WORKSHOP as FALLBACK } from '../config/workshop';

type Pos = { lat: number; lon: number };
type WorkshopCfg = { lat: number; lon: number; radiusM: number };

const markerIcon = new Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Recenter whenever workshop changes
function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

export default function Map() {
  // start with fallback so map can render immediately
  const [source, setSource] = useState<'fallback' | 'db' | 'error'>('fallback');
  const [errorText, setErrorText] = useState<string>('');
  const [workshop, setWorkshop] = useState<WorkshopCfg>({
    lat: FALLBACK.lat,
    lon: FALLBACK.lon,
    radiusM: FALLBACK.radiusM,
  });

  // load workshop from DB (row id = 1)
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
        setSource('error');
        setErrorText(error.message);
        console.log('[Map] DB error', error);
        return;
      }
      if (!data) {
        setSource('error');
        setErrorText('No row with id=1 in config');
        console.log('[Map] No config row id=1');
        return;
      }

      const lat = Number(data.workshop_lat);
      const lon = Number(data.workshop_lon);
      const radius = Number(data.radius_m);

      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) {
        setSource('error');
        setErrorText('Invalid numbers from config table');
        console.log('[Map] Invalid numbers', data);
        return;
      }

      setWorkshop({ lat, lon, radiusM: radius });
      setSource('db');
      console.log('[Map] Loaded from DB', { lat, lon, radius });
    })();
    return () => { cancelled = true; };
  }, []);

  // user location controls
  const [pos, setPos] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [geoErr, setGeoErr] = useState<string>('');

  const bannerText = useMemo(
    () =>
      `${source.toUpperCase()} • lat=${workshop.lat.toFixed(6)} lon=${workshop.lon.toFixed(6)} r=${workshop.radiusM}m`
    , [source, workshop]
  );

  const refresh = () => {
    if (!('geolocation' in navigator)) {
      setGeoErr('Location not available on this device/browser.');
      return;
    }
    setBusy(true);
    setGeoErr('');

    // quick
    navigator.geolocation.getCurrentPosition(
      p => {
        const quick = { lat: p.coords.latitude, lon: p.coords.longitude };
        setPos(quick);
        setAcc(p.coords.accuracy);

        // precise
        navigator.geolocation.getCurrentPosition(
          hp => {
            const precise = { lat: hp.coords.latitude, lon: hp.coords.longitude };
            setPos(precise);
            setAcc(hp.coords.accuracy);
            setBusy(false);
          },
          () => setBusy(false),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
      },
      e => { setGeoErr(e.message); setBusy(false); },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
    );
  };

  return (
    <div>
      {/* BIG VISIBLE BANNER so we know which values are being used */}
      <div
        style={{
          marginBottom: 8,
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          background: source === 'db' ? '#ecfeff' : source === 'fallback' ? '#fff7ed' : '#fee2e2',
          fontSize: 13,
          fontFamily: 'system-ui',
        }}
      >
        {bannerText}
        {source === 'error' && <div style={{ color: '#b91c1c', marginTop: 4 }}>DB read failed: {errorText}</div>}
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
        <MapContainer
          center={[workshop.lat, workshop.lon]} // initial center
          zoom={17}
          style={{ height: 360, width: '100%', minHeight: 320 }}
          scrollWheelZoom
          zoomControl
          doubleClickZoom
          dragging
        >
          <Recenter lat={workshop.lat} lon={workshop.lon} />

          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <Marker position={[workshop.lat, workshop.lon]} icon={markerIcon} />
          <Circle center={[workshop.lat, workshop.lon]} radius={workshop.radiusM} pathOptions={{ color: '#2563eb' }} />

          {/* controls block (top-left) */}
          <div style={{ position: 'absolute', zIndex: 1000, left: 8, top: 8 }}>
            <button
              onClick={refresh}
              disabled={busy}
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 8, background: '#fff' }}
            >
              {busy ? 'Locating…' : 'Refresh location'}
            </button>
            <div style={{ marginTop: 6, background: '#fff', padding: '4px 8px', borderRadius: 6, border: '1px solid #eee', fontSize: 12, maxWidth: 260 }}>
              {geoErr
                ? <span style={{ color: '#b91c1c' }}>{geoErr}</span>
                : pos
                  ? <>You: {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)} {acc ? `(±${Math.round(acc)} m)` : ''}</>
                  : <>Waiting for location… Tap <b>Refresh location</b> and allow access.</>}
            </div>
          </div>
        </MapContainer>
      </div>
    </div>
  );
}