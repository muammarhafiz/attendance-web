'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Status = {
  status?: string;
  check_in_kl?: string | null;
  check_out_kl?: string | null;
  late_min?: number | null;
};

// 'HH:MM:SS.mmm' -> 'H:MM AM/PM'
function fmtTime(t: string | null | undefined): string {
  if (!t) return '—';
  const [hh, mm] = t.split(':');
  let h = Number(hh);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

export default function CheckinV2Page() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [cfg, setCfg] = useState<{ lat: number; lon: number; radius: number } | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | 'in' | 'out'>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [showMc, setShowMc] = useState(false);
  const [mcFrom, setMcFrom] = useState('');
  const [mcTo, setMcTo] = useState('');
  const [mcFile, setMcFile] = useState<File | null>(null);
  const [mcNote, setMcNote] = useState('');
  const [mcBusy, setMcBusy] = useState(false);
  const [mcMsg, setMcMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // --- live KL clock (set after mount to avoid hydration mismatch) ---
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- auth ---
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  // --- workshop geofence config (for on-screen distance only; server is source of truth) ---
  useEffect(() => {
    supabase
      .from('config')
      .select('workshop_lat,workshop_lon,radius_m')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCfg({ lat: data.workshop_lat, lon: data.workshop_lon, radius: data.radius_m });
      });
  }, []);

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_attendance_today');
    if (!error) setStatus((data ?? {}) as Status);
  }, []);

  useEffect(() => {
    if (email) loadStatus();
  }, [email, loadStatus]);

  const getLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoErr('This device does not support GPS.');
      return;
    }
    setLocating(true);
    setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy });
        setLocating(false);
      },
      (err) => {
        setGeoErr(err.message || 'Could not get your location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }, []);

  useEffect(() => {
    getLocation();
  }, [getLocation]);

  const distance = useMemo(() => {
    if (!geo || !cfg) return null;
    return haversineM(geo.lat, geo.lon, cfg.lat, cfg.lon);
  }, [geo, cfg]);

  const inside = distance != null && cfg ? distance <= cfg.radius : null;

  const checkedIn = !!status?.check_in_kl;
  const checkedOut = !!status?.check_out_kl;

  const doCheck = useCallback(
    async (kind: 'in' | 'out') => {
      if (!geo) {
        setMsg({ kind: 'err', text: 'Waiting for your GPS location — tap "Refresh location".' });
        return;
      }
      setBusy(kind);
      setMsg(null);
      const fn = kind === 'in' ? 'checkin_v2' : 'checkout_v2';
      const { error } = await supabase.rpc(fn, { p_lat: geo.lat, p_lon: geo.lon, p_note: null });
      if (error) {
        setMsg({ kind: 'err', text: error.message });
      } else {
        setMsg({ kind: 'ok', text: kind === 'in' ? 'Checked in ✓' : 'Checked out ✓' });
        await loadStatus();
      }
      setBusy(null);
    },
    [geo, loadStatus]
  );

  const submitMc = async () => {
    if (!email) return;
    if (!mcFrom || !mcTo) { setMcMsg({ kind: 'err', text: 'Pick the MC start and end dates.' }); return; }
    if (mcFrom > mcTo) { setMcMsg({ kind: 'err', text: 'The "From" date is after the "To" date.' }); return; }
    if (!mcFile) { setMcMsg({ kind: 'err', text: 'Attach the MC certificate (photo or PDF).' }); return; }
    setMcBusy(true); setMcMsg(null);
    try {
      const ext = (mcFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${email}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from('mc').upload(path, mcFile, { upsert: false });
      if (up.error) throw up.error;
      const { error } = await supabase.from('mc_requests').insert({
        staff_email: email, date_from: mcFrom, date_to: mcTo, file_path: path, note: mcNote || null,
      });
      if (error) throw error;
      setMcMsg({ kind: 'ok', text: 'MC submitted ✓ — waiting for approval.' });
      setMcFrom(''); setMcTo(''); setMcFile(null); setMcNote('');
    } catch (e: unknown) {
      setMcMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setMcBusy(false);
    }
  };

  if (email === undefined) return <div className="text-sm text-gray-500">Loading…</div>;
  if (email === null)
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        Please <a href="/login" className="text-blue-600 underline">sign in</a> to check in.
      </div>
    );

  const timeStr = now
    ? new Intl.DateTimeFormat('en-MY', {
        timeZone: 'Asia/Kuala_Lumpur',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }).format(now)
    : '—';
  const dateStr = now
    ? new Intl.DateTimeFormat('en-MY', {
        timeZone: 'Asia/Kuala_Lumpur',
        weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
      }).format(now)
    : '';

  return (
    <div className="mx-auto max-w-md">
      {/* Live clock */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 text-center">
        <div className="text-4xl font-bold tracking-tight text-gray-900 tabular-nums">{timeStr}</div>
        <div className="mt-1 text-sm text-gray-500">{dateStr} · Kuala Lumpur</div>
      </div>

      {/* Status card */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Today</div>
        {!checkedIn ? (
          <div className="mt-1 text-lg font-semibold text-gray-900">Not checked in yet</div>
        ) : (
          <div className="mt-1">
            <div className="text-lg font-semibold text-emerald-700">
              ✓ Checked in at {fmtTime(status?.check_in_kl)}
              {(status?.late_min ?? 0) > 0 && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  {status?.late_min} min late
                </span>
              )}
            </div>
            <div className="mt-0.5 text-sm text-gray-500">
              {checkedOut ? `Checked out at ${fmtTime(status?.check_out_kl)}` : 'Still on the clock'}
            </div>
          </div>
        )}
      </div>

      {/* Location card */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700">Your location</div>
          <button
            onClick={getLocation}
            disabled={locating}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {locating ? 'Locating…' : 'Refresh location'}
          </button>
        </div>
        {geoErr ? (
          <div className="mt-2 text-sm text-rose-600">{geoErr}</div>
        ) : !geo ? (
          <div className="mt-2 text-sm text-gray-500">Getting your GPS…</div>
        ) : (
          <div className="mt-2 text-sm">
            {distance != null && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                  inside ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {inside ? '✓ Inside the workshop area' : '✗ Outside the workshop area'} · ~{distance} m
              </span>
            )}
            <div className="mt-1 text-xs text-gray-400">GPS accuracy ±{Math.round(geo.acc)} m</div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => doCheck('in')}
          disabled={busy !== null || checkedIn || !geo}
          className="rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy === 'in' ? 'Checking in…' : 'Check in'}
        </button>
        <button
          onClick={() => doCheck('out')}
          disabled={busy !== null || !checkedIn || checkedOut || !geo}
          className="rounded-xl bg-gray-900 py-4 text-base font-semibold text-white transition hover:bg-black disabled:opacity-40"
        >
          {busy === 'out' ? 'Checking out…' : 'Check out'}
        </button>
      </div>

      {msg && (
        <div
          className={`mt-3 rounded-lg border p-2.5 text-sm ${
            msg.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      )}

      <p className="mt-3 text-center text-xs text-gray-400">
        Your location is checked on the server when you tap the button.
      </p>

      {/* Submit MC */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <button onClick={() => setShowMc((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium text-gray-700">
          <span>📄 Submit MC (medical certificate)</span>
          <span className="text-gray-400">{showMc ? '−' : '+'}</span>
        </button>
        {showMc && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">From
                <input type="date" value={mcFrom} onChange={(e) => setMcFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-500">To
                <input type="date" value={mcTo} onChange={(e) => setMcTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <label className="block text-xs text-gray-500">Certificate (photo or PDF)
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setMcFile(e.target.files?.[0] ?? null)} className="mt-0.5 block w-full text-sm" />
            </label>
            <label className="block text-xs text-gray-500">Note (optional)
              <input value={mcNote} onChange={(e) => setMcNote(e.target.value)} placeholder="e.g. clinic name" className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <button onClick={submitMc} disabled={mcBusy} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {mcBusy ? 'Submitting…' : 'Submit MC'}
            </button>
            {mcMsg && (
              <div className={`rounded-md border p-2 text-sm ${mcMsg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                {mcMsg.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
