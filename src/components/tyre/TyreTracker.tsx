'use client';
// Owner-only tyre-services dashboard (the "Sales & profit" tab on /tyre). Shows monthly tyre-service
// sales + profit (paid basis, catalog cost) for the Niagawan "ALIGNMENT -ZP" category, plus the
// "booked wrong" review list (tyre work not booked under a tyre code). RPCs are gated owner/month_end.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type MonthRow = { month: string; jobs: number; revenue: number; est_cost: number; profit: number; margin_pct: number };
type Issue = { inv: string; day: string; car: string; code: string; description: string; amount: number };

const rm = (n: number) => `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
};

export default function TyreTracker() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [m, i] = await Promise.all([
        supabase.rpc('tyre_services_by_month'),
        supabase.rpc('tyre_booking_issues'),
      ]);
      if (m.error || i.error) { setErr(m.error?.message || i.error?.message || 'error'); setLoading(false); return; }
      setMonths(((m.data ?? []) as MonthRow[]).slice().reverse()); // newest month first
      setIssues((i.data ?? []) as Issue[]);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-4 text-sm text-ink-3">Loading…</div>;
  if (err) return <div className="p-4 text-sm text-bad">Couldn&rsquo;t load: {err}</div>;

  const totalRev = months.reduce((s, r) => s + Number(r.revenue), 0);
  const totalProfit = months.reduce((s, r) => s + Number(r.profit), 0);
  const totalJobs = months.reduce((s, r) => s + Number(r.jobs), 0);

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink-2">
        Tyre-service sales (alignment, balancing, puncture, patching, camber, valve) booked under the{' '}
        <b>ALIGNMENT&nbsp;-ZP</b> category. Paid invoices only; profit uses the catalog cost.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-card bg-card shadow-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Sales</div>
          <div className="text-xl font-bold text-ink tabular-nums">{rm(totalRev)}</div>
        </div>
        <div className="rounded-card bg-card shadow-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Profit</div>
          <div className="text-xl font-bold text-good tabular-nums">{rm(totalProfit)}</div>
        </div>
        <div className="rounded-card bg-card shadow-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Jobs</div>
          <div className="text-xl font-bold text-ink tabular-nums">{totalJobs}</div>
        </div>
      </div>

      <div className="rounded-card bg-card shadow-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 font-medium text-right">Jobs</th>
              <th className="px-3 py-2 font-medium text-right">Sales</th>
              <th className="px-3 py-2 font-medium text-right">Profit</th>
              <th className="px-3 py-2 font-medium text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {months.map((r) => (
              <tr key={r.month} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2 text-ink">{monthLabel(r.month)}</td>
                <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{r.jobs}</td>
                <td className="px-3 py-2 text-right text-ink tabular-nums">{rm(r.revenue)}</td>
                <td className="px-3 py-2 text-right font-medium text-good tabular-nums">{rm(r.profit)}</td>
                <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{r.margin_pct}%</td>
              </tr>
            ))}
            {!months.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-3">No tyre-service sales yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-card bg-card shadow-card p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-base font-semibold text-ink">⚠️ Booked wrong</span>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink-2">{issues.length}</span>
        </div>
        <p className="mb-3 text-[13px] text-ink-2">
          Tyre work that wasn&rsquo;t booked under a tyre code — bundled into another item, or typed free-hand.
          Re-book these under the right <b>ALIGNMENT&nbsp;-ZP</b> code so they&rsquo;re counted.
        </p>
        {issues.length ? (
          <div className="space-y-2">
            {issues.map((x, k) => (
              <div key={x.inv + ':' + k} className="rounded-lg border border-line p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{x.inv}</span>
                  <span className="text-ink tabular-nums">{rm(x.amount)}</span>
                </div>
                <div className="text-[13px] text-ink-2">{x.car || '—'} · <span className="text-ink-3">{x.code}</span></div>
                <div className="truncate text-[12px] text-ink-3">{x.description}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-ink-3">Nothing flagged. 👍</div>
        )}
      </div>
    </div>
  );
}
