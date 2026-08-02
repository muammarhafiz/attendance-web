'use client';
// Office → BNPL: hub. Lists each BNPL service (opens its own tracker) + one card showing ALL BNPL
// sales across every service. Per-service sales live on each service's page.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, rm, fmtDay } from '@/components/office/shared';
import { Icon } from '@/components/icons';

type HubItem = {
  slug: string; display_name: string;
  mdr_pct: number; flat_fee: number; sst_pct: number;
  outstanding_count: number; outstanding_net: number | string; to_confirm: number;
};
type Sale = { day: string; method: string; invoice_no: string | null; vehicle: string | null; gross: number | string; est_fee: number | string; est_net: number | string; status: string | null };
type Overview = {
  providers: { provider: string; display_name: string }[];
  sales: Sale[];
  sales_total: { count: number; gross: number | string; est_net: number | string };
};

const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const klDaysAgo = (n: number) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

export default function BnplHubPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<HubItem[] | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [from, setFrom] = useState(klDaysAgo(90));
  const [to, setTo] = useState(klToday());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    const [hub, overview] = await Promise.all([
      supabase.rpc('bnpl_hub'),
      supabase.rpc('bnpl_overview', { p_from: from, p_to: to, p_provider: null }),
    ]);
    setItems((hub.data ?? []) as HubItem[]);
    setOv((overview.data ?? null) as Overview);
  }, [from, to]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (allowed === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for the office clerk, managers and the owner.</div>;

  const nameOf = (slug: string) => ov?.providers?.find((p) => p.provider === slug)?.display_name || slug.toUpperCase();

  return (
    <OfficeShell title="BNPL payments" back onRefresh={load}>
      <p className="mb-4 text-sm text-ink-2">
        Buy-Now-Pay-Later services. Each pays you a few days after the sale, minus a fee — open a service to
        see its payouts to tick against the bank. Every BNPL sale, across all services, is listed below.
      </p>

      {items === null ? (
        <div className="py-6 text-center text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="space-y-4">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">No BNPL services set up yet.</div>
          ) : (
            <div className="space-y-3">
              {items.map((it) => (
                <Link key={it.slug} href={`/office/bnpl/${it.slug}`} className="block">
                  <div className="rounded-card bg-card shadow-card p-5 transition hover:-translate-y-px">
                    <div className="flex items-center gap-2">
                      <span className="text-ink-2"><Icon name="wallet" size={20} /></span>
                      <h2 className="text-lg font-semibold text-ink">{it.display_name}</h2>
                      {it.to_confirm > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">{it.to_confirm} to confirm</span>}
                      <span className="ml-auto text-2xl text-ink-3">›</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[12px] text-ink-2">Awaiting payout</div>
                        <div className="text-base font-semibold text-ink">{rm(it.outstanding_net)}</div>
                        <div className="text-[11px] text-ink-3">{it.outstanding_count} sale{it.outstanding_count === 1 ? '' : 's'} owed to you</div>
                      </div>
                      <div>
                        <div className="text-[12px] text-ink-2">Payouts to confirm</div>
                        <div className={`text-base font-semibold ${it.to_confirm > 0 ? 'text-warn' : 'text-good'}`}>{it.to_confirm}</div>
                        <div className="text-[11px] text-ink-3">deposits to tick vs bank</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] text-ink-3">Fee: {it.mdr_pct}% + RM{it.flat_fee} (+{it.sst_pct}% SST)</div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* All BNPL sales, across every service */}
          <div className="rounded-card bg-card shadow-card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-ink">BNPL sales — all services</div>
              {ov?.sales_total && <div className="text-[12px] text-ink-3">{ov.sales_total.count} sale{ov.sales_total.count === 1 ? '' : 's'} · {rm(ov.sales_total.gross)} gross</div>}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-ink-2">Showing</span>
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-xs" />
              <span className="text-ink-3">to</span>
              <input type="date" value={to} max={klToday()} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-xs" />
            </div>
            {!ov || ov.sales.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">No BNPL sales in this period.</div>
            ) : (
              <div className="divide-y divide-line">
                {ov.sales.map((s, i) => (
                  <div key={`${s.method}-${s.invoice_no ?? 'x'}-${i}`} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded-full bg-accent-weak px-1.5 py-0.5 text-[10px] font-medium text-accent">{nameOf(s.method)}</span>
                        <span className="truncate text-sm text-ink-2">{s.vehicle || '—'}</span>
                        <StatusPill status={s.status} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                        <span className="font-mono">{s.invoice_no || '—'}</span>
                        <span>·</span>
                        <span>{fmtDay(s.day)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-ink">{rm(s.est_net)}</div>
                      <div className="text-[11px] text-ink-3">of {rm(s.gross)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </OfficeShell>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'FULLY_SETTLED') return <span className="shrink-0 rounded-full bg-good-soft px-1.5 py-0.5 text-[10px] font-medium text-good">settled</span>;
  if (s === 'CONFIRMED') return <span className="shrink-0 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">pending payout</span>;
  return <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">{status.replace(/_/g, ' ').toLowerCase()}</span>;
}
