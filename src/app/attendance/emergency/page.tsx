'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Em = {
  id: string;
  staff_email: string;
  absent_date: string;
  reason: string;
  informed_supervisor: string | null;
  file_path: string | null;
  status: string;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
};

const fmtD = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

// Full-day outcomes the office can record for an emergency day (sets attendance + pay via set_day_status).
const CLASSIFY = [
  { value: 'OFFDAY', label: 'Off day (paid leave)' },
  { value: 'MC', label: 'MC (paid sick)' },
  { value: 'ABSENT', label: 'Absent (unpaid)' },
  { value: 'PH', label: 'Public holiday' },
];

export default function EmergencyAbsencesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [me, setMe] = useState<string>('');
  const [rows, setRows] = useState<Em[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusF, setStatusF] = useState('new');
  const [picks, setPicks] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      setMe(data.session?.user?.email ?? '');
      if (data.session) { const { data: ok } = await supabase.rpc('can_access', { p_feature: 'attendance' }); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('emergency_absences').select('*').order('created_at', { ascending: false }),
      supabase.from('staff').select('email,name'),
    ]);
    setRows((r ?? []) as Em[]);
    const m = new Map<string, string>();
    (s ?? []).forEach((x: { email: string; name: string | null }) => m.set(x.email.toLowerCase(), x.name ?? x.email));
    setNames(m);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const filtered = useMemo(() => {
    const rank = (s: string) => (s === 'new' ? 0 : 1);
    return [...rows]
      .sort((a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at))
      .filter((r) => statusF === 'all' || r.status === statusF);
  }, [rows, statusF]);

  const viewAttachment = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from('mc').createSignedUrl(path, 300);
    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, []);

  const record = useCallback(async (r: Em, alsoSetDay: boolean) => {
    setBusy(r.id);
    try {
      if (alsoSetDay) {
        const status = picks[r.id] || 'OFFDAY';
        const { error: e1 } = await supabase.rpc('set_day_status', { p_email: r.staff_email, p_day: r.absent_date, p_status: status, p_note: r.reason });
        if (e1) throw e1;
        await supabase.rpc('attendance_v2_recompute', { p_from: r.absent_date, p_to: r.absent_date });
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

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-2">Checking…</div>;
  if (!authed) return <div className="text-sm text-ink-2">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  const newCount = rows.filter((r) => r.status === 'new').length;

  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">Last-minute / emergency absences staff reported. Record the day (it sets attendance &amp; pay), then it&rsquo;s marked handled.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">{newCount} new</span>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-sm">
          <option value="new">New</option>
          <option value="handled">Handled</option>
          <option value="all">All</option>
        </select>
        <button onClick={load} disabled={loading} className="ml-auto rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-line bg-ink/[0.03] p-6 text-center text-sm text-ink-2">No emergency absences.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className={`rounded-card p-3 shadow-card ${r.status === 'new' ? 'bg-warn-soft' : 'bg-card'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {names.get(r.staff_email.toLowerCase()) ?? r.staff_email}
                    <span className="ml-2 text-xs font-normal text-ink-2">{fmtD(r.absent_date)}</span>
                  </div>
                  <div className="text-xs text-ink-2">{r.reason}</div>
                  {r.informed_supervisor && <div className="text-xs text-ink-3">Informed: {r.informed_supervisor}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {r.file_path && (
                    <button onClick={() => viewAttachment(r.file_path)} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5">View photo</button>
                  )}
                  {r.status !== 'new' && <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">Handled ✓</span>}
                </div>
              </div>
              {r.status === 'new' && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <span className="text-xs text-ink-3">Record as:</span>
                  <select value={picks[r.id] || 'OFFDAY'} onChange={(e) => setPicks((p) => ({ ...p, [r.id]: e.target.value }))} className="rounded-md border border-line px-2 py-1 text-sm">
                    {CLASSIFY.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <button onClick={() => record(r, true)} disabled={busy === r.id} className="rounded-md bg-good px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">{busy === r.id ? '…' : 'Record & handle'}</button>
                  <button onClick={() => record(r, false)} disabled={busy === r.id} className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Mark handled only</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
