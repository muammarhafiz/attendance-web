'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { Icon } from './icons';

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

type OffReq = { id: string; date_from: string; date_to: string; reason: string | null; status: string; review_note: string | null; created_at: string };
type HalfReq = { id: string; date_from: string; date_to: string; half: string; reason: string | null; status: string; review_note: string | null; created_at: string };

// 'YYYY-MM-DD' -> '15 Jun'
function fmtDate(d: string): string {
  const p = (d || '').split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(Number(p[1]) || 1) - 1];
  return `${Number(p[2]) || ''} ${mon}`.trim();
}
// KL today + N days as 'YYYY-MM-DD' (off-day requests need >= 2 days' lead time).
const klDatePlus = (days: number) => new Date(Date.now() + 8 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
function offStatusLabel(s: string): string {
  const x = (s || '').toLowerCase();
  return x === 'approved' ? 'Approved' : x === 'rejected' ? 'Rejected' : 'Pending';
}
function offStatusChip(s: string): string {
  const x = (s || '').toLowerCase();
  return 'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' + (x === 'approved' ? 'bg-good-soft text-good' : x === 'rejected' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn');
}
const rm = (n: number | null) => `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type AdvReq = { id: string; amount: number; reason: string | null; status: string; review_note: string | null; credit_by: string | null; requested_at: string };
type AdvLimit = { cap: number; eligible_today: boolean; already_requested: boolean; day: number; absent_days: number; eligible_days: number };
type Perf = { year: number; month: number; late_days: number; late_minutes: number; offday: number; mc: number; absent: number };
type DayRow = { day: string; status: string; check_in_kl: string | null; check_out_kl: string | null; late_min: number | null; half: string | null };
type Payslip = { year: number; month: number; net_pay: number; locked_at: string | null };
type SalesInfo = { year: number; month: number; total: number; invoices: number };
type BoardRow = { staff_name: string; total: number; invoices: number; is_me: boolean };

// Staff's own editable personal details (from my_profile / update_my_profile RPCs).
// All held as strings for the form; position/start_date are read-only (management-set).
type MyProfile = {
  full_name: string; name: string; nationality: string; nric: string; dob: string;
  gender: string; race: string; ability_status: string; marital_status: string;
  phone: string; address: string;
  emergency_name: string; emergency_phone: string; emergency_relationship: string;
  salary_payment_method: string; bank_name: string; bank_account_name: string; bank_account_no: string;
  epf_no: string; socso_no: string; eis_no: string;
  position: string; start_date: string;
};
const EMPTY_PROFILE: MyProfile = {
  full_name: '', name: '', nationality: '', nric: '', dob: '',
  gender: '', race: '', ability_status: '', marital_status: '',
  phone: '', address: '',
  emergency_name: '', emergency_phone: '', emergency_relationship: '',
  salary_payment_method: '', bank_name: '', bank_account_name: '', bank_account_no: '',
  epf_no: '', socso_no: '', eis_no: '',
  position: '', start_date: '',
};
// Normalise the my_profile() JSON (nullable keys) into a string-only form object.
function toProfileForm(data: Record<string, unknown> | null | undefined): MyProfile {
  const d = data ?? {};
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    full_name: s(d.full_name), name: s(d.name), nationality: s(d.nationality), nric: s(d.nric),
    dob: s(d.dob).slice(0, 10),
    gender: s(d.gender), race: s(d.race), ability_status: s(d.ability_status), marital_status: s(d.marital_status),
    phone: s(d.phone), address: s(d.address),
    emergency_name: s(d.emergency_name), emergency_phone: s(d.emergency_phone), emergency_relationship: s(d.emergency_relationship),
    salary_payment_method: s(d.salary_payment_method), bank_name: s(d.bank_name), bank_account_name: s(d.bank_account_name), bank_account_no: s(d.bank_account_no),
    epf_no: s(d.epf_no), socso_no: s(d.socso_no), eis_no: s(d.eis_no),
    position: s(d.position), start_date: s(d.start_date).slice(0, 10),
  };
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

export default function CheckinV2({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<'record' | 'requests' | 'details'>('record');
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
  const [showHalf, setShowHalf] = useState(false);
  const [halfFrom, setHalfFrom] = useState('');
  const [halfTo, setHalfTo] = useState('');
  const [halfWhich, setHalfWhich] = useState<'AM' | 'PM'>('PM');
  const [halfReason, setHalfReason] = useState('');
  const [halfBusy, setHalfBusy] = useState(false);
  const [halfMsg, setHalfMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [myHalf, setMyHalf] = useState<HalfReq[]>([]);
  const [showAdv, setShowAdv] = useState(false);
  const [advAmount, setAdvAmount] = useState('');
  const [advReason, setAdvReason] = useState('');
  const [advBusy, setAdvBusy] = useState(false);
  const [advMsg, setAdvMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [advLimit, setAdvLimit] = useState<AdvLimit | null>(null);
  const [myAdv, setMyAdv] = useState<AdvReq[]>([]);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [perfOffset, setPerfOffset] = useState(0); // 0 = this month, 1 = last month, …
  const [showDaily, setShowDaily] = useState(false);
  const [daily, setDaily] = useState<DayRow[]>([]);
  const [sales, setSales] = useState<SalesInfo | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [slipBusy, setSlipBusy] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]); // team sales leaderboard (everyone can see)
  const [profile, setProfile] = useState<MyProfile | null>(null); // my saved personal details
  const [pf, setPf] = useState<MyProfile>(EMPTY_PROFILE);          // editable form buffer
  const [editProfile, setEditProfile] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
      .select('id,date_from,date_to,reason,status,review_note,created_at')
      .eq('staff_email', email).order('created_at', { ascending: false }).limit(8);
    setMyOff((data ?? []) as OffReq[]);
  }, [email]);

  useEffect(() => { if (email) loadOff(); }, [email, loadOff]);

  const loadHalf = useCallback(async () => {
    if (!email) return;
    const { data } = await supabase.from('halfday_requests')
      .select('id,date_from,date_to,half,reason,status,review_note,created_at')
      .eq('staff_email', email).order('created_at', { ascending: false }).limit(8);
    setMyHalf((data ?? []) as HalfReq[]);
  }, [email]);

  useEffect(() => { if (email) loadHalf(); }, [email, loadHalf]);

  const loadAdv = useCallback(async () => {
    if (!email) return;
    const [{ data: lim }, { data: rows }] = await Promise.all([
      supabase.rpc('my_advance_limit'),
      supabase.from('advance_requests').select('id,amount,reason,status,review_note,credit_by,requested_at').ilike('staff_email', email).order('requested_at', { ascending: false }).limit(6),
    ]);
    if (lim) setAdvLimit(lim as AdvLimit);
    setMyAdv((rows ?? []) as AdvReq[]);
  }, [email]);

  useEffect(() => { if (email) loadAdv(); }, [email, loadAdv]);

  const loadPerf = useCallback(async () => {
    if (!email) return;
    const kl = new Date(Date.now() + 8 * 3600e3);                 // KL "now"
    const t = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - perfOffset, 1));
    const { data } = await supabase.rpc('my_attendance_summary', { p_year: t.getUTCFullYear(), p_month: t.getUTCMonth() + 1 });
    if (data) setPerf(data as Perf);
  }, [email, perfOffset]);

  useEffect(() => { if (email) loadPerf(); }, [email, loadPerf]);

  // The month shown by the "My attendance" card (0 = this month, 1 = last month, …).
  const perfYM = useCallback(() => {
    const kl = new Date(Date.now() + 8 * 3600e3);
    const t = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - perfOffset, 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
  }, [perfOffset]);

  // My sales for the same month — self-scoped server-side.
  const loadSales = useCallback(async () => {
    if (!email) return;
    const { y, m } = perfYM();
    const { data } = await supabase.rpc('my_sales', { p_year: y, p_month: m });
    const row = (Array.isArray(data) ? data[0] : data) as SalesInfo | undefined;
    setSales(row ? { year: Number(row.year), month: Number(row.month), total: Number(row.total), invoices: Number(row.invoices) } : { year: y, month: m, total: 0, invoices: 0 });
  }, [email, perfYM]);
  useEffect(() => { if (email) loadSales(); }, [email, loadSales]);

  // Team sales leaderboard — visible to all staff (sales are not private); same month as My sales.
  const loadBoard = useCallback(async () => {
    if (!email) return;
    const { y, m } = perfYM();
    const { data } = await supabase.rpc('staff_sales_board', { p_year: y, p_month: m });
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      staff_name: String(r.staff_name), total: Number(r.total), invoices: Number(r.invoices), is_me: Boolean(r.is_me),
    }));
    rows.sort((a, b) => b.total - a.total);
    setBoard(rows);
  }, [email, perfYM]);
  useEffect(() => { if (email) loadBoard(); }, [email, loadBoard]);

  // My day-by-day attendance for the same month — self-scoped; only fetched when expanded.
  const loadDaily = useCallback(async () => {
    if (!email) return;
    const { y, m } = perfYM();
    const { data } = await supabase.rpc('my_attendance_month', { p_year: y, p_month: m });
    setDaily(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      day: String(r.day), status: String(r.status), check_in_kl: (r.check_in_kl as string) ?? null,
      check_out_kl: (r.check_out_kl as string) ?? null, late_min: (r.late_min as number) ?? null, half: (r.half as string) ?? null,
    })));
  }, [email, perfYM]);
  useEffect(() => { if (email && showDaily) loadDaily(); }, [email, showDaily, loadDaily]);

  // My finalized payslip months — self-scoped.
  const loadPayslips = useCallback(async () => {
    if (!email) return;
    const { data } = await supabase.rpc('my_payslips');
    setPayslips(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      year: Number(r.year), month: Number(r.month), net_pay: Number(r.net_pay), locked_at: (r.locked_at as string) ?? null,
    })));
  }, [email]);
  useEffect(() => { if (email) loadPayslips(); }, [email, loadPayslips]);

  // My own personal details — self-scoped via the my_profile() RPC.
  const loadProfile = useCallback(async () => {
    if (!email) return;
    const { data } = await supabase.rpc('my_profile');
    const form = toProfileForm(data as Record<string, unknown> | null);
    setProfile(form);
    setPf(form);
  }, [email]);
  useEffect(() => { if (email) loadProfile(); }, [email, loadProfile]);

  const saveProfile = async () => {
    setProfileBusy(true); setProfileMsg(null);
    const { data, error } = await supabase.rpc('update_my_profile', {
      p_full_name: pf.full_name,
      p_nationality: pf.nationality,
      p_nric: pf.nric,
      p_dob: pf.dob || null,
      p_gender: pf.gender,
      p_race: pf.race,
      p_ability_status: pf.ability_status,
      p_marital_status: pf.marital_status,
      p_phone: pf.phone,
      p_address: pf.address,
      p_emergency_name: pf.emergency_name,
      p_emergency_phone: pf.emergency_phone,
      p_emergency_relationship: pf.emergency_relationship,
      p_salary_payment_method: pf.salary_payment_method,
      p_bank_name: pf.bank_name,
      p_bank_account_name: pf.bank_account_name,
      p_bank_account_no: pf.bank_account_no,
      p_epf_no: pf.epf_no,
      p_socso_no: pf.socso_no,
      p_eis_no: pf.eis_no,
    });
    if (error) {
      setProfileMsg({ kind: 'err', text: error.message });
    } else {
      const form = toProfileForm(data as Record<string, unknown> | null);
      setProfile(form);
      setPf(form);
      setEditProfile(false);
      setProfileMsg({ kind: 'ok', text: 'Details saved ✓' });
    }
    setProfileBusy(false);
  };

  const downloadPayslip = useCallback(async (p: Payslip) => {
    const key = `${p.year}-${p.month}`;
    setSlipBusy(key);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`/api/payroll/my-payslip?year=${p.year}&month=${p.month}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.url) throw new Error(j?.error || 'Could not get your payslip.');
      window.open(j.url, '_blank', 'noopener');
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setSlipBusy(null); }
  }, []);

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
    if (offFrom < klDatePlus(2)) { setOffMsg({ kind: 'err', text: 'Off-day requests must be made at least 2 days in advance.' }); return; }
    setOffBusy(true); setOffMsg(null);
    const { error } = await supabase.from('offday_requests').insert({
      staff_email: email, date_from: offFrom, date_to: offTo, reason: offReason || null,
    });
    if (error) setOffMsg({ kind: 'err', text: error.message });
    else { setOffMsg({ kind: 'ok', text: 'Off-day request sent ✓ — waiting for approval.' }); setOffFrom(''); setOffTo(''); setOffReason(''); loadOff(); }
    setOffBusy(false);
  };

  const submitHalf = async () => {
    if (!email) return;
    if (!halfFrom || !halfTo) { setHalfMsg({ kind: 'err', text: 'Pick the start and end dates.' }); return; }
    if (halfFrom > halfTo) { setHalfMsg({ kind: 'err', text: 'The "From" date is after the "To" date.' }); return; }
    if (halfFrom < klDatePlus(2)) { setHalfMsg({ kind: 'err', text: 'Half-day requests must be made at least 2 days in advance.' }); return; }
    setHalfBusy(true); setHalfMsg(null);
    const { error } = await supabase.from('halfday_requests').insert({
      staff_email: email, date_from: halfFrom, date_to: halfTo, half: halfWhich, reason: halfReason || null,
    });
    if (error) setHalfMsg({ kind: 'err', text: error.message });
    else { setHalfMsg({ kind: 'ok', text: 'Half-day request sent ✓ — waiting for approval.' }); setHalfFrom(''); setHalfTo(''); setHalfReason(''); loadHalf(); }
    setHalfBusy(false);
  };

  const submitAdv = async () => {
    if (!email) return;
    const amt = Number(advAmount);
    if (!amt || amt <= 0) { setAdvMsg({ kind: 'err', text: 'Enter an amount.' }); return; }
    setAdvBusy(true); setAdvMsg(null);
    const { error } = await supabase.rpc('request_advance', { p_amount: amt, p_reason: advReason || null });
    if (error) setAdvMsg({ kind: 'err', text: error.message });
    else { setAdvMsg({ kind: 'ok', text: 'Advance request sent ✓ — waiting for approval.' }); setAdvAmount(''); setAdvReason(''); loadAdv(); }
    setAdvBusy(false);
  };

  if (email === undefined || email === null)
    return <div className="mx-auto max-w-md p-6 text-center text-sm text-ink-2">Loading…</div>;

  const timeStr = now
    ? new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)
    : '—';
  const dateStr = now
    ? new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).format(now)
    : '';
  const monthLabel = sales ? new Date(sales.year, sales.month - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' }) : '';

  const segClass = (k: 'record' | 'requests' | 'details') =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === k ? 'bg-card text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`;

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header — left aligned, like the other pages. Hidden when embedded in the Attendance tabs. */}
      {!embedded && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Check in</h1>
          <span className="text-sm text-ink-3">{dateStr}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,360px)_1fr] lg:items-start">
        {/* LEFT — the hero: clock, status, location, and the check-in action, all in one card */}
        <div>
          <div className="rounded-card bg-card p-5 shadow-card">
            <div className="text-4xl font-bold tracking-tight text-ink tabular-nums">{timeStr}</div>
            <div className="mt-1 text-sm text-ink-2">Kuala Lumpur</div>

            <div className="mt-4 border-t border-line pt-4">
              {!checkedIn ? (
                <div className="text-lg font-semibold text-ink">Not checked in yet</div>
              ) : (
                <div>
                  <div className="text-lg font-semibold text-good">
                    ✓ Checked in at {fmtTime(status?.check_in_kl)}
                    {(status?.late_min ?? 0) > 0 && (
                      <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">{status?.late_min} min late</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-ink-2">
                    {checkedOut ? `Checked out at ${fmtTime(status?.check_out_kl)}` : 'Still on the clock'}
                  </div>
                </div>
              )}

              <div className="mt-3">
                {geoErr ? (
                  <div className="text-sm text-bad">{geoErr}</div>
                ) : !geo ? (
                  <div className="text-sm text-ink-2">Getting your GPS…</div>
                ) : (
                  <>
                    {distance != null && (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${inside ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
                        <Icon name="mappin" size={13} /> {inside ? 'Inside the workshop area' : 'Outside the workshop area'} · ~{distance} m
                      </span>
                    )}
                    <div className="mt-1 text-xs text-ink-3">
                      GPS accuracy ±{Math.round(geo.acc)} m ·{' '}
                      <button onClick={getLocation} disabled={locating} className="font-medium text-accent hover:underline disabled:opacity-50">{locating ? 'locating…' : 'refresh'}</button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button onClick={() => doCheck('in')} disabled={busy !== null || checkedIn || !geo}
                className="rounded-2xl bg-good py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40">
                {busy === 'in' ? 'Checking in…' : 'Check in'}
              </button>
              <button onClick={() => doCheck('out')} disabled={busy !== null || !checkedIn || checkedOut || !geo}
                className="rounded-2xl bg-accent py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40">
                {busy === 'out' ? 'Checking out…' : 'Check out'}
              </button>
            </div>

            {msg && (
              <div className={`mt-3 rounded-lg border border-line p-2.5 text-sm ${msg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
                {msg.text}
              </div>
            )}
          </div>
          <p className="mt-2 px-1 text-xs text-ink-3">Your location is checked on the server when you tap the button.</p>
        </div>

        {/* RIGHT — everything else behind a segmented control */}
        <div>
          <div className="mb-4 flex rounded-xl bg-ink/[0.06] p-1" role="tablist">
            <button role="tab" aria-selected={tab === 'record'} onClick={() => setTab('record')} className={segClass('record')}>My record</button>
            <button role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')} className={segClass('requests')}>Requests</button>
            <button role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')} className={segClass('details')}>My details</button>
          </div>

          {/* MY RECORD */}
          {tab === 'record' && (
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              {/* Attendance performance this month — late/absent highlighted */}
              {perf && (
                <div className="rounded-card bg-card p-4 shadow-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="text-ink-2"><Icon name="calendar" size={16} /></span> My attendance</div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPerfOffset((o) => o + 1)} aria-label="Previous month" className="rounded px-1.5 py-0.5 text-base leading-none text-ink-2 hover:bg-ink/5">‹</button>
                      <span className="min-w-[64px] text-center text-xs font-medium text-ink-2">{new Date(perf.year, perf.month - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' })}</span>
                      <button onClick={() => setPerfOffset((o) => Math.max(0, o - 1))} disabled={perfOffset === 0} aria-label="Next month" className="rounded px-1.5 py-0.5 text-base leading-none text-ink-2 hover:bg-ink/5 disabled:opacity-30">›</button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <PerfStat label="Late" value={perf.late_days === 0 ? 'None' : `${perf.late_days}× · ${perf.late_minutes} min`} bad={perf.late_days > 0} tone="amber" />
                    <PerfStat label="Absent" value={perf.absent === 0 ? 'None' : `${perf.absent} day${perf.absent === 1 ? '' : 's'}`} bad={perf.absent > 0} tone="rose" />
                    <PerfStat label="Off days" value={String(perf.offday)} />
                    <PerfStat label="MC" value={String(perf.mc)} />
                  </div>
                  <button onClick={() => setShowDaily((v) => !v)} className="mt-3 w-full rounded-lg border border-line py-1.5 text-xs font-medium text-ink-2 hover:bg-ink/5">
                    {showDaily ? 'Hide day-by-day ▴' : 'Show day-by-day record ▾'}
                  </button>
                  {showDaily && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-line">
                      <div className="max-h-72 divide-y divide-line overflow-auto">
                        {daily.length === 0 ? (
                          <div className="p-3 text-center text-xs text-ink-3">No records for this month.</div>
                        ) : daily.map((d) => <DailyRow key={d.day} d={d} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* My sales this month */}
              {sales && (
                <div className="rounded-card bg-card p-4 shadow-card">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="text-ink-2"><Icon name="trending" size={16} /></span> My sales <span className="text-xs font-normal text-ink-3">· {monthLabel}</span></div>
                    <div className="text-xl font-extrabold text-ink">{rm(sales.total)}</div>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-3">{sales.invoices} invoice{sales.invoices === 1 ? '' : 's'} · use ‹ › above to change month</div>
                </div>
              )}

              {/* Team sales leaderboard — everyone can see (sales are not private) */}
              {board.length > 0 && (
                <div className="rounded-card bg-card p-4 shadow-card">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><span className="text-ink-2"><Icon name="award" size={16} /></span> Sales leaderboard {sales && <span className="text-xs font-normal text-ink-3">· {monthLabel}</span>}</div>
                  <div className="divide-y divide-line">
                    {board.map((r, i) => (
                      <div key={`${r.staff_name}-${i}`} className={`flex items-center justify-between gap-2 py-1.5 ${r.is_me ? 'rounded-lg bg-accent-weak px-2' : ''}`}>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="w-5 shrink-0 text-center text-xs tabular-nums text-ink-3">{i + 1}</span>
                          <span className={`truncate text-sm ${r.is_me ? 'font-semibold text-accent' : 'text-ink-2'}`}>{r.staff_name}{r.is_me ? ' · you' : ''}</span>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-sm tabular-nums ${r.is_me ? 'font-semibold text-accent' : 'text-ink-2'}`}>{rm(r.total)}</div>
                          <div className="text-[10px] text-ink-3">{r.invoices} inv</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-ink-3">Everyone&rsquo;s sales this month · use ‹ › above to change month</div>
                </div>
              )}

              {/* Last month's payslip — download only, salary amount hidden */}
              {(() => {
                const kl = new Date(Date.now() + 8 * 3600e3);              // KL time
                const pm = new Date(Date.UTC(kl.getUTCFullYear(), kl.getUTCMonth() - 1, 1)); // previous month
                const py = pm.getUTCFullYear();
                const pmo = pm.getUTCMonth() + 1;
                const p = payslips.find((x) => x.year === py && x.month === pmo);
                if (!p) return null;                                        // hidden until last month is finalised
                const key = `${p.year}-${p.month}`;
                return (
                  <div className="rounded-card bg-card p-4 shadow-card">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="text-ink-2"><Icon name="receipt" size={16} /></span> Last month&rsquo;s payslip</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-sm text-ink-2">{new Date(p.year, p.month - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}</div>
                      <button onClick={() => downloadPayslip(p)} disabled={slipBusy === key}
                        className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-weak disabled:opacity-50">
                        {slipBusy === key ? '…' : 'Download'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* REQUESTS */}
          {tab === 'requests' && (
            <div>
              {/* Request off day */}
              <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                <button onClick={() => setShowOff((v) => !v)} className="flex w-full items-center gap-2 text-sm font-medium text-ink">
                  <span className="text-ink-2"><Icon name="sun" size={16} /></span><span>Request off day (leave)</span><span className="ml-auto text-ink-3">{showOff ? '−' : '+'}</span>
                </button>
                {showOff && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-ink-2">From
                        <input type="date" value={offFrom} min={klDatePlus(2)} onChange={(e) => setOffFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                      </label>
                      <label className="text-xs text-ink-2">To
                        <input type="date" value={offTo} min={offFrom || klDatePlus(2)} onChange={(e) => setOffTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                      </label>
                    </div>
                    <label className="block text-xs text-ink-2">Reason (optional)
                      <input value={offReason} onChange={(e) => setOffReason(e.target.value)} placeholder="e.g. family matters" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                    </label>
                    <button onClick={submitOff} disabled={offBusy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {offBusy ? 'Sending…' : 'Request off day'}
                    </button>
                    {offMsg && (
                      <div className={`rounded-md border border-line p-2 text-sm ${offMsg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{offMsg.text}</div>
                    )}
                  </div>
                )}
              </div>

              {/* My off-day requests — staff see their own request status (pending / approved / rejected) */}
              {myOff.length > 0 && (
                <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink"><span className="text-ink-2"><Icon name="sun" size={16} /></span> My off-day requests</div>
                  <div className="mt-2 space-y-1.5">
                    {myOff.map((r) => (
                      <div key={r.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-ink-2">{r.date_from === r.date_to ? fmtDate(r.date_from) : `${fmtDate(r.date_from)} – ${fmtDate(r.date_to)}`}</div>
                            {r.reason && <div className="truncate text-xs text-ink-3">{r.reason}</div>}
                          </div>
                          <span className={offStatusChip(r.status)}>{offStatusLabel(r.status)}</span>
                        </div>
                        {r.review_note && (
                          <div className={`mt-1 rounded-md px-2 py-1 text-xs ${(r.status || '').toLowerCase() === 'rejected' ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good'}`}>
                            {(r.status || '').toLowerCase() === 'rejected' ? 'Reason: ' : 'Note: '}{r.review_note}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Request half day */}
              <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                <button onClick={() => setShowHalf((v) => !v)} className="flex w-full items-center gap-2 text-sm font-medium text-ink">
                  <span className="text-ink-2"><Icon name="clock" size={16} /></span><span>Request half day</span><span className="ml-auto text-ink-3">{showHalf ? '−' : '+'}</span>
                </button>
                {showHalf && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setHalfWhich('AM')} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${halfWhich === 'AM' ? 'border-line bg-accent-weak text-accent' : 'border-line text-ink-2'}`}>Morning · 9:30–1:30</button>
                      <button onClick={() => setHalfWhich('PM')} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${halfWhich === 'PM' ? 'border-line bg-accent-weak text-accent' : 'border-line text-ink-2'}`}>Afternoon · 1:30–6:00</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-ink-2">From
                        <input type="date" value={halfFrom} min={klDatePlus(2)} onChange={(e) => setHalfFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                      </label>
                      <label className="text-xs text-ink-2">To
                        <input type="date" value={halfTo} min={halfFrom || klDatePlus(2)} onChange={(e) => setHalfTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                      </label>
                    </div>
                    <label className="block text-xs text-ink-2">Reason (optional)
                      <input value={halfReason} onChange={(e) => setHalfReason(e.target.value)} placeholder="e.g. clinic appointment" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                    </label>
                    <button onClick={submitHalf} disabled={halfBusy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {halfBusy ? 'Sending…' : 'Request half day'}
                    </button>
                    {halfMsg && (
                      <div className={`rounded-md border border-line p-2 text-sm ${halfMsg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{halfMsg.text}</div>
                    )}
                  </div>
                )}
              </div>

              {/* My half-day requests */}
              {myHalf.length > 0 && (
                <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink"><span className="text-ink-2"><Icon name="clock" size={16} /></span> My half-day requests</div>
                  <div className="mt-2 space-y-1.5">
                    {myHalf.map((r) => (
                      <div key={r.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-ink-2">
                              <span className="mr-1 rounded bg-accent-weak px-1.5 py-0.5 text-xs font-medium text-accent">{r.half}</span>
                              {r.date_from === r.date_to ? fmtDate(r.date_from) : `${fmtDate(r.date_from)} – ${fmtDate(r.date_to)}`}
                            </div>
                            {r.reason && <div className="truncate text-xs text-ink-3">{r.reason}</div>}
                          </div>
                          <span className={offStatusChip(r.status)}>{offStatusLabel(r.status)}</span>
                        </div>
                        {r.review_note && (
                          <div className={`mt-1 rounded-md px-2 py-1 text-xs ${(r.status || '').toLowerCase() === 'rejected' ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good'}`}>
                            {(r.status || '').toLowerCase() === 'rejected' ? 'Reason: ' : 'Note: '}{r.review_note}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Request salary advance */}
              <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                <button onClick={() => setShowAdv((v) => !v)} className="flex w-full items-center gap-2 text-sm font-medium text-ink">
                  <span className="text-ink-2"><Icon name="wallet" size={16} /></span><span>Request salary advance</span><span className="ml-auto text-ink-3">{showAdv ? '−' : '+'}</span>
                </button>
                {showAdv && (
                  <div className="mt-3 space-y-2 text-sm">
                    {advLimit && (
                      <div className="rounded-md bg-ink/[0.03] px-3 py-2 text-xs text-ink-2">Max this month: <span className="font-semibold text-ink">{rm(advLimit.cap)}</span> · {advLimit.eligible_days} day{advLimit.eligible_days === 1 ? '' : 's'}{advLimit.absent_days > 0 ? ` (15 − ${advLimit.absent_days} absent)` : ''}</div>
                    )}
                    {advLimit && !advLimit.eligible_today ? (
                      <div className="rounded-md border border-line bg-warn-soft px-3 py-2 text-xs text-warn">Advances can be requested from the 15th of the month onward.</div>
                    ) : advLimit && advLimit.already_requested ? (
                      <div className="rounded-md border border-line bg-warn-soft px-3 py-2 text-xs text-warn">You already have an advance request this month.</div>
                    ) : (
                      <>
                        <label className="block text-xs text-ink-2">Amount (RM)
                          <input type="number" inputMode="decimal" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} placeholder="e.g. 500" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                        </label>
                        <label className="block text-xs text-ink-2">Reason (optional)
                          <input value={advReason} onChange={(e) => setAdvReason(e.target.value)} placeholder="e.g. medical bill" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                        </label>
                        <button onClick={submitAdv} disabled={advBusy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{advBusy ? 'Sending…' : 'Request advance'}</button>
                      </>
                    )}
                    {advMsg && <div className={`rounded-md border border-line p-2 text-sm ${advMsg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{advMsg.text}</div>}
                  </div>
                )}
              </div>

              {/* My advance requests */}
              {myAdv.length > 0 && (
                <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                  <div className="flex items-center gap-2 text-sm font-medium text-ink"><span className="text-ink-2"><Icon name="wallet" size={16} /></span> My advance requests</div>
                  <div className="mt-2 space-y-1.5">
                    {myAdv.map((r) => (
                      <div key={r.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-ink-2">{rm(r.amount)}{r.reason ? ` · ${r.reason}` : ''}</div>
                            {r.status === 'approved' && r.credit_by && <div className="text-xs text-good">credited by {fmtDate(r.credit_by)}</div>}
                          </div>
                          <span className={offStatusChip(r.status)}>{offStatusLabel(r.status)}</span>
                        </div>
                        {r.review_note && (
                          <div className={`mt-1 rounded-md px-2 py-1 text-xs ${(r.status || '').toLowerCase() === 'rejected' ? 'bg-bad-soft text-bad' : 'bg-good-soft text-good'}`}>
                            {(r.status || '').toLowerCase() === 'rejected' ? 'Reason: ' : 'Note: '}{r.review_note}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submit MC */}
              <div className="mb-3 rounded-card bg-card p-4 shadow-card">
                <button onClick={() => setShowMc((v) => !v)} className="flex w-full items-center gap-2 text-sm font-medium text-ink">
                  <span className="text-ink-2"><Icon name="file" size={16} /></span><span>Submit MC (medical certificate)</span><span className="ml-auto text-ink-3">{showMc ? '−' : '+'}</span>
                </button>
                {showMc && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-ink-2">From
                        <input type="date" value={mcFrom} onChange={(e) => setMcFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                      </label>
                      <label className="text-xs text-ink-2">To
                        <input type="date" value={mcTo} onChange={(e) => setMcTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                      </label>
                    </div>
                    <div className="text-xs text-ink-2">Certificate (photo or PDF)
                      <div className="mt-1 flex items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-ink/5">
                          Choose file
                          <input type="file" accept="image/*,application/pdf" onChange={(e) => setMcFile(e.target.files?.[0] ?? null)} className="hidden" />
                        </label>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{mcFile ? mcFile.name : 'No file chosen'}</span>
                      </div>
                    </div>
                    <label className="block text-xs text-ink-2">Note (optional)
                      <input value={mcNote} onChange={(e) => setMcNote(e.target.value)} placeholder="e.g. clinic name" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                    </label>
                    <button onClick={submitMc} disabled={mcBusy} className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {mcBusy ? 'Submitting…' : 'Submit MC'}
                    </button>
                    {mcMsg && (
                      <div className={`rounded-md border border-line p-2 text-sm ${mcMsg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{mcMsg.text}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MY DETAILS — staff view/edit their own personal info (position & start date are read-only) */}
          {tab === 'details' && profile && (
            <div className="rounded-card bg-card p-4 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink"><span className="text-ink-2"><Icon name="user" size={16} /></span> My details</div>
                {!editProfile && (
                  <button onClick={() => { setPf(profile); setProfileMsg(null); setEditProfile(true); }}
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent-weak">
                    Edit
                  </button>
                )}
              </div>

              {/* Read-only — set by management */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-line bg-ink/[0.03] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">Position</div>
                  <div className="text-sm font-semibold text-ink-2">{profile.position || '—'}</div>
                </div>
                <div className="rounded-lg border border-line bg-ink/[0.03] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">Start date</div>
                  <div className="text-sm font-semibold text-ink-2">{profile.start_date || '—'}</div>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-ink-3">Position and start date are set by management.</div>

              {!editProfile ? (
                /* Compact summary */
                <div className="mt-3 space-y-1.5 text-sm">
                  <ProfileRow label="Name" value={profile.full_name} />
                  <ProfileRow label="Phone" value={profile.phone} />
                  <ProfileRow label="Bank account" value={profile.bank_account_no ? `${profile.bank_name ? profile.bank_name + ' · ' : ''}${profile.bank_account_no}` : ''} />
                  <ProfileRow label="Emergency contact" value={profile.emergency_phone ? `${profile.emergency_name ? profile.emergency_name + ' · ' : ''}${profile.emergency_phone}` : ''} />
                </div>
              ) : (
                /* Full editable form */
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Personal</div>
                    <ProfileField label="Full name" value={pf.full_name} onChange={(v) => setPf((p) => ({ ...p, full_name: v }))} />
                    <div className="grid grid-cols-2 gap-2">
                      <ProfileField label="Nationality" value={pf.nationality} onChange={(v) => setPf((p) => ({ ...p, nationality: v }))} />
                      <ProfileField label="NRIC" value={pf.nric} onChange={(v) => setPf((p) => ({ ...p, nric: v }))} />
                      <ProfileField label="Date of birth" type="date" value={pf.dob} onChange={(v) => setPf((p) => ({ ...p, dob: v }))} />
                      <ProfileSelect label="Gender" value={pf.gender} onChange={(v) => setPf((p) => ({ ...p, gender: v }))} options={['Male', 'Female']} />
                      <ProfileSelect label="Race" value={pf.race} onChange={(v) => setPf((p) => ({ ...p, race: v }))} options={['Malay', 'Chinese', 'Indian', 'Other']} />
                      <ProfileSelect label="Ability status" value={pf.ability_status} onChange={(v) => setPf((p) => ({ ...p, ability_status: v }))} options={['Non-disabled', 'Disabled']} />
                      <ProfileSelect label="Marital status" value={pf.marital_status} onChange={(v) => setPf((p) => ({ ...p, marital_status: v }))} options={['Single', 'Married', 'Divorced/Widowed']} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Contact</div>
                    <ProfileField label="Phone" value={pf.phone} onChange={(v) => setPf((p) => ({ ...p, phone: v }))} />
                    <ProfileField label="Address" value={pf.address} onChange={(v) => setPf((p) => ({ ...p, address: v }))} />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Emergency contact</div>
                    <ProfileField label="Name" value={pf.emergency_name} onChange={(v) => setPf((p) => ({ ...p, emergency_name: v }))} />
                    <div className="grid grid-cols-2 gap-2">
                      <ProfileField label="Phone" value={pf.emergency_phone} onChange={(v) => setPf((p) => ({ ...p, emergency_phone: v }))} />
                      <ProfileField label="Relationship" value={pf.emergency_relationship} onChange={(v) => setPf((p) => ({ ...p, emergency_relationship: v }))} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Bank</div>
                    <ProfileSelect label="Salary payment method" value={pf.salary_payment_method} onChange={(v) => setPf((p) => ({ ...p, salary_payment_method: v }))} options={['Cheque', 'Bank Transfer', 'Cash']} />
                    <ProfileField label="Bank name" value={pf.bank_name} onChange={(v) => setPf((p) => ({ ...p, bank_name: v }))} />
                    <ProfileField label="Account holder name" value={pf.bank_account_name} onChange={(v) => setPf((p) => ({ ...p, bank_account_name: v }))} />
                    <ProfileField label="Account no." value={pf.bank_account_no} onChange={(v) => setPf((p) => ({ ...p, bank_account_no: v }))} />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Statutory IDs</div>
                    <div className="grid grid-cols-3 gap-2">
                      <ProfileField label="EPF No" value={pf.epf_no} onChange={(v) => setPf((p) => ({ ...p, epf_no: v }))} />
                      <ProfileField label="SOCSO No" value={pf.socso_no} onChange={(v) => setPf((p) => ({ ...p, socso_no: v }))} />
                      <ProfileField label="EIS No" value={pf.eis_no} onChange={(v) => setPf((p) => ({ ...p, eis_no: v }))} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setPf(profile); setEditProfile(false); setProfileMsg(null); }} disabled={profileBusy}
                      className="rounded-lg border border-line py-2.5 text-sm font-semibold text-ink-2 hover:bg-ink/5 disabled:opacity-50">
                      Cancel
                    </button>
                    <button onClick={saveProfile} disabled={profileBusy}
                      className="rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {profileBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {profileMsg && (
                <div className={`mt-3 rounded-md border border-line p-2 text-sm ${profileMsg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{profileMsg.text}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DailyRow({ d }: { d: DayRow }) {
  const label =
    d.status === 'PRESENT' ? (d.check_in_kl ? `${fmtTime(d.check_in_kl)}${d.check_out_kl ? ' – ' + fmtTime(d.check_out_kl) : ''}` : 'Present')
    : d.status === 'HOME' ? 'Home (WFH)'
    : d.status === 'ABSENT' ? 'Absent'
    : d.status === 'OFFDAY' ? 'Off day'
    : d.status === 'MC' ? 'MC'
    : d.status === 'PH' ? 'Public holiday'
    : d.status === 'OFF' ? 'Rest day'
    : d.status;
  const tone =
    d.status === 'ABSENT' ? 'text-bad'
    : d.status === 'PRESENT' ? 'text-ink-2'
    : d.status === 'HOME' ? 'text-good'
    : 'text-ink-2';
  const dd = new Date(d.day);
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-xs text-ink-2">{dd.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      <span className={`text-right text-xs ${tone}`}>
        {label}
        {d.half && <span className="ml-1 rounded bg-accent-weak px-1 text-[10px] text-accent">½{d.half}</span>}
        {(d.late_min ?? 0) > 0 && <span className="ml-1 rounded bg-warn-soft px-1 text-[10px] font-medium text-warn">{d.late_min}m late</span>}
      </span>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-ink-2">{label}</span>
      <span className={`min-w-0 truncate text-right ${value ? 'text-ink-2' : 'text-ink-3'}`}>{value || 'not set'}</span>
    </div>
  );
}

function ProfileField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block text-xs text-ink-2">{label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
    </label>
  );
}

function ProfileSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block text-xs text-ink-2">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm">
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function PerfStat({ label, value, bad, tone }: { label: string; value: string; bad?: boolean; tone?: 'amber' | 'rose' }) {
  const box = bad ? (tone === 'rose' ? 'border-line bg-bad-soft' : 'border-line bg-warn-soft') : 'border-line bg-ink/[0.03]';
  const val = bad ? (tone === 'rose' ? 'text-bad' : 'text-warn') : 'text-ink-2';
  return (
    <div className={`rounded-lg border px-3 py-2 ${box}`}>
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`text-sm font-semibold ${val}`}>{value}</div>
    </div>
  );
}
