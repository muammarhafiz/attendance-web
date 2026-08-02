'use client';

// Unified request inbox — off-day, half-day, MC, advance and emergency absences in one list.
// Replaces the five separate approver pages (/leave, /halfday-req, /mc, /advance, /emergency),
// which now redirect here. Off-day/half-day/MC/advance are approve-or-reject requests; emergency
// is a classify-and-record flow (the absence already happened — pick what it counts as).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Kind = 'offday' | 'halfday' | 'mc' | 'advance' | 'emergency';

type Req = {
  kind: Kind;
  id: string;
  staff_email: string;
  status: string;                   // pending/approved/rejected — or new/handled for emergency
  ts: string;                       // sort key (created_at / requested_at)
  review_note: string | null;
  reason: string | null;
  informed_supervisor: string | null;
  date_from: string | null;
  date_to: string | null;
  half: string | null;
  file_path: string | null;
  amount: number | null;
  credit_by: string | null;
};

// Raw row shapes per source table (only the columns we read).
type OffRow = { id: string; staff_email: string; status: string; created_at: string; review_note: string | null; reason: string | null; informed_supervisor: string | null; date_from: string; date_to: string; file_path: string | null };
type HdRow = { id: string; staff_email: string; status: string; created_at: string; review_note: string | null; reason: string | null; informed_supervisor: string | null; date_from: string; date_to: string; half: string };
type McRow = { id: string; staff_email: string; status: string; created_at: string; note: string | null; date_from: string; date_to: string; file_path: string | null };
type AdvRow = { id: string; staff_email: string; status: string; requested_at: string; review_note: string | null; reason: string | null; amount: number; credit_by: string | null };
type EmRow = { id: string; staff_email: string; status: string; created_at: string; reason: string | null; informed_supervisor: string | null; absent_date: string; file_path: string | null };

const KIND_META: Record<Kind, { icon: string; label: string }> = {
  offday: { icon: '🌴', label: 'Off-day' },
  halfday: { icon: '🕧', label: 'Half-day' },
  mc: { icon: '📄', label: 'MC' },
  advance: { icon: '💵', label: 'Advance' },
  emergency: { icon: '🚨', label: 'Emergency' },
};

// Full-day outcomes the office can record for an emergency absence (sets attendance + pay).
const CLASSIFY = [
  { value: 'OFFDAY', label: 'Off day (paid leave)' },
  { value: 'MC', label: 'MC (paid sick)' },
  { value: 'ABSENT', label: 'Absent (unpaid)' },
  { value: 'PH', label: 'Public holiday' },
];

