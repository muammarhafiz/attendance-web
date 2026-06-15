'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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

type OffReq = { id: string; date_from: string; date_to: string; reason: string | null; status: string; created_at: string };

// 'YYYY-MM-DD' -> '15 Jun'
function fmtDate(d: string): string {
  const p = (d || '').split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(Number(p[1]) || 1) - 1];
  return `${Number(p[2]) || ''} ${mon}`.trim();
}
function offStatusLabel(s: string): string {
  const x = (s || '').toLowerCase();
  return x === 'approved' ? '✅ Approved' : x === 'rejected' ? '❌ Rejected' : '⏳ Pending';
}
function offStatusChip(s: string): string {
  const x = (s || '').toLowerCase();
  return 'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' + (x === 'approved' ? 'bg-emerald-100 text-emerald-700' : x === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800');
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

export default function CheckinV2() {
  const router = useRouter();
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
  const [showOff, setShowOff] = useState(false);
  const [offFrom, setOffFrom] = useState('');
  const [offTo, setOffTo] = useState('');
  const [offReason, setOffReason] = useState('');
  const [offBusy, setOffBusy] = useState(false);
  const [offMsg, setOffMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [myOff, setMyOff] = useState<OffReq[]>([]);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    supabase.from('config').select('workshop_lat,workshop_lon,radius_m').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setCfg({ lat: data.workshop_lat, lon: data.workshop_lon, radius: data.radius_m }); });
  }, []);

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_attendance_today');
    if (!error) setStatus((data ?? {}) as Status);
  }, []);

  useEffect(() => { if (email) loadStatus(); }, [email, loadStatus]);

  const loadOff = useCallback(async () => {
    if (!email) return;
    const { data } = await supabase.from('offday_requests')
      .select('id,date_from,date_to,reason,status,created_at')
      .eq('staff_email', email).order('created_at', { ascending: false }).limit(8);
    setMyOff((data ?? []) as OffReq[]);
  }, [email]);

  useEffect(() => { if (email) loadOff(); }, [email, loadOff]);

  // Not signed in → send to the branded login page.
  useEffect(() => { if (email === null) router.replace('/login'); }, [email, router]);

  const getLocation = useCallback(() => {
    if (!('geolocation' in navigator)) { setGeoErr('This device does not support GPS.'); return; }
    setLocating(true); setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }); setLocating(false); },
      (err) => { setGeoErr(err.message || 'Could not get your location.'); setLocating(false); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }, []);

  useEffect(() => { getLocation(); }, [getLocation]);

  const distance = useMemo(() => {
    if (!geo || !cfg) return null;
    return haversineM(geo.lat, geo.lon, cfg.lat, cfg.lon);
  }, [geo, cfg]);

  const inside = distance != null && cfg ? distance <= cfg.radius : null;
  const checkedIn = !!status?.check_in_kl;
  const checkedOut = !!status?.check_out_kl;

  const doCheck = useCallback(
    async (kind: 'in' | 'out') => {
      if (!geo) { setMsg({ kind: 'err', text: 'Waiting for your GPS location — tap "Refresh location".' }); return; }
      setBusy(kind); setMsg(null);
      const fn = kind === 'in' ? 'checkin_v2' : 'checkout_v2';
      const { error } = await supabase.rpc(fn, { p_lat: geo.lat, p_lon: geo.lon, p_note: null });
      if (error) setMsg({ kind: 'err', text: error.message });
      else { setMsg({ kind: 'ok', text: kind === 'in' ? 'Checked in ✓' : 'Checked out ✓' }); await loadStatus(); }
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
    } finally { setMcBusy(false); }
  };

  const submitOff = async () => {
    if (!email) return;
    if (!offFrom || !offTo) { setOffMsg({ kind: 'err', text: 'Pick the start and end dates.' }); return; }
    if (offFrom > offTo) { setOffMsg({ kind: 'err', text: 'The "From" date is after the "To" date.' }); return; }
    setOffBusy(true); setOffMsg(null);
    const { error } = await supabase.from('offday_requests').insert({
      staff_email: email, date_from: offFrom, date_to: offTo, reason: offReason || null,
    });
    if (error) setOffMsg({ kind: 'err', text: error.message });
    else { setOffMsg({ kind: 'ok', text: 'Off-day request sent ✓ — waiting for approval.' }); setOffFrom(''); setOffTo(''); setOffReason(''); loadOff(); }
    setOffBusy(false);
  };

  if (email === undefined || email === null)
    return <div className="mx-auto max-w-md p-6 text-center text-sm text-slate-500">Loading…</div>;

  const timeStr = now
    ? new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)
    : '—';
  const dateStr = now
    ? new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).format(now)
    : '';

  return (
    <div className="mx-auto max-w-md">
      {/* Live clock */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <div className="text-4xl font-bold tracking-tight text-slate-900 tabular-nums">{timeStr}</div>
        <div className="mt-1 text-sm text-slate-500">{dateStr} · Kuala Lumpur</div>
      </div>

      {/* Status */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Today</div>
        {!checkedIn ? (
          <div className="mt-1 text-lg font-semibold text-slate-900">Not checked in yet</div>
        ) : (
          <div className="mt-1">
            <div className="text-lg font-semibold text-emerald-700">
              ✓ Checked in at {fmtTime(status?.check_in_kl)}
              {(status?.late_min ?? 0) > 0 && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{status?.late_min} min late</span>
              )}
            </div>
            <div className="mt-0.5 text-sm text-slate-500">
              {checkedOut ? `Checked out at ${fmtTime(status?.check_out_kl)}` : 'Still on the clock'}
            </div>
          </div>
        )}
      </div>

      {/* Location */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">Your location</div>
          <button onClick={getLocation} disabled={locating} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {locating ? 'Locating…' : 'Refresh location'}
          </button>
        </div>
        {geoErr ? (
          <div className="mt-2 text-sm text-rose-600">{geoErr}</div>
        ) : !geo ? (
          <div className="mt-2 text-sm text-slate-500">Getting your GPS…</div>
        ) : (
          <div className="mt-2 text-sm">
            {distance != null && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${inside ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {inside ? '✓ Inside the workshop area' : '✗ Outside the workshop area'} · ~{distance} m
              </span>
            )}
            <div className="mt-1 text-xs text-slate-400">GPS accuracy ±{Math.round(geo.acc)} m</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => doCheck('in')} disabled={busy !== null || checkedIn || !geo}
          className="rounded-2xl bg-emerald-600 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-40">
          {busy === 'in' ? 'Checking in…' : 'Check in'}
        </button>
        <button onClick={() => doCheck('out')} disabled={busy !== null || !checkedIn || checkedOut || !geo}
          className="rounded-2xl bg-brand-700 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:opacity-40">
          {busy === 'out' ? 'Checking out…' : 'Check out'}
        </button>
      </div>

      {msg && (
        <div className={`mt-3 rounded-lg border p-2.5 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      <p className="mt-3 text-center text-xs text-slate-400">Your location is checked on the server when you tap the button.</p>

      {/* Request off day */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button onClick={() => setShowOff((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium text-slate-700">
          <span>🌴 Request off day (leave)</span>
          <span className="text-slate-400">{showOff ? '−' : '+'}</span>
        </button>
        {showOff && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">From
                <input type="date" value={offFrom} onChange={(e) => setOffFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-500">To
                <input type="date" value={offTo} onChange={(e) => setOffTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <label className="block text-xs text-slate-500">Reason (optional)
              <input value={offReason} onChange={(e) => setOffReason(e.target.value)} placeholder="e.g. family matters" className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button onClick={submitOff} disabled={offBusy} className="w-full rounded-lg bg-brand-700 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              {offBusy ? 'Sending…' : 'Request off day'}
            </button>
            {offMsg && (
              <div className={`rounded-md border p-2 text-sm ${offMsg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{offMsg.text}</div>
            )}
          </div>
        )}
      </div>

      {/* My off-day requests — staff see their own request status (pending / approved / rejected) */}
      {myOff.length > 0 && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-slate-700">🌴 My off-day requests</div>
          <div className="mt-2 space-y-1.5">
            {myOff.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="text-slate-800">{r.date_from === r.date_to ? fmtDate(r.date_from) : `${fmtDate(r.date_from)} – ${fmtDate(r.date_to)}`}</div>
                  {r.reason && <div className="truncate text-xs text-slate-400">{r.reason}</div>}
                </div>
                <span className={offStatusChip(r.status)}>{offStatusLabel(r.status)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit MC */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button onClick={() => setShowMc((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium text-slate-700">
          <span>📄 Submit MC (medical certificate)</span>
          <span className="text-slate-400">{showMc ? '−' : '+'}</span>
        </button>
        {showMc && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-500">From
                <input type="date" value={mcFrom} onChange={(e) => setMcFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-500">To
                <input type="date" value={mcTo} onChange={(e) => setMcTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <div className="text-xs text-slate-500">Certificate (photo or PDF)
              <div className="mt-1 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  📎 Choose file
                  <input type="file" accept="image/*,application/pdf" onChange={(e) => setMcFile(e.target.files?.[0] ?? null)} className="hidden" />
                </label>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{mcFile ? mcFile.name : 'No file chosen'}</span>
              </div>
            </div>
            <label className="block text-xs text-slate-500">Note (optional)
              <input value={mcNote} onChange={(e) => setMcNote(e.target.value)} placeholder="e.g. clinic name" className="mt-0.5 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button onClick={submitMc} disabled={mcBusy} className="w-full rounded-lg bg-brand-700 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
              {mcBusy ? 'Submitting…' : 'Submit MC'}
            </button>
            {mcMsg && (
              <div className={`rounded-md border p-2 text-sm ${mcMsg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{mcMsg.text}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
