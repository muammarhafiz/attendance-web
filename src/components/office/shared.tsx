'use client';
// Shared bits for the clerk /office area: the clerk_home() data hook + the detail cards, reused by
// the Office home (as summaries) and the per-frequency pages (Daily / Weekly / Monthly).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export type Home = {
  error?: string;
  today: string;
  month: string;
  eom: { done: number; total: number; blockers: number };
  unpaid: { count: number; total: number | string; top: { inv: string; customer: string | null; balance: number | string; status?: string | null; age_days?: number | null }[] };
  yesterday: { day: string; cash_in: number | string; cash_out: number | string; qr_in: number | string; card_in: number | string; transfer_in: number | string } | null;
  daily_to_check: number;
  zero_cogs: { items: number; days: number };
  pi_pending: number;
  po_pending: number;
};

export const rm = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rm0 = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
export const fmtDay = (iso: string) => new Date(String(iso) + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
export const moneyIn = (y: Home['yesterday']) => (y ? Number(y.cash_in || 0) + Number(y.qr_in || 0) + Number(y.card_in || 0) + Number(y.transfer_in || 0) : 0);

// gate (can_access('month_end')) + one-shot clerk_home() load, shared by every /office page
export function useClerkHome() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [d, setD] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('clerk_home');
    setD((data ?? null) as Home);
    setLoading(false);
  }, []);

  useEffect(() => { if (allowed) reload(); }, [allowed, reload]);

  return { allowed, d, loading, reload };
}

export function OfficeShell({ title, back, onRefresh, children }: { title: string; back?: boolean; onRefresh?: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {back && <Link href="/office" className="text-sm text-blue-600 hover:underline">← Office</Link>}
      <div className={`${back ? 'mt-2 ' : ''}mb-4 flex items-baseline justify-between`}>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {onRefresh && <button onClick={onRefresh} className="text-xs text-gray-400 hover:text-gray-700">refresh</button>}
      </div>
      {children}
    </div>
  );
}

