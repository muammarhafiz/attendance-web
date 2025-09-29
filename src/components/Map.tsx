'use client';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import { Icon, type LatLngBoundsExpression } from 'leaflet';
import { useState } from 'react';
import { WORKSHOP } from '../config/workshop';

const markerIcon = new Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Pos = { lat: number; lon: number };

export default function CurrentMap({
  radiusM = WORKSHOP.radiusM,
  workshop = { lat: WORKSHOP.lat, lon: WORKSHOP.lon },
  onLocationChange,
}: {
  radiusM?: number;
  workshop?: { lat: number; lon: number };
  onLocationChange?: (pos: Pos, acc?: number) => void;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const Controls = () => {
    const map = useMap();

    const fitBothPins = (me: Pos) => {
      const bounds: LatLngBoundsExpression = [
        [workshop.lat, workshop.lon],
        [me.lat, me.lon],
      ];
      map.fitBounds(bounds, { padding: [40, 40], animate: true });
    };

    const refresh = () => {
      if (!('geolocation' in navigator)) {
        setErrMsg('Location is not available on this device/browser.');
        return;
      }
      setBusy(true);
      setErrMsg(null);

      navigator.geolocation.getCurrentPosition(
        p => {
          const quick = { lat: p.coords.latitude, lon: p.coords.longitude };
          setPos(quick);
          setAcc(p.coords.accuracy);
          onLocationChange?.(quick, p.coords.accuracy);
          fitBothPins(quick);

          navigator.geolocation.getCurrentPosition(
            hp => {
              const precise = { lat: hp.coords.latitude, lon: hp.coords.longitude };
              setPos(precise);
              setAcc(hp.coords.accuracy);
              onLocationChange?.(precise, hp.coords.accuracy);
              fitBothPins(precise);
              setBusy(false);
            },
            () => setBusy(false),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
          );
        },
        e => { setErrMsg('Location error: ' + e.message); setBusy(false); },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    };

    return (
      <div style={{ position: 'absolute', zIndex: 1000, left: 8, top: 8 }}>
        <button
          onClick={refresh}
          disabled={busy}
          style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 8, background: '#fff' }}
        >
          {busy ? 'Locating…' : 'Refresh location'}
        </button>
        <div style={{ marginTop: 6, background: '#fff', padding: '4px 8px', borderRadius: 6, border: '1px solid #eee', fontSize: 12, maxWidth: 260 }}>
          {errMsg
            ? <span style={{ color: '#b91c1c' }}>{errMsg}</span>
            : pos
              ? <>You: {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)} {acc ? `(±${Math.round(acc)} m)` : ''}</>
              : <>Waiting for location… Tap <b>Refresh location</b> and allow access.</>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      <MapContainer
        center={[workshop.lat, workshop.lon]}
        zoom={17}
        style={{ height: 360, width: '100%' }}
        scrollWheelZoom
        zoomControl
        doubleClickZoom
        dragging
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        <Marker position={[workshop.lat, workshop.lon]} icon={markerIcon} />
        <Circle center={[workshop.lat, workshop.lon]} radius={radiusM} pathOptions={{ color: '#2563eb' }} />
        {pos && <Marker position={[pos.lat, pos.lon]} icon={markerIcon} />}
        <Controls />
      </MapContainer>
    </div>
  );
}