'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Req = {
  id: string;
  staff_email: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  review_note: string | null;
  created_at: string;
  file_path: string | null;
  informed_supervisor: string | null;
};

const fmtD = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

export default function OffdayRequestsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [staffF, setStaffF] = useState('ALL');
  const [statusF, setStatusF] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eFrom, setEFrom] = useState('');
  const [eTo, setETo] = useState('');
  const [eReason, setEReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [over, setOver] = useState<Set<string>>(new Set()); // staff with no annual leave left this year

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: ok } = await supabase.rpc('can_access', { p_feature: 'attendance' }); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const yr = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();
    const [{ data: r }, { data: s }, { data: bal }] = await Promise.all([
      supabase.from('offday_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('staff').select('email,name'),
      supabase.rpc('leave_balances', { p_year: yr }),
    ]);
    setReqs((r ?? []) as Req[]);
    const m = new Map<string, string>();
    (s ?? []).forEach((x: { email: string; name: string | null }) => m.set(x.email.toLowerCase(), x.name ?? x.email));
    setNames(m);
    const ov = new Set<string>();
    ((bal ?? []) as Array<{ email: string; annual_left: number }>).forEach((b) => { if (Number(b.annual_left) <= 0) ov.add(String(b.email).toLowerCase()); });
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
    const rank = (s: string) => (s === 'pending' ? 0 : 1);
    return [...reqs]
      .sort((a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at))
      .filter((r) => (staffF === 'ALL' || r.staff_email === staffF) && (statusF === 'all' || r.status === statusF));
  }, [reqs, staffF, statusF]);

  const startEdit = useCallback((r: Req) => {
    setEditingId(r.id); setEFrom(r.date_from); setETo(r.date_to); setEReason(r.reason ?? '');
  }, []);
  const cancelEdit = useCallback(() => { setEditingId(null); }, []);
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

  const decide = useCallback(async (id: string, approve: boolean) => {
    const note = window.prompt(approve
      ? 'Note for the staff (required) — e.g. "OK, approved":'
      : 'Reason for rejecting (required) — e.g. "2 staff already off that date":');
    if (note === null) return;                       // cancelled
    if (!note.trim()) { alert('A reason is required.'); return; }
    let payAnyway = false;
    if (approve) {
      const req = reqs.find((x) => x.id === id);
      if (req && over.has(req.staff_email.toLowerCase())) {
        payAnyway = window.confirm('This staff has no annual leave left.\n\nOK = pay this off day anyway (goodwill).\nCancel = follow the law (unpaid over quota).');
      }
    }
    setBusy(id);
    const { error } = await supabase.rpc(approve ? 'approve_offday' : 'reject_offday',
      approve ? { p_id: id, p_note: note.trim(), p_pay_anyway: payAnyway } : { p_id: id, p_note: note.trim() });
    if (error) alert(error.message); else await load();
    setBusy(null);
  }, [load, reqs, over]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-2">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  const pending = reqs.filter((r) => r.status === 'pending').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">{pending} pending</span>
        <select value={staffF} onChange={(e) => setStaffF(e.target.value)} className="ml-2 rounded-md border border-line px-2 py-1.5 text-sm">
          <option value="ALL">All staff</option>
          {staffList.map(([email, name]) => <option key={email} value={email}>{name}</option>)}
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={load} disabled={loading} className="ml-auto rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-line bg-ink/[0.03] p-6 text-center text-sm text-ink-2">No off-day requests.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className={`rounded-card p-3 shadow-card ${r.status === 'pending' ? 'bg-warn-soft' : 'bg-card'}`}>
              {editingId === r.id ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-ink">{names.get(r.staff_email.toLowerCase()) ?? r.staff_email} <span className="text-xs font-normal text-ink-3">— editing request</span></div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-ink-2">From
                      <input type="date" value={eFrom} onChange={(e) => setEFrom(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                    </label>
                    <label className="text-xs text-ink-2">To
                      <input type="date" value={eTo} min={eFrom} onChange={(e) => setETo(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                    </label>
                  </div>
                  <label className="block text-xs text-ink-2">Reason
                    <input value={eReason} onChange={(e) => setEReason(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  </label>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} disabled={savingEdit} className="rounded-md bg-good px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{savingEdit ? 'Saving…' : 'Save changes'}</button>
                    <button onClick={cancelEdit} disabled={savingEdit} className="rounded-md border border-line px-3 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Cancel</button>
                  </div>
                  <p className="text-[11px] text-ink-3">Change the dates if the staff agreed to a different day, then Approve.</p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      {names.get(r.staff_email.toLowerCase()) ?? r.staff_email}
                      {r.status === 'pending' && over.has(r.staff_email.toLowerCase()) && <span className="ml-2 rounded-full bg-bad-soft px-2 py-0.5 text-[10px] font-medium text-bad">no AL left</span>}
                      <span className="ml-2 text-xs font-normal text-ink-2">
                        {fmtD(r.date_from)}{r.date_to !== r.date_from ? ` – ${fmtD(r.date_to)}` : ''}
                      </span>
                    </div>
                    {r.reason && <div className="text-xs text-ink-2">{r.reason}</div>}
                    {r.informed_supervisor && <div className="text-xs text-ink-3">Informed: {r.informed_supervisor}</div>}
                    {r.review_note && <div className="mt-0.5 text-xs text-ink-3">{r.review_note}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.file_path && (
                      <button onClick={() => viewAttachment(r.file_path)} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5">View photo</button>
                    )}
                    {r.status === 'pending' ? (
                      <>
                        <button onClick={() => startEdit(r)} disabled={busy === r.id} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Edit</button>
                        <button onClick={() => decide(r.id, true)} disabled={busy === r.id} className="rounded-md bg-good px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                          {busy === r.id ? '…' : 'Approve'}
                        </button>
                        <button onClick={() => decide(r.id, false)} disabled={busy === r.id} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Reject</button>
                      </>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'approved' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
                        {r.status === 'approved' ? 'Approved ✓' : 'Rejected'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
