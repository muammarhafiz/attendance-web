'use client';
// Staff inbox for customer tyre requests submitted on the public page. New → contacted → closed.
// Staff WhatsApp the customer to confirm stock and finalize. Gated tyre OR workshop.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Enq = {
  id: number; created_at: string; customer_name: string; customer_phone: string; car_plate: string | null;
  brand: string | null; pattern: string | null; size: string | null; qty: number; vehicle: string;
  unit_retail: number | null; quote_total: number | null; status: string; handled_by: string | null; note: string | null;
};

const rm = (n: number | null) => `RM${Math.round(Number(n || 0)).toLocaleString('en-MY')}`;
const label = (e: Enq) => [e.brand, e.pattern].filter(Boolean).join(' ') || 'Tyre';
const fmtDT = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); };
const waNumber = (raw: string | null): string | null => {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (!d.startsWith('60')) d = '60' + d.replace(/^0/, '');
  return d.length >= 10 && d.length <= 15 ? d : null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-warn-soft text-warn' },
  contacted: { label: 'Contacted', cls: 'bg-accent-weak text-accent' },
  closed: { label: 'Closed', cls: 'bg-ink/5 text-ink-3' },
};

export default function TyreEnquiriesPage() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Enq[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusF, setStatusF] = useState<'open' | 'all' | 'closed'>('open');
  const [busy, setBusy] = useState<number | null>(null);
  const [newCount, setNewCount] = useState(0); // authoritative count of NEW enquiries (independent of the filter)

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: nc }] = await Promise.all([
      supabase.rpc('tyre_enquiry_list', { p_status: statusF }),
      supabase.rpc('tyre_enquiry_new_count'),
    ]);
    setRows((data ?? []) as Enq[]);
    setNewCount(Number(nc) || 0);
    setLoading(false);
  }, [statusF]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setOk(false); return; }
      const { data } = await supabase.rpc('my_access');
      const a = (data ?? {}) as Record<string, boolean>;
      setOk(!!a.tyre || !!a.workshop);
    })();
  }, []);
  useEffect(() => { if (ok) load(); }, [ok, load]);

  const setStatus = useCallback(async (e: Enq, status: string) => {
    setBusy(e.id);
    const { error } = await supabase.rpc('tyre_enquiry_set_status', { p_id: e.id, p_status: status });
    setBusy(null);
    if (!error) await load();
  }, [load]);

  if (ok === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!ok) return <div className="p-6 text-sm text-ink-2">You don&apos;t have access to tyre enquiries.</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Tyre enquiries</h1>
        {newCount > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">{newCount} new</span>}
        <select value={statusF} onChange={(e) => setStatusF(e.target.value as 'open' | 'all' | 'closed')} className="ml-auto rounded-lg border border-line bg-card px-2 py-1 text-sm">
          <option value="open">Open (new + contacted)</option>
          <option value="all">All</option>
          <option value="closed">Closed</option>
        </select>
        <button onClick={load} disabled={loading} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-line bg-card px-3 py-10 text-center text-sm text-ink-3">No tyre requests here yet. Share the customer page and they&apos;ll land here.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((e) => {
            const num = waNumber(e.customer_phone);
            const waText = encodeURIComponent(`Hi ${e.customer_name}, thanks for your tyre enquiry at ZORDAQ Auto Services — ${label(e)} ${e.size} (${e.qty === 4 ? 'set of 4' : e.qty + ' pcs'}), all-in ${rm(e.quote_total)}. We'll confirm stock and arrange fitting. 🙏`);
            const st = STATUS[e.status] ?? STATUS.new;
            return (
              <div key={e.id} className={`rounded-card p-4 shadow-card ${e.status === 'new' ? 'bg-warn-soft' : 'bg-card'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {e.customer_name}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-ink-2">
                      {label(e)} · <span className="font-mono">{e.size}</span> · {e.qty === 4 ? 'Set of 4' : `${e.qty} pc${e.qty > 1 ? 's' : ''}`} · {e.vehicle === 'suv' ? 'SUV' : 'Sedan'}
                      <span className="ml-2 font-semibold text-ink">{rm(e.quote_total)} all-in</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {e.customer_phone}{e.car_plate ? ` · ${e.car_plate}` : ''} · {fmtDT(e.created_at)}
                      {e.handled_by ? ` · by ${e.handled_by}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {num && <a href={`https://wa.me/${num}?text=${waText}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#25D366] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">📲 WhatsApp</a>}
                    {e.status === 'new' && <button onClick={() => setStatus(e, 'contacted')} disabled={busy === e.id} className="rounded-lg border border-accent/40 bg-accent-weak px-2.5 py-1 text-xs font-semibold text-accent hover:opacity-90 disabled:opacity-50">Mark contacted</button>}
                    {e.status !== 'closed' && <button onClick={() => setStatus(e, 'closed')} disabled={busy === e.id} className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Close</button>}
                    {e.status === 'closed' && <button onClick={() => setStatus(e, 'new')} disabled={busy === e.id} className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Reopen</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
