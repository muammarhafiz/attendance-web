'use client';
// src/app/office/page.tsx — the clerk/admin home. Their workspace: end-of-month, chasing unpaid,
// checking yesterday's money by method, zero-cost parts to fix, and cash count. No salary here —
// that lives behind its own gate on the End-of-month page.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Home = {
  error?: string;
  today: string;
  month: string;
  eom: { done: number; total: number; blockers: number };
  unpaid: { count: number; total: number | string; top: { inv: string; customer: string | null; balance: number | string }[] };
  yesterday: { day: string; cash_in: number | string; cash_out: number | string; qr_in: number | string; card_in: number | string; transfer_in: number | string } | null;
  zero_cogs: { items: number; days: number };
};

const rm = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rm0 = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
const fmtDay = (iso: string) => new Date(String(iso) + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });

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

export default function OfficePage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [d, setD] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('clerk_home');
    setD((data ?? null) as Home);
    setLoading(false);
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  if (allowed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for the office clerk, managers and the owner.</div>;
  if (loading || !d) return <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-gray-400">Loading your tasks…</div>;

  const y = d.yesterday;
  const yIn = y ? Number(y.cash_in || 0) + Number(y.qr_in || 0) + Number(y.card_in || 0) + Number(y.transfer_in || 0) : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">🗂️ Office</h1>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-700">refresh</button>
      </div>
      <p className="mb-4 text-sm text-gray-500">Your daily &amp; month-end tasks.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* End of month */}
        <Link href="/month-end" className="block">
          <div className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base leading-none">🗓️</span>
              <h2 className="text-sm font-semibold text-gray-800">End of month</h2>
              <span className="ml-auto text-xs text-gray-400">Open →</span>
            </div>
            <div className="text-sm text-gray-600">{d.eom.done} of {d.eom.total} steps done</div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(d.eom.done / d.eom.total) * 100}%` }} />
            </div>
            {d.eom.blockers > 0 && <div className="mt-2 text-xs font-medium text-amber-700">⚠ {d.eom.blockers} day{d.eom.blockers === 1 ? '' : 's'} still need clearing</div>}
          </div>
        </Link>

        {/* Cash count */}
        <Link href="/cash-count" className="block">
          <div className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base leading-none">💵</span>
              <h2 className="text-sm font-semibold text-gray-800">Cash count</h2>
              <span className="ml-auto text-xs text-gray-400">Open →</span>
            </div>
            <div className="text-sm text-gray-600">Count &amp; reconcile the cash drawer.</div>
          </div>
        </Link>

        {/* Yesterday's money */}
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
                <div className="mt-1 flex justify-between border-t border-gray-100 pt-1 text-sm font-semibold"><span>Money in</span><span>{rm(yIn)}</span></div>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Match transfer / QR / card against what actually landed in the bank.</p>
            </>
          ) : <div className="text-sm text-gray-400">No data for yesterday yet.</div>}
        </Card>

        {/* Chase unpaid */}
        <Card title="Chase unpaid" icon="📞">
          {d.unpaid.count > 0 ? (
            <>
              <div className="mb-2 text-sm text-gray-600"><span className="font-semibold text-gray-900">{rm0(d.unpaid.total)}</span> across {d.unpaid.count} invoice{d.unpaid.count === 1 ? '' : 's'}</div>
              <div className="max-h-44 space-y-0.5 overflow-y-auto">
                {d.unpaid.top.map((u) => (
                  <div key={u.inv} className="flex justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-gray-600">{u.customer || u.inv}</span>
                    <span className="shrink-0 font-medium text-gray-800">{rm(u.balance)}</span>
                  </div>
                ))}
              </div>
              {d.unpaid.count > d.unpaid.top.length && <div className="mt-1 text-[11px] text-gray-400">Top {d.unpaid.top.length} shown · {d.unpaid.count - d.unpaid.top.length} more</div>}
            </>
          ) : <div className="text-sm text-emerald-700">Nothing unpaid ✓</div>}
        </Card>

        {/* Zero-cost parts */}
        <Card title="Parts with no cost" icon="🏷️">
          {d.zero_cogs.items > 0 ? (
            <>
              <div className="text-sm text-gray-600"><span className="font-semibold text-amber-700">{d.zero_cogs.items} part{d.zero_cogs.items === 1 ? '' : 's'}</span> across {d.zero_cogs.days} day{d.zero_cogs.days === 1 ? '' : 's'} this month have no cost keyed.</div>
              <p className="mt-2 text-[11px] text-gray-400">Key the cost in Niagawan so profit is correct. The <Link href="/month-end" className="text-blue-600 underline">End of month</Link> page lists which days.</p>
            </>
          ) : <div className="text-sm text-emerald-700">All parts have a cost ✓</div>}
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-sm"><span className="text-gray-600">{k}</span><span className="font-medium text-gray-800">{v}</span></div>;
}
