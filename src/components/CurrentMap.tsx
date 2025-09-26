'use client';
import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import { useEffect, useState } from 'react';
import L from 'leaflet';

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25,41], iconAnchor: [12,41], popupAnchor: [1,-34], shadowSize: [41,41]
});

export default function CurrentMap({
  radiusM = Number(process.env.NEXT_PUBLIC_RADIUS_M || 120),
  workshop = {
    lat: Number(process.env.NEXT_PUBLIC_WORKSHOP_LAT),
    lon: Number(process.env.NEXT_PUBLIC_WORKSHOP_LON)
  }
}: { radiusM?: number; workshop?: {lat:number; lon:number} }) {
  const [pos, setPos] = useState<{lat:number; lon:number} | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      p => { setPos({lat: p.coords.latitude, lon: p.coords.longitude}); setAcc(p.coords.accuracy); setBusy(false); },
      e => { console.error(e); setBusy(false); alert('Location error: ' + e.message); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  useEffect(() => { refresh(); }, []);

  const center = pos ? [pos.lat, pos.lon] as [number, number] : [workshop.lat, workshop.lon] as [number, number];

  return (
    <div style={{border:'1px solid #ddd', borderRadius:8, overflow:'hidden'}}>
      <div style={{display:'flex', gap:8, padding:8, alignItems:'center'}}>
        <button onClick={refresh} disabled={busy} style={{padding:'8px 12px', border:'1px solid #ccc', borderRadius:8}}>
          {busy ? 'Locating…' : 'Refresh location'}
        </button>
        <div style={{color:'#555', fontSize:14}}>
          {pos
            ? <>You: {pos.lat.toFixed(6)}, {pos.lon.toFixed(6)} {acc ? `(±${Math.round(acc)} m)` : ''}</>
            : <>Waiting for location…</>}
        </div>
      </div>
      <MapContainer center={center} zoom={17} style={{height: 360, width: '100%'}}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                   attribution="&copy; OpenStreetMap contributors" />
        {/* Workshop pin + radius */}
        <Marker position={[workshop.lat, workshop.lon]} icon={markerIcon} />
        <Circle center={[workshop.lat, workshop.lon]} radius={radiusM} pathOptions={{ color: '#2563eb' }} />
        {/* Current user location */}
        {pos && <Marker position={[pos.lat, pos.lon]} icon={markerIcon} />}
      </MapContainer>
    </div>
  );
}