const fmtD = (d: string | null) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const rm = (n: number | null) => `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const halfLabel = (h: string | null) => (h === 'PM' ? 'PM (1:30–6:00)' : 'AM (9:30–1:30)');
// "Needs action" — pending for approve/reject types, new for emergency.
const isPending = (r: Req) => (r.kind === 'emergency' ? r.status === 'new' : r.status === 'pending');

export default function RequestsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [me, setMe] = useState('');
  const [reqs, setReqs] = useState<Req[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [over, setOver] = useState<Set<string>>(new Set()); // staff with no annual leave left this year
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kindF, setKindF] = useState<'ALL' | Kind>('ALL');
  const [staffF, setStaffF] = useState('ALL');
  const [statusF, setStatusF] = useState('pending');
  const [picks, setPicks] = useState<Record<string, string>>({}); // emergency: chosen classification per row
  // off-day inline edit (change the dates the staff agreed to before approving)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eFrom, setEFrom] = useState('');
  const [eTo, setETo] = useState('');
  const [eReason, setEReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      setMe(data.session?.user?.email ?? '');
      if (data.session) { const { data: ok } = await supabase.rpc('can_access', { p_feature: 'attendance' }); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  // The old routes redirect here with ?type=… — pre-select that type filter.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('type');
    if (t === 'offday' || t === 'halfday' || t === 'mc' || t === 'advance' || t === 'emergency') setKindF(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const yr = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
    const [off, hd, mcq, adv, em, s, bal] = await Promise.all([
      supabase.from('offday_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('halfday_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('mc_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('advance_requests').select('*').order('requested_at', { ascending: false }),
      supabase.from('emergency_absences').select('*').order('created_at', { ascending: false }),
      supabase.from('staff').select('email,name'),
      supabase.rpc('leave_balances', { p_year: yr }),
    ]);
    const rows: Req[] = [];
    ((off.data ?? []) as OffRow[]).forEach((r) => rows.push({ kind: 'offday', id: r.id, staff_email: r.staff_email, status: r.status, ts: r.created_at, review_note: r.review_note, reason: r.reason, informed_supervisor: r.informed_supervisor, date_from: r.date_from, date_to: r.date_to, half: null, file_path: r.file_path, amount: null, credit_by: null }));
    ((hd.data ?? []) as HdRow[]).forEach((r) => rows.push({ kind: 'halfday', id: r.id, staff_email: r.staff_email, status: r.status, ts: r.created_at, review_note: r.review_note, reason: r.reason, informed_supervisor: r.informed_supervisor, date_from: r.date_from, date_to: r.date_to, half: r.half, file_path: null, amount: null, credit_by: null }));
    ((mcq.data ?? []) as McRow[]).forEach((r) => rows.push({ kind: 'mc', id: r.id, staff_email: r.staff_email, status: r.status, ts: r.created_at, review_note: null, reason: r.note, informed_supervisor: null, date_from: r.date_from, date_to: r.date_to, half: null, file_path: r.file_path, amount: null, credit_by: null }));
    ((adv.data ?? []) as AdvRow[]).forEach((r) => rows.push({ kind: 'advance', id: r.id, staff_email: r.staff_email, status: r.status, ts: r.requested_at, review_note: r.review_note, reason: r.reason, informed_supervisor: null, date_from: null, date_to: null, half: null, file_path: null, amount: r.amount, credit_by: r.credit_by }));
    ((em.data ?? []) as EmRow[]).forEach((r) => rows.push({ kind: 'emergency', id: r.id, staff_email: r.staff_email, status: r.status, ts: r.created_at, review_note: null, reason: r.reason, informed_supervisor: r.informed_supervisor, date_from: r.absent_date, date_to: r.absent_date, half: null, file_path: r.file_path, amount: null, credit_by: null }));
    setReqs(rows);
    const m = new Map<string, string>();
    ((s.data ?? []) as Array<{ email: string; name: string | null }>).forEach((x) => m.set(x.email.toLowerCase(), x.name ?? x.email));
    setNames(m);
    const ov = new Set<string>();
    ((bal.data ?? []) as Array<{ email: string; annual_left: number }>).forEach((b) => { if (Number(b.annual_left) <= 0) ov.add(String(b.email).toLowerCase()); });
    setOver(ov);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const staffList = useMemo(() => {
    const m = new Map<string, string>();
    reqs.forEach((r) => m.set(r.staff_email, names.get(r.staff_email.toLowerCase()) ?? r.staff_email));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reqs, names]);

  const filtered = useMemo(() => {
    const statusMatch = (r: Req) => (statusF === 'all' ? true : statusF === 'pending' ? isPending(r) : r.status === statusF);
    return [...reqs]
      .sort((a, b) => (isPending(a) ? 0 : 1) - (isPending(b) ? 0 : 1) || b.ts.localeCompare(a.ts))
      .filter((r) => (kindF === 'ALL' || r.kind === kindF) && (staffF === 'ALL' || r.staff_email === staffF) && statusMatch(r));
  }, [reqs, kindF, staffF, statusF]);

  const pendingCount = useMemo(() => reqs.filter(isPending).length, [reqs]);

  const startEdit = useCallback((r: Req) => { setEditingId(r.id); setEFrom(r.date_from ?? ''); setETo(r.date_to ?? ''); setEReason(r.reason ?? ''); }, []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    if (!eFrom || !eTo) { alert('Pick both dates.'); return; }
    if (eFrom > eTo) { alert('The From date is after the To date.'); return; }
    setSavingEdit(true);
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const res = await fetch('/api/offday/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id: editingId, date_from: eFrom, date_to: eTo, reason: eReason.trim() || null }),
    });
    const j = await res.json().catch(() => ({} as { error?: string }));
    if (!res.ok) alert(j.error || 'Could not save the change.');
    else { setEditingId(null); await load(); }
    setSavingEdit(false);
  }, [editingId, eFrom, eTo, eReason, load]);

  const viewAttachment = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from('mc').createSignedUrl(path, 300);
    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, []);

  // Approve / reject the four request types (each has its own approve_*/reject_* RPC).
  const decide = useCallback(async (r: Req, approve: boolean) => {
    // A note is required (same as the original pages) — MC takes no note at all. The bell can
    // still approve with no note; only this full page prompts for one.
    let note: string | null = null;
    if (r.kind === 'mc') {
      if (!approve && !window.confirm('Reject this MC request?')) return;
    } else {
      const n = window.prompt(approve
        ? 'Note for the staff (required) — e.g. "OK, approved":'
        : 'Reason for rejecting (required):', '');
      if (n === null) return;                        // cancelled
      if (!n.trim()) { alert('A note is required.'); return; }
      note = n.trim();
    }
    // Over-quota off day: ask whether to pay it anyway (goodwill) or leave it unpaid (the law).
    let payAnyway = false;
    if (r.kind === 'offday' && approve && over.has(r.staff_email.toLowerCase())) {
      payAnyway = window.confirm('This staff has no annual leave left.\n\nOK = pay this off day anyway (goodwill).\nCancel = follow the law (unpaid over quota).');
    }
    setBusy(r.id);
    let error: { message: string } | null = null;
    if (r.kind === 'offday') {
      const res = approve
        ? await supabase.rpc('approve_offday', { p_id: r.id, p_note: note, p_pay_anyway: payAnyway })
        : await supabase.rpc('reject_offday', { p_id: r.id, p_note: note });
      error = res.error;
    } else if (r.kind === 'halfday') {
      const res = await supabase.rpc(approve ? 'approve_halfday' : 'reject_halfday', { p_id: r.id, p_note: note });
      error = res.error;
    } else if (r.kind === 'mc') {
      const res = await supabase.rpc(approve ? 'approve_mc' : 'reject_mc', { p_id: r.id });
      error = res.error;
    } else if (r.kind === 'advance') {
      const res = await supabase.rpc(approve ? 'approve_advance' : 'reject_advance', { p_id: r.id, p_note: note });
      error = res.error;
    }
    if (error) alert(error.message); else await load();
    setBusy(null);
  }, [over, load]);

  // Emergency absence: record what the day counts as (optionally set attendance + pay), then mark handled.
  const record = useCallback(async (r: Req, alsoSetDay: boolean) => {
    setBusy(r.id);
    try {
      if (alsoSetDay && r.date_from) {
        const status = picks[r.id] || 'OFFDAY';
        const { error: e1 } = await supabase.rpc('set_day_status', { p_email: r.staff_email, p_day: r.date_from, p_status: status, p_note: r.reason });
        if (e1) throw e1;
        await supabase.rpc('attendance_v2_recompute', { p_from: r.date_from, p_to: r.date_from });
      }
      const { error: e2 } = await supabase.from('emergency_absences')
        .update({ status: 'handled', handled_by: me || null, handled_at: new Date().toISOString() })
        .eq('id', r.id);
      if (e2) throw e2;
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [picks, me, load]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-3">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">{pendingCount} pending</span>
        <select value={kindF} onChange={(e) => setKindF(e.target.value as 'ALL' | Kind)} className="ml-2 rounded-lg border border-line px-2 py-1 text-sm">
          <option value="ALL">All types</option>
          <option value="offday">Off-day</option>
          <option value="halfday">Half-day</option>
          <option value="mc">MC</option>
          <option value="advance">Advance</option>
          <option value="emergency">Emergency</option>
        </select>
        <select value={staffF} onChange={(e) => setStaffF(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm">
          <option value="ALL">All staff</option>
          {staffList.map(([email, name]) => <option key={email} value={email}>{name}</option>)}
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={load} disabled={loading} className="ml-auto rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-ink/[0.03] p-4 text-center text-sm text-ink-3">
          {statusF === 'pending' ? 'No pending requests. Switch the status filter to see past ones.' : 'No requests.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const meta = KIND_META[r.kind];
            const name = names.get(r.staff_email.toLowerCase()) ?? r.staff_email;
            const hasDate = r.kind !== 'advance';
            const pending = isPending(r);
            return (
              <div key={`${r.kind}:${r.id}`} className={`rounded-card p-4 shadow-card ${pending ? 'bg-warn-soft' : 'bg-card'}`}>
                {editingId === r.id ? (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-ink">{name} <span className="text-xs font-normal text-ink-3">— editing request</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-ink-2">From
                        <input type="date" value={eFrom} onChange={(e) => setEFrom(e.target.value)} className="mt-0.5 block w-full rounded-lg border border-line px-2 py-1 text-sm" />
                      </label>
                      <label className="text-xs text-ink-2">To
                        <input type="date" value={eTo} min={eFrom} onChange={(e) => setETo(e.target.value)} className="mt-0.5 block w-full rounded-lg border border-line px-2 py-1 text-sm" />
                      </label>
                    </div>
                    <label className="block text-xs text-ink-2">Reason
                      <input value={eReason} onChange={(e) => setEReason(e.target.value)} className="mt-0.5 block w-full rounded-lg border border-line px-2 py-1 text-sm" />
                    </label>
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={savingEdit} className="rounded-lg bg-good px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{savingEdit ? 'Saving…' : 'Save changes'}</button>
                      <button onClick={cancelEdit} disabled={savingEdit} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">Cancel</button>
                    </div>
                    <p className="text-[11px] text-ink-3">Change the dates if the staff agreed to a different day, then Approve.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">
                          <span className="mr-2 rounded-full bg-accent-weak px-2 py-0.5 text-[11px] font-medium text-accent">{meta.icon} {meta.label}</span>
                          {name}
                          {r.kind === 'offday' && pending && over.has(r.staff_email.toLowerCase()) && <span className="ml-2 rounded-full bg-bad-soft px-2 py-0.5 text-[10px] font-medium text-bad">no AL left</span>}
                          {r.kind === 'halfday' && <span className="ml-2 rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">½ {halfLabel(r.half)}</span>}
                          {r.kind === 'advance' && <span className="ml-2 text-sm font-bold text-ink">{rm(r.amount)}</span>}
                          {hasDate && r.date_from && (
                            <span className="ml-2 text-xs font-normal text-ink-2">
                              {fmtD(r.date_from)}{r.date_to !== r.date_from ? ` – ${fmtD(r.date_to)}` : ''}
                            </span>
                          )}
                        </div>
                        {r.reason && <div className="text-xs text-ink-2">{r.reason}</div>}
                        {r.informed_supervisor && <div className="text-xs text-ink-3">Informed: {r.informed_supervisor}</div>}
                        {r.review_note && <div className="mt-0.5 text-xs text-ink-3">{r.review_note}</div>}
                        {r.kind === 'advance' && r.status === 'approved' && r.credit_by && <div className="mt-0.5 text-xs font-medium text-good">Credit by {fmtD(r.credit_by)}</div>}
                        {r.kind === 'advance' && pending && <div className="mt-0.5 text-[11px] text-ink-3">Approving posts an advance deduction to this month&apos;s payslip (+2 working days).</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        {r.file_path && (
                          <button onClick={() => viewAttachment(r.file_path)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">{r.kind === 'mc' ? 'View certificate' : 'View photo'}</button>
                        )}
                        {r.kind !== 'emergency' && pending && (
                          <>
                            {r.kind === 'offday' && (
                              <button onClick={() => startEdit(r)} disabled={busy === r.id} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">Edit</button>
                            )}
                            <button onClick={() => decide(r, true)} disabled={busy === r.id} className="rounded-lg bg-good px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                              {busy === r.id ? '…' : 'Approve'}
                            </button>
                            <button onClick={() => decide(r, false)} disabled={busy === r.id} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">Reject</button>
                          </>
                        )}
                        {r.kind !== 'emergency' && !pending && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'approved' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
                            {r.status === 'approved' ? 'Approved ✓' : 'Rejected'}
                          </span>
                        )}
                        {r.kind === 'emergency' && !pending && (
                          <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">Handled ✓</span>
                        )}
                      </div>
                    </div>
                    {r.kind === 'emergency' && pending && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                        <span className="text-xs text-ink-3">Record as:</span>
                        <select value={picks[r.id] || 'OFFDAY'} onChange={(e) => setPicks((p) => ({ ...p, [r.id]: e.target.value }))} className="rounded-lg border border-line px-2 py-1 text-sm">
                          {CLASSIFY.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        <button onClick={() => record(r, true)} disabled={busy === r.id} className="rounded-lg bg-good px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy === r.id ? '…' : 'Record & handle'}</button>
                        <button onClick={() => record(r, false)} disabled={busy === r.id} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">Mark handled only</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
