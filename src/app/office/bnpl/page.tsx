'use client';
// Office → BNPL: hub listing each Buy-Now-Pay-Later service. Each opens its own tracker page.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, rm } from '@/components/office/shared';
import { Icon } from '@/components/icons';

type HubItem = {
  slug: string; display_name: string;
  mdr_pct: number; flat_fee: number; sst_pct: number;
  outstanding_count: number; outstanding_net: number | string; to_confirm: number;
};

export default function BnplHubPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<HubItem[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('bnpl_hub');
    setItems((data ?? []) as HubItem[]);
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (allowed === null) return <div className="p-6 text-sm text-ink-2">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for the office clerk, managers and the owner.</div>;

  return (
    <OfficeShell title="BNPL payments" back onRefresh={load}>
      <p className="mb-4 text-sm text-ink-2">
        Buy-Now-Pay-Later services. Each pays you a few days after the sale, minus a fee — open a service to
        see its sales, its payouts to tick against the bank, and what it still owes you.
      </p>

      {items === null ? (
        <div className="py-6 text-center text-sm text-ink-3">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-card bg-card shadow-card p-6 text-center text-sm text-ink-3">No BNPL services set up yet.</div>
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
    </OfficeShell>
  );
}
