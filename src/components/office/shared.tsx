'use client';
// Shared bits for the clerk /office area: the clerk_home() data hook + the detail cards, reused by
// the Office home (as summaries) and the per-frequency pages (Daily / Weekly / Monthly).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { Icon, type IconName } from '@/components/icons';

export type Home = {
  error?: string;
  today: string;
  month: string;
  eom: { done: number; total: number; blockers: number; suppliers_owed: number; absents: number; bills_total: number; bills_unpaid: number; ticks: Record<string, boolean> };
  unpaid: { count: number; total: number | string; top: { inv: string; customer: string | null; balance: number | string; status?: string | null; age_days?: number | null }[] };
  yesterday: { day: string; cash_in: number | string; cash_out: number | string; qr_in: number | string; card_in: number | string; transfer_in: number | string } | null;
  daily_to_check: number;
  daily_methods: Record<string, { total: number; checked: number; label?: string | null }>;
  daily_cash: { system: number | string; counted: number | string | null };
  zero_cogs: { items: number; days: number };
  pi_pending: number;
  po_pending: number;
  po_list: PoSuggestion[];
  po_on_order: OnOrderPo[];
  watchlist: WatchItem[];
};

export type PoSuggestion = { id: number; supplier: string; n_items: number };
export type OnOrderPo = { id: number; supplier: string; days: number; items: { qty: string; desc: string }[] };
export type WatchItem = { supplier: string; code: string; item: string | null; qty: number | string; sold_on: string | null };

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

export function OfficeShell({ title, back, backHref = '/office', backLabel = '← Office', onRefresh, children }: { title: string; back?: boolean; backHref?: string; backLabel?: string; onRefresh?: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {back && <Link href={backHref} className="text-sm text-accent hover:underline">{backLabel}</Link>}
      <div className={`${back ? 'mt-2 ' : ''}mb-4 flex items-baseline justify-between`}>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {onRefresh && <button onClick={onRefresh} className="text-xs text-ink-3 hover:text-ink-2">refresh</button>}
      </div>
      {children}
    </div>
  );
}

export function Gate({ allowed, loading, d, children }: { allowed: boolean | null; loading: boolean; d: Home | null; children: React.ReactNode }) {
  if (allowed === null) return <div className="p-6 text-sm text-ink-2">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for the office clerk, managers and the owner.</div>;
  if (loading || !d) return <div className="mx-auto max-w-2xl px-4 py-6 text-sm text-ink-3">Loading…</div>;
  return <>{children}</>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-sm"><span className="text-ink-2">{k}</span><span className="font-medium text-ink-2">{v}</span></div>;
}

