'use client';
// Owner-only tyre-services dashboard (the "Sales & profit" page at /tyre/sales). Shows monthly tyre-service
// sales + profit (paid basis, catalog cost) for the Niagawan "ALIGNMENT -ZP" category, plus the
// "booked wrong" review list (tyre work not booked under a tyre code). RPCs are gated owner/month_end.
// Each month row expands to list that month's invoices (invoice no. + date + sale + margin).
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type MonthRow = { month: string; jobs: number; revenue: number; est_cost: number; profit: number; margin_pct: number };
type InvoiceRow = { month: string; inv: string; day: string; lines: number; revenue: number; est_cost: number; profit: number; margin_pct: number };
type Issue = { inv: string; day: string; car: string; staff: string | null; code: string; description: string; amount: number };

const rm = (n: number) => `RM${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
};
const dateLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });

export default function TyreTracker() {
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const [m, v, i] = await Promise.all([
        supabase.rpc('tyre_services_by_month'),
        supabase.rpc('tyre_services_by_invoice'),
        supabase.rpc('tyre_booking_issues'),
      ]);
      if (m.error || v.error || i.error) { setErr(m.error?.message || v.error?.message || i.error?.message || 'error'); setLoading(false); return; }
      setMonths(((m.data ?? []) as MonthRow[]).slice().reverse()); // newest month first
      setInvoices((v.data ?? []) as InvoiceRow[]);
      setIssues((i.data ?? []) as Issue[]);
      setLoading(false);
    })();
  }, []);

  // group invoices by month, newest invoice first within each month
  const invByMonth = useMemo(() => {
    const map = new Map<string, InvoiceRow[]>();
    for (const r of invoices) {
      const arr = map.get(r.month);
      if (arr) arr.push(r); else map.set(r.month, [r]);
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.inv < b.inv ? 1 : -1));
    return map;
  }, [invoices]);

  const toggle = (m: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

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
          {months.map((r) => {
              const isOpen = open.has(r.month);
              const list = invByMonth.get(r.month) ?? [];
              return (
                <tbody key={r.month}>
                  <tr
                    onClick={() => toggle(r.month)}
                    className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-ink/5"
                    aria-expanded={isOpen}
                  >
                    <td className="px-3 py-2 text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`text-ink-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                        {monthLabel(r.month)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{r.jobs}</td>
                    <td className="px-3 py-2 text-right text-ink tabular-nums">{rm(r.revenue)}</td>
                    <td className="px-3 py-2 text-right font-medium text-good tabular-nums">{rm(r.profit)}</td>
                    <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{r.margin_pct}%</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-line/60 last:border-0">
                      <td colSpan={5} className="bg-ink/[0.03] px-3 py-2">
                        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-3">
                          {list.length} invoice{list.length === 1 ? '' : 's'}
                        </div>
                        <div className="overflow-hidden rounded-lg border border-line">
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="border-b border-line bg-card text-left text-[11px] uppercase tracking-wide text-ink-3">
                                <th className="px-3 py-1.5 font-medium">Invoice</th>
                                <th className="px-3 py-1.5 font-medium text-right">Sale</th>
                                <th className="px-3 py-1.5 font-medium text-right">Margin</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map((x) => (
                                <tr key={x.inv} className="border-b border-line/50 last:border-0 bg-card">
                                  <td className="px-3 py-1.5">
                                    <span className="font-medium text-ink">{x.inv}</span>
                                    <span className="ml-2 text-[12px] text-ink-3">{dateLabel(x.day)}</span>
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-ink tabular-nums">{rm(x.revenue)}</td>
                                  <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{x.margin_pct}%</td>
                                </tr>
                              ))}
                              {!list.length && (
                                <tr><td colSpan={3} className="px-3 py-3 text-center text-ink-3 bg-card">No invoices.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
            {!months.length && (
              <tbody><tr><td colSpan={5} className="px-3 py-6 text-center text-ink-3">No tyre-service sales yet.</td></tr></tbody>
            )}
        </table>
      </div>
      <p className="-mt-3 px-1 text-[12px] text-ink-3">Tap a month to see its invoices.</p>

      <div className="rounded-card bg-card shadow-card p-4">
        <button
          type="button"
          onClick={() => setIssuesOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
          aria-expanded={issuesOpen}
        >
          <span className={`text-ink-3 transition-transform ${issuesOpen ? 'rotate-90' : ''}`}>▸</span>
          <span className="text-base font-semibold text-ink">⚠️ Booked wrong</span>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink-2">{issues.length}</span>
          <span className="ml-auto text-[12px] text-ink-3">{issuesOpen ? 'Hide' : 'Show'}</span>
        </button>
        {issuesOpen && (
          <div className="mt-3">
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
                    <div className="text-[13px] text-ink-2">{dateLabel(x.day)} · {x.car || '—'}{x.staff ? ` · ${x.staff}` : ''}</div>
                    <div className="mt-0.5 text-[12px] text-ink-3"><span className="text-ink-2">{x.code}</span> — {x.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-ink-3">Nothing flagged. 👍</div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-card bg-card shadow-card p-4">
        <div className="mb-2 text-sm font-semibold text-ink">How this stays updated</div>
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2 marker:text-ink-3">
          <li><b>Item list</b> &mdash; refreshed from your Niagawan <b>ALIGNMENT&nbsp;-ZP</b> category every night (2:30am). Add or remove an item there and it&rsquo;s picked up automatically.</li>
          <li><b>Sales</b> &mdash; each day&rsquo;s invoices are pulled from Niagawan overnight, so new tyre jobs appear the next day.</li>
          <li><b>&ldquo;Booked wrong&rdquo;</b> &mdash; checked every morning (9am); you get a bell + phone alert for any tyre work booked without a tyre code.</li>
        </ul>
      </div>
    </div>
  );
}
