'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type McReq = {
  id: string;
  staff_email: string;
  date_from: string;
  date_to: string;
  file_path: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  created_at: string;
  reviewed_by: string | null;
};

const fmtD = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

export default function McReviewPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [reqs, setReqs] = useState<McReq[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [staffF, setStaffF] = useState('ALL');
  const [statusF, setStatusF] = useState('all');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('mc_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('staff').select('email,name'),
    ]);
    setReqs((r ?? []) as McReq[]);
    const m = new Map<string, string>();
    (s ?? []).forEach((x: { email: string; name: string | null }) => m.set(x.email.toLowerCase(), x.name ?? x.email));
    setNames(m);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const sorted = useMemo(() => {
    const rank = (s: string) => (s === 'pending' ? 0 : 1);
    return [...reqs].sort((a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at));
  }, [reqs]);

  const staffList = useMemo(() => {
    const m = new Map<string, string>();
    reqs.forEach((r) => m.set(r.staff_email, names.get(r.staff_email.toLowerCase()) ?? r.staff_email));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reqs, names]);

  const filtered = useMemo(
    () => sorted.filter((r) => (staffF === 'ALL' || r.staff_email === staffF) && (statusF === 'all' || r.status === statusF)),
    [sorted, staffF, statusF]
  );

  const viewCert = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from('mc').createSignedUrl(path, 300);
    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, []);

  const decide = useCallback(async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await supabase.rpc(approve ? 'approve_mc' : 'reject_mc', { p_id: id });
    if (!error) await load();
    setBusy(null);
  }, [load]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  const pendingCount = reqs.filter((r) => r.status === 'pending').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">{pendingCount} pending</span>
        <select value={staffF} onChange={(e) => setStaffF(e.target.value)} className="ml-2 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="ALL">All staff</option>
          {staffList.map(([email, name]) => <option key={email} value={email}>{name}</option>)}
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={load} disabled={loading} className="ml-auto rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">No MC submissions match.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className={`rounded-lg border p-3 ${r.status === 'pending' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {names.get(r.staff_email.toLowerCase()) ?? r.staff_email}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {fmtD(r.date_from)}{r.date_to !== r.date_from ? ` – ${fmtD(r.date_to)}` : ''}
                    </span>
                  </div>
                  {r.note && <div className="text-xs text-gray-500">{r.note}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {r.file_path && (
                    <button onClick={() => viewCert(r.file_path)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">View certificate</button>
                  )}
                  {r.status === 'pending' ? (
                    <>
                      <button onClick={() => decide(r.id, true)} disabled={busy === r.id} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        {busy === r.id ? '…' : 'Approve'}
                      </button>
                      <button onClick={() => decide(r.id, false)} disabled={busy === r.id} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50">Reject</button>
                    </>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {r.status === 'approved' ? 'Approved ✓' : 'Rejected'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