export function Gate({ allowed, loading, d, children }: { allowed: boolean | null; loading: boolean; d: Home | null; children: React.ReactNode }) {
  if (allowed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for the office clerk, managers and the owner.</div>;
  if (loading || !d) return <div className="mx-auto max-w-2xl px-4 py-6 text-sm text-gray-400">Loading…</div>;
  return <>{children}</>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-sm"><span className="text-gray-600">{k}</span><span className="font-medium text-gray-800">{v}</span></div>;
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base leading-none">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function YesterdayCard({ y }: { y: Home['yesterday'] }) {
  return (
    <Card title="Yesterday's money — check the bank" icon="🏦">
      {y ? (
        <>
          <div className="mb-1 text-xs text-gray-400">{fmtDay(y.day)}</div>
          <div className="space-y-1 text-sm">
            <Row k="Bank transfer" v={rm(y.transfer_in)} />
            <Row k="QR (DuitNow)" v={rm(y.qr_in)} />
            <Row k="Card" v={rm(y.card_in)} />
            <Row k="Cash in" v={rm(y.cash_in)} />
            <Row k="Cash out" v={rm(y.cash_out)} />
            <div className="mt-1 flex justify-between border-t border-gray-100 pt-1 text-sm font-semibold"><span>Money in</span><span>{rm(moneyIn(y))}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Match transfer / QR / card against what actually landed in the bank.</p>
        </>
      ) : <div className="text-sm text-gray-400">No data for yesterday yet.</div>}
    </Card>
  );
}

export function CashCountCard() {
  return (
    <Link href="/cash-count" className="block">
      <div className="h-full rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-base leading-none">💵</span>
          <h2 className="text-sm font-semibold text-gray-800">Cash count</h2>
          <span className="ml-auto text-xs text-gray-400">Open →</span>
        </div>
        <div className="text-sm text-gray-600">Count &amp; reconcile the cash drawer.</div>
      </div>
    </Link>
  );
}

export function PurchaseOrderCard({ pending }: { pending: number }) {
  return (
    <Link href="/niagawan/inventory-v4" className="block">
      <div className="h-full rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-base leading-none">📦</span>
          <h2 className="text-sm font-semibold text-gray-800">Purchase orders</h2>
          <span className="ml-auto text-xs text-gray-400">Open →</span>
        </div>
        <div className="text-sm text-gray-600">Create the POs (Mon–Tue), WhatsApp the supplier, and submit before Wednesday so the parts arrive in time.</div>
        {pending > 0 && <div className="mt-1 text-xs font-medium text-amber-700">{pending} item{pending === 1 ? '' : 's'} suggested to re-order</div>}
      </div>
    </Link>
  );
}

const ageClass = (n?: number | null) => (n == null ? 'text-gray-400' : n >= 60 ? 'text-rose-600' : n >= 30 ? 'text-amber-600' : 'text-gray-400');

export function UnpaidCard({ unpaid }: { unpaid: Home['unpaid'] }) {
  const nPartial = unpaid.top.filter((u) => u.status === 'partial').length;
  const nUnpaid = unpaid.top.length - nPartial;
  return (
    <Card title="Unpaid & partial bills" icon="📞">
      {unpaid.count > 0 ? (
        <>
          <div className="mb-2 text-sm text-gray-600"><span className="font-semibold text-gray-900">{rm0(unpaid.total)}</span> owed · {nUnpaid} unpaid · {nPartial} partial</div>
          <div className="max-h-80 divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-100">
            {unpaid.top.map((u) => (
              <div key={u.inv} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate text-gray-700">{u.customer || '—'}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-gray-400">{u.inv}</span>
                    <span className={ageClass(u.age_days)}>{u.age_days == null ? '—' : `${u.age_days} day${u.age_days === 1 ? '' : 's'}`}</span>
                    {u.status === 'partial' && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">partial</span>}
                  </div>
                </div>
                <span className="shrink-0 font-medium text-gray-800">{rm(u.balance)}</span>
              </div>
            ))}
          </div>
          {unpaid.count > unpaid.top.length && <div className="mt-1 text-[11px] text-gray-400">Showing first {unpaid.top.length} · {unpaid.count - unpaid.top.length} more</div>}
        </>
      ) : <div className="text-sm text-emerald-700">Nothing unpaid this year ✓</div>}
    </Card>
  );
}

export type ZeroLine = { day: string; inv: string | null; item: string | null; code: string | null; price: number | string };

// After the clerk keys costs into Niagawan, this re-scans just that day's COGS and refreshes the card
// (our data is a snapshot — it won't clear on a plain reload until Niagawan is re-scanned).
function RecheckButton({ day, onDone }: { day: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const recheck = useCallback(async () => {
    setBusy(true);
    setMsg('Re-checking with Niagawan… (~1 min)');
    const { data, error } = await supabase.rpc('request_cogs_sync', { p_day: day });
    const id = (data as { id?: number } | null)?.id;
    if (error || !id) { setBusy(false); setMsg('Could not start — try again.'); return; }
    const started = Date.now();
    const poll = async () => {
      const { data: st } = await supabase.rpc('cogs_sync_status', { p_id: id });
      if (st === 'done' || st === 'error') {
        setBusy(false);
        setMsg(st === 'done' ? 'Updated ✓' : 'Re-check failed — try again.');
        if (st === 'done' && onDone) onDone();
        return;
      }
      if (Date.now() - started > 150000) { setBusy(false); setMsg('Still running — tap Re-check again shortly.'); return; }
      setTimeout(poll, 4000);
    };
    setTimeout(poll, 4000);
  }, [day, onDone]);

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-2">
      <button onClick={recheck} disabled={busy}
        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
        {busy ? 'Re-checking…' : '↻ Re-check with Niagawan'}
      </button>
      {msg && <span className={`text-[11px] ${msg.startsWith('Updated') ? 'text-emerald-700' : 'text-gray-500'}`}>{msg}</span>}
    </div>
  );
}

export function ZeroCogsCard({ zero_cogs, lines, day, onRecheck }: { zero_cogs: Home['zero_cogs']; lines?: ZeroLine[]; day?: string; onRecheck?: () => void }) {
  const list = lines ?? [];
  return (
    <Card title="Parts with no cost" icon="🏷️">
      {zero_cogs.items > 0 ? (
        <>
          <div className="text-sm text-gray-600"><span className="font-semibold text-amber-700">{zero_cogs.items} part{zero_cogs.items === 1 ? '' : 's'}</span> sold this day {zero_cogs.items === 1 ? 'has' : 'have'} no cost keyed.</div>
          {list.length > 0 && (
            <div className="mt-2 max-h-72 divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-100">
              {list.map((r, i) => (
                <div key={`${r.inv || ''}-${i}`} className="flex items-start justify-between gap-2 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-semibold text-gray-800">{r.inv || '—'}</div>
                    <div className="truncate text-gray-600">{r.item || '—'}{r.code ? ` · ${r.code}` : ''}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-medium text-gray-800">{rm(r.price)}</div>
                    <div className="text-[10px] text-gray-400">{fmtDay(r.day)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {list.length > 0 && zero_cogs.items > list.length && <div className="mt-1 text-[11px] text-gray-400">Showing first {list.length} · {zero_cogs.items - list.length} more</div>}
          <p className="mt-2 text-[11px] text-gray-400">Key the cost in Niagawan against each invoice above, then tap Re-check. The <Link href="/month-end" className="text-blue-600 underline">End of month</Link> page shows the whole month.</p>
        </>
      ) : <div className="text-sm text-emerald-700">All parts have a cost ✓</div>}
      {day && <RecheckButton day={day} onDone={onRecheck} />}
    </Card>
  );
}