function Card({ title, icon, children }: { title: string; icon: IconName; children: React.ReactNode }) {
  return (
    <div className="rounded-card bg-card shadow-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ink-2"><Icon name={icon} size={16} /></span>
        <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function YesterdayCard({ y }: { y: Home['yesterday'] }) {
  return (
    <Card title="Yesterday's money — check the bank" icon="wallet">
      {y ? (
        <>
          <div className="mb-1 text-xs text-ink-3">{fmtDay(y.day)}</div>
          <div className="space-y-1 text-sm">
            <Row k="Bank transfer" v={rm(y.transfer_in)} />
            <Row k="QR (DuitNow)" v={rm(y.qr_in)} />
            <Row k="Card" v={rm(y.card_in)} />
            <Row k="Cash in" v={rm(y.cash_in)} />
            <Row k="Cash out" v={rm(y.cash_out)} />
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-sm font-semibold"><span>Money in</span><span>{rm(moneyIn(y))}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Match transfer / QR / card against what actually landed in the bank.</p>
        </>
      ) : <div className="text-sm text-ink-3">No data for yesterday yet.</div>}
    </Card>
  );
}

export function CashCountCard() {
  return (
    <Link href="/cash-count" className="block">
      <div className="h-full rounded-card bg-card shadow-card p-4 transition hover:-translate-y-px">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-ink-2"><Icon name="wallet" size={16} /></span>
          <h2 className="text-sm font-semibold text-ink-2">Cash count</h2>
          <span className="ml-auto text-xs text-ink-3">Open →</span>
        </div>
        <div className="text-sm text-ink-2">Count &amp; reconcile the cash drawer.</div>
      </div>
    </Link>
  );
}

export function PurchaseOrderCard({ list }: { list: PoSuggestion[] }) {
  return (
    <Link href="/niagawan/inventory-v4" className="block">
      <div className="h-full rounded-card bg-card shadow-card p-4 transition hover:-translate-y-px">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-ink-2"><Icon name="box" size={16} /></span>
          <h2 className="text-sm font-semibold text-ink-2">Purchase orders</h2>
          <span className="ml-auto text-xs text-ink-3">Open →</span>
        </div>
        <div className="text-sm text-ink-2">Create the POs (Mon–Tue), WhatsApp the supplier, and submit before Wednesday so the parts arrive in time.</div>
        {list.length > 0 ? (
          <div className="mt-2 rounded-lg border border-amber-100 bg-warn-soft p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-warn">{list.length} purchase order{list.length === 1 ? '' : 's'} ready to send</div>
            <ul className="space-y-0.5">
              {list.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-2">{p.supplier}</span>
                  <span className="shrink-0 font-medium text-ink-2">{p.n_items} item{p.n_items === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-ink-3">Open to review the items, then WhatsApp / submit each PO.</p>
          </div>
        ) : <div className="mt-1 text-xs text-good">No purchase orders waiting ✓</div>}
      </div>
    </Link>
  );
}

// POs already sent to the supplier, waiting to be delivered — shows the items + how long they've waited.
export function WaitingDeliveryCard({ list }: { list: OnOrderPo[] }) {
  return (
    <Card title="Waiting for delivery" icon="truck">
      {list.length === 0 ? (
        <div className="text-sm text-ink-3">Nothing on order right now.</div>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-ink-3">POs already sent to the supplier — chase them if the parts are taking too long.</p>
          <div className="space-y-2">
            {list.map((p) => {
              const dayTone = p.days >= 7 ? 'text-bad' : p.days >= 3 ? 'text-warn' : 'text-ink-3';
              return (
                <div key={p.id} className="rounded-lg border border-line p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink-2">{p.supplier}</span>
                    <span className={`shrink-0 text-[11px] font-medium ${dayTone}`}>ordered {p.days} day{p.days === 1 ? '' : 's'} ago</span>
                  </div>
                  <ul className="mt-1 divide-y divide-line">
                    {p.items.map((it, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                        <span className="truncate text-ink-2">{it.desc || '(item)'}</span>
                        <span className="shrink-0 text-ink-3">×{it.qty}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

// Watchlist tracker: inventory group-card ("watchlist") items that have SOLD and aren't on a PO yet.
// A daily-refreshed reorder nudge — creating a PO for an item clears it; it returns if it sells again.
export function WatchlistCard({ list }: { list: WatchItem[] }) {
  // Group into supplier sections, preserving the RPC order (already supplier-sorted, newest-sold first).
  const groups: { supplier: string; items: WatchItem[] }[] = [];
  for (const w of list) {
    const last = groups[groups.length - 1];
    if (last && last.supplier === w.supplier) last.items.push(w);
    else groups.push({ supplier: w.supplier, items: [w] });
  }
  return (
    <Card title="Watchlist — sold" icon="eye">
      {list.length === 0 ? (
        <div className="text-sm text-good">Nothing on the watchlist has sold since it was last ordered ✓</div>
      ) : (
        <>
          <div className="mb-2 text-sm text-ink-2"><span className="font-semibold text-ink">{list.length}</span> watchlist item{list.length === 1 ? '' : 's'} sold across {groups.length} supplier{groups.length === 1 ? '' : 's'} — not on a PO yet.</div>
          <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-line p-1">
            {groups.map((g) => (
              <div key={g.supplier}>
                <div className="sticky top-0 z-10 flex items-center gap-2 rounded bg-ink/5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                  <span className="truncate">{g.supplier}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-card px-1.5 text-[10px] font-medium text-ink-2">{g.items.length}</span>
                </div>
                <div className="divide-y divide-line">
                  {g.items.map((w, i) => (
                    <div key={`${w.code}-${i}`} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="truncate text-ink-2">{w.item || w.code}</div>
                        <div className="truncate font-mono text-[11px] text-ink-3">{w.code}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold text-ink-2">sold {Number(w.qty)}</div>
                        <div className="text-[10px] text-ink-3">{w.sold_on ? fmtDay(w.sold_on) : '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Watchlist items that sold (last 30 days) and aren&apos;t on a PO yet, grouped by supplier — refreshed nightly (~8pm). Create a <Link href="/niagawan/inventory-v4" className="text-accent underline">purchase order</Link> for an item and it clears from here; it returns if it sells again.</p>
        </>
      )}
    </Card>
  );
}

const ageClass = (n?: number | null) => (n == null ? 'text-ink-3' : n >= 60 ? 'text-bad' : n >= 30 ? 'text-warn' : 'text-ink-3');

export function UnpaidCard({ unpaid }: { unpaid: Home['unpaid'] }) {
  const nPartial = unpaid.top.filter((u) => u.status === 'partial').length;
  const nUnpaid = unpaid.top.length - nPartial;
  return (
    <Card title="Unpaid & partial bills" icon="phone">
      {unpaid.count > 0 ? (
        <>
          <div className="mb-2 text-sm text-ink-2"><span className="font-semibold text-ink">{rm0(unpaid.total)}</span> owed · {nUnpaid} unpaid · {nPartial} partial</div>
          <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {unpaid.top.map((u) => (
              <div key={u.inv} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate text-ink-2">{u.customer || '—'}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-ink-3">{u.inv}</span>
                    <span className={ageClass(u.age_days)}>{u.age_days == null ? '—' : `${u.age_days} day${u.age_days === 1 ? '' : 's'}`}</span>
                    {u.status === 'partial' && <span className="rounded bg-warn-soft px-1 py-0.5 text-[10px] font-medium text-warn">partial</span>}
                  </div>
                </div>
                <span className="shrink-0 font-medium text-ink-2">{rm(u.balance)}</span>
              </div>
            ))}
          </div>
          {unpaid.count > unpaid.top.length && <div className="mt-1 text-[11px] text-ink-3">Showing first {unpaid.top.length} · {unpaid.count - unpaid.top.length} more</div>}
        </>
      ) : <div className="text-sm text-good">Nothing unpaid this year ✓</div>}
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
    <div className="mt-3 flex items-center gap-2 border-t border-line pt-2">
      <button onClick={recheck} disabled={busy}
        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 transition hover:bg-ink/5 disabled:opacity-50">
        {busy ? 'Re-checking…' : '↻ Re-check with Niagawan'}
      </button>
      {msg && <span className={`text-[11px] ${msg.startsWith('Updated') ? 'text-good' : 'text-ink-2'}`}>{msg}</span>}
    </div>
  );
}

export function ZeroCogsCard({ zero_cogs, lines, day, onRecheck }: { zero_cogs: Home['zero_cogs']; lines?: ZeroLine[]; day?: string; onRecheck?: () => void }) {
  const list = lines ?? [];
  return (
    <Card title="Parts with no cost" icon="tag">
      {zero_cogs.items > 0 ? (
        <>
          <div className="text-sm text-ink-2"><span className="font-semibold text-warn">{zero_cogs.items} part{zero_cogs.items === 1 ? '' : 's'}</span> sold this day {zero_cogs.items === 1 ? 'has' : 'have'} no cost keyed.</div>
          {list.length > 0 && (
            <div className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {list.map((r, i) => (
                <div key={`${r.inv || ''}-${i}`} className="flex items-start justify-between gap-2 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-semibold text-ink-2">{r.inv || '—'}</div>
                    <div className="truncate text-ink-2">{r.item || '—'}{r.code ? ` · ${r.code}` : ''}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-medium text-ink-2">{rm(r.price)}</div>
                    <div className="text-[10px] text-ink-3">{fmtDay(r.day)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {list.length > 0 && zero_cogs.items > list.length && <div className="mt-1 text-[11px] text-ink-3">Showing first {list.length} · {zero_cogs.items - list.length} more</div>}
          <p className="mt-2 text-[11px] text-ink-3">Key the cost in Niagawan against each invoice above, then tap Re-check. The <Link href="/month-end" className="text-accent underline">End of month</Link> page shows the whole month.</p>
        </>
      ) : <div className="text-sm text-good">All parts have a cost ✓</div>}
      {day && <RecheckButton day={day} onDone={onRecheck} />}
    </Card>
  );
}
