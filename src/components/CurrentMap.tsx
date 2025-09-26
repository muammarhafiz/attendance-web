'use client';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import { Icon, type LatLngBoundsExpression } from 'leaflet';
import { useEffect, useState } from 'react';

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
  radiusM = Number(process.env.NEXT_PUBLIC_RADIUS_M || 120),
  workshop = {
    lat: Number(process.env.NEXT_PUBLIC_WORKSHOP_LAT),
    lon: Number(process.env.NEXT_PUBLIC_WORKSHOP_LON),
  },
  onLocationChange,
}: {
  radiusM?: number;
  workshop?: { lat: number; lon: number };
  onLocationChange?: (pos: Pos, acc?: number) => void;
}) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  /** Overlay: refresh + initial locate; also fits BOTH pins (workshop + user) */
  const Controls = () => {
    const map = useMap();

    const fitBothPins = (me: Pos | null) => {
      if (!me) return;
      const bounds: LatLngBoundsExpression = [
        [workshop.lat, workshop.lon],
        [me.lat, me.lon],
      ];
      map.fitBounds(bounds, { padding: [40, 40], animate: true });
    };

    const refresh = () => {
      setBusy(true);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const me: Pos = { lat: p.coords.latitude, lon: p.coords.longitude };
          setPos(me);
          setAcc(p.coords.accuracy);
          onLocationChange?.(me, p.coords.accuracy);
          fitBothPins(me);
          setBusy(false);
        },
        (e) => {
          console.error(e);
          alert('Location error: ' + e.message);
          setBusy(false);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    };

    // First locate on mount
    useEffect(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // If workshop changes while we already have a position, re-fit both
    useEffect(() => {
      fitBothPins(pos);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pos, workshop.lat, workshop.lon]);

    return (
      <div style={{ position: 'absolute', zIndex: 1000, left: 8, top: 8 }}>
        <button
          onClick={refresh}
          disabled={busy}
          style={{
            padding: '6px 10px',
            border: '1px solid #ccc',
            borderRadius: 8,
            background: '#fff',
          }}
        >
          {busy ? 'Locating…' : 'Refresh location'}
        </button>
        <div
          style={{
            marginTop: 6,
            background: '#fff',
            padding: '4px 8px',
            borderRadius: 6,
            border: '1px solid #eee',
            fontSize: 12,
          }}
        >
          {pos
            ? <>You: {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)} {acc ? `(±${Math.round(acc)} m)` : ''}</>
            : <>Waiting for location…</>}
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
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {/* Workshop pin + radius */}
        <Marker position={[workshop.lat, workshop.lon]} icon={markerIcon} />
        <Circle center={[workshop.lat, workshop.lon]} radius={radiusM} pathOptions={{ color: '#2563eb' }} />

        {/* User pin */}
        {pos && <Marker position={[pos.lat, pos.lon]} icon={markerIcon} />}

        {/* Overlay controls */}
        <Controls />
      </MapContainer>
    </div>
  );
}
