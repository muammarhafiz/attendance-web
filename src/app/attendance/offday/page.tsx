'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Staff = { email: string; name: string | null };
type DSRow = { day: string; staff_email: string; status: string; note: string | null };
type DocReq = { id: string; staff_email: string; day: string; label: string | null; note: string | null; doc_path: string | null; required_by: string | null; created_at: string; uploaded_at: string | null };

const isoToday = () => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
};

const STATUSES = [
  { value: 'OFFDAY', label: 'Off day (annual leave / rest)' },
  { value: 'PH', label: 'Public holiday (government)' },
  { value: 'MC', label: 'Medical leave (MC)' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'HALF_AM', label: 'Half day — morning (9:30–1:30)' },
  { value: 'HALF_PM', label: 'Half day — afternoon (1:30–6:00)' },
];
const STATUS_LABEL: Record<string, string> = {
  OFFDAY: 'Off day', PH: 'Public holiday', MC: 'MC', ABSENT: 'Absent',
  HALF_AM: 'Half day (AM)', HALF_PM: 'Half day (PM)',
};

export default function AttendanceOffdayPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);

  const [from, setFrom] = useState(isoToday());
  const [to, setTo] = useState(isoToday());
  const [who, setWho] = useState('ALL');
  const [status, setStatus] = useState('OFFDAY');
  const [note, setNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [existing, setExisting] = useState<DSRow[]>([]);
  const [me, setMe] = useState('');
  const [requireProof, setRequireProof] = useState(false); // ask the staff to upload proof for this day
  const [docReqs, setDocReqs] = useState<DocReq[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      setMe(data.session?.user?.email ?? '');
      if (data.session) {
        const { data: ok } = await supabase.rpc('can_access', { p_feature: 'attendance' });
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  const nameByEmail = useMemo(() => {
    const m = new Map<string, string>();
    staff.forEach((s) => m.set(s.email, s.name ?? s.email));
    return m;
  }, [staff]);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase.from('staff').select('email,name').is('archived_at', null).order('name');
    setStaff((data ?? []) as Staff[]);
  }, []);

  // existing day_status for the FROM month
  const loadExisting = useCallback(async () => {
    const [y, m] = from.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const endD = new Date(y, m, 1);
    const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-01`;
    const [{ data: ds }, { data: dh }] = await Promise.all([
      supabase.from('day_status').select('day,staff_email,status,note').gte('day', start).lt('day', end),
      supabase.from('day_half').select('day,staff_email,half,note').gte('day', start).lt('day', end),
    ]);
    const merged: DSRow[] = [
      ...((ds ?? []) as DSRow[]),
      ...((dh ?? []) as Array<{ day: string; staff_email: string; half: string; note: string | null }>)
        .map((h) => ({ day: h.day, staff_email: h.staff_email, status: `HALF_${h.half}`, note: h.note })),
    ].sort((a, b) => (a.day < b.day ? 1 : -1));
    setExisting(merged);
  }, [from]);

  const loadDocReqs = useCallback(async () => {
    const { data } = await supabase.from('attendance_doc_requests').select('*').order('created_at', { ascending: false }).limit(50);
    setDocReqs((data ?? []) as DocReq[]);
  }, []);
  const viewDoc = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from('mc').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, []);

  useEffect(() => {
    if (isAdmin) { loadStaff(); loadExisting(); loadDocReqs(); }
  }, [isAdmin, loadStaff, loadExisting, loadDocReqs]);

  function eachDay(a: string, b: string): string[] {
    const out: string[] = [];
    const d = new Date(a + 'T00:00:00');
    const end = new Date(b + 'T00:00:00');
    while (d <= end) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  const apply = useCallback(async () => {
    if (!from || !to || from > to) { setMsg({ kind: 'err', text: 'Pick a valid date range.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const isHalf = status === 'HALF_AM' || status === 'HALF_PM';
      const half = status === 'HALF_PM' ? 'PM' : 'AM';
      const days = eachDay(from, to);
      for (const d of days) {
        if (isHalf) {
          const { error } = who === 'ALL'
            ? await supabase.rpc('set_day_half_all', { p_day: d, p_half: half, p_note: note || null })
            : await supabase.rpc('set_day_half', { p_email: who, p_day: d, p_half: half, p_note: note || null });
          if (error) throw error;
        } else if (who === 'ALL') {
          const { error } = await supabase.rpc('set_day_status_all', { p_day: d, p_status: status, p_note: note || null });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc('set_day_status', { p_email: who, p_day: d, p_status: status, p_note: note || null });
          if (error) throw error;
        }
      }
      await supabase.rpc('attendance_v2_recompute', { p_from: from, p_to: to });
      if (requireProof && who !== 'ALL') {
        await supabase.from('attendance_doc_requests').insert(
          days.map((d) => ({ staff_email: who, day: d, label: status, note: note || null, required_by: me || null }))
        );
      }
      setMsg({ kind: 'ok', text: `Set ${STATUS_LABEL[status] ?? status} for ${days.length} day(s).${requireProof && who !== 'ALL' ? ' — proof requested from the staff.' : ''}` });
      setNote(''); setRequireProof(false);
      await loadExisting(); await loadDocReqs();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }, [from, to, who, status, note, requireProof, me, loadExisting, loadDocReqs]);

  const clearOne = useCallback(async (r: DSRow) => {
    setBusy(true); setMsg(null);
    try {
      const isHalf = r.status === 'HALF_AM' || r.status === 'HALF_PM';
      const { error } = isHalf
        ? await supabase.rpc('clear_day_half', { p_email: r.staff_email, p_day: r.day })
        : await supabase.from('day_status').delete().eq('day', r.day).eq('staff_email', r.staff_email);
      if (error) throw error;
      await supabase.rpc('attendance_v2_recompute', { p_from: r.day, p_to: r.day });
      await loadExisting();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }, [loadExisting]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-3">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  return (
    <div className="max-w-2xl">
      <div className="mb-5 rounded-card bg-card shadow-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-ink-3">From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-ink-3">To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-ink-3">Who
            <select value={who} onChange={(e) => setWho(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm">
              <option value="ALL">All staff</option>
              {staff.map((s) => <option key={s.email} value={s.email}>{s.name ?? s.email}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-3">Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm">
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-3 sm:col-span-2">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Hari Raya, Medical leave" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
          </label>
        </div>
        {who !== 'ALL' && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={requireProof} onChange={(e) => setRequireProof(e.target.checked)} className="h-4 w-4" />
            Require the staff to upload proof for this day
          </label>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button onClick={apply} disabled={busy} className="rounded-md bg-btn px-4 py-2 text-sm font-medium text-btn-ink hover:opacity-90 disabled:opacity-50">
            {busy ? 'Saving…' : 'Set'}
          </button>
          <span className="text-xs text-ink-3">Tip: for a government holiday, pick &quot;Public holiday&quot; + All staff.</span>
        </div>
        {msg && (
          <div className={`mt-3 rounded-md border border-line p-2 text-sm ${msg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
            {msg.text}
          </div>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink-2">Set for {from.slice(0, 7)}</h2>
      {existing.length === 0 ? (
        <div className="rounded-lg border border-line bg-ink/[0.03] p-4 text-center text-sm text-ink-3">Nothing set this month.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-ink/[0.03] text-left">
                <th className="px-3 py-2 font-medium text-ink-2">Date</th>
                <th className="px-3 py-2 font-medium text-ink-2">Staff</th>
                <th className="px-3 py-2 font-medium text-ink-2">Status</th>
                <th className="px-3 py-2 font-medium text-ink-2">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {existing.map((r) => (
                <tr key={`${r.day}|${r.staff_email}`} className="border-t border-line">
                  <td className="px-3 py-2 text-ink-2">{r.day.slice(8)}/{r.day.slice(5, 7)}</td>
                  <td className="px-3 py-2 text-ink-2">{nameByEmail.get(r.staff_email) ?? r.staff_email}</td>
                  <td className="px-3 py-2"><span className="rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="px-3 py-2 text-ink-3">{r.note ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => clearOne(r)} disabled={busy} className="rounded border border-line px-2 py-0.5 text-xs text-ink-3 hover:bg-ink/5 disabled:opacity-50">Clear</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {docReqs.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink-2">Proof requested from staff</h2>
          <div className="space-y-2">
            {docReqs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-card p-3 shadow-card">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {nameByEmail.get(r.staff_email) ?? r.staff_email}
                    <span className="ml-2 text-xs font-normal text-ink-2">{r.day.slice(8)}/{r.day.slice(5, 7)}/{r.day.slice(0, 4)}</span>
                    {r.label && <span className="ml-2 rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">{STATUS_LABEL[r.label] ?? r.label}</span>}
                  </div>
                  {r.note && <div className="text-xs text-ink-3">{r.note}</div>}
                </div>
                {r.doc_path ? (
                  <button onClick={() => viewDoc(r.doc_path)} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5">View proof</button>
                ) : (
                  <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Waiting for upload</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
