// src/app/niagawan/staff-sales/page.tsx
'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  staff_name: string;
  staff_position: string | null;
  invoices: number;
  sales: number | string;
  avg_invoice: number | string;
  is_unattributed: boolean;
  profit: number | string;
  profit_invoices: number;
};

type UnattRow = {
  niagawan_name: string;
  inv: string;
  day: string;
  amount: number | string;
};

const rm = (x: number) =>
  `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Today in Kuala Lumpur as YYYY-MM-DD (en-CA gives ISO order).
function klTodayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function monthRange(y: number, m: number) {
  const from = `${y}-${pad(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate(); // m is 1-based; day 0 of next month = last day of this month
  const to = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { from, to };
}
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtD(iso: string) {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${Number(d)} ${MON[Number(m)] ?? m}` : iso;
}

export default function StaffSalesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [unattOpen, setUnattOpen] = useState(false);
  const [unatt, setUnatt] = useState<UnattRow[]>([]);
  const [unattLoading, setUnattLoading] = useState(false);
  const [commissionPct, setCommissionPct] = useState(5); // adjustable, saved to pnl_settings

  const todayISO = klTodayISO();
  const curY = Number(todayISO.slice(0, 4));
  const curM = Number(todayISO.slice(5, 7));

  const [mode, setMode] = useState<'month' | 'ytd'>('month');
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: curY, m: curM });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: acc } = await supabase.rpc('my_access');
        setIsOwner(!!(acc as { owner?: boolean } | null)?.owner);
        const { data: st } = await supabase.from('pnl_settings').select('value').eq('key', 'commission_pct').maybeSingle();
        if (st?.value != null) setCommissionPct(Number(st.value) || 5);
      } else {
        setIsOwner(false);
      }
    })();
  }, []);

  const { from, to, label } = useMemo(() => {
    if (mode === 'ytd') {
      return { from: `${curY}-01-01`, to: todayISO, label: `${curY} year-to-date` };
    }
    const r = monthRange(ym.y, ym.m);
    const name = new Date(ym.y, ym.m - 1, 1).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
    return { from: r.from, to: r.to, label: name };
  }, [mode, ym, curY, todayISO]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('staff_sales_report', { p_from: from, p_to: to });
    if (error) setErr(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [from, to]);

  const persistPct = useCallback(async (v: number) => {
    await supabase.from('pnl_settings').upsert({ key: 'commission_pct', value: v as unknown as object }, { onConflict: 'key' });
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  // Reset the unattributed drill-down whenever the period changes.
  useEffect(() => {
    setUnattOpen(false);
    setUnatt([]);
  }, [from, to]);

  const toggleUnatt = useCallback(async () => {
    const next = !unattOpen;
    setUnattOpen(next);
    if (next && unatt.length === 0) {
      setUnattLoading(true);
      const { data } = await supabase.rpc('staff_sales_unattributed', { p_from: from, p_to: to });
      setUnatt((data ?? []) as UnattRow[]);
      setUnattLoading(false);
    }
  }, [unattOpen, unatt.length, from, to]);

  const totals = useMemo(() => {
    let inv = 0;
    let sales = 0;
    let profit = 0;
    let profitInv = 0;
    for (const r of rows) {
      inv += Number(r.invoices) || 0;
      sales += Number(r.sales) || 0;
      profit += Number(r.profit) || 0;
      profitInv += Number(r.profit_invoices) || 0;
    }
    return { inv, sales, profit, profitInv };
  }, [rows]);
  const hasProfit = totals.profitInv > 0; // any per-invoice COGS synced yet?
  const nCols = hasProfit ? 7 : 5;

  // Period health — is this window trustworthy enough to base commission on?
  // Two signals from the data already loaded: cost coverage, and how much is attributed.
  const unattrSales = rows.filter((r) => r.is_unattributed).reduce((s, r) => s + (Number(r.sales) || 0), 0);
  const coveragePct = totals.inv > 0 ? Math.round((totals.profitInv / totals.inv) * 100) : 0;
  const attrPct = totals.sales > 0 ? Math.round((1 - unattrSales / totals.sales) * 100) : 100;
  const healthLevel = coveragePct >= 99 && attrPct >= 99 ? 'ready' : coveragePct >= 50 ? 'partial' : 'notready';

  const maxSales = useMemo(
    () => rows.reduce((mx, r) => Math.max(mx, Number(r.sales) || 0), 0),
    [rows]
  );

  // Group the unattributed invoices by the name they were booked under.
  const unattGroups = useMemo(() => {
    const m = new Map<string, { name: string; total: number; items: UnattRow[] }>();
    for (const r of unatt) {
      const g = m.get(r.niagawan_name) ?? { name: r.niagawan_name, total: 0, items: [] };
      g.items.push(r);
      g.total += Number(r.amount) || 0;
      m.set(r.niagawan_name, g);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [unatt]);

  const canNext = ym.y < curY || (ym.y === curY && ym.m < curM);
  const stepMonth = (delta: number) => {
    setYm((p) => {
      let y = p.y;
      let m = p.m + delta;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { y, m };
    });
  };

  const exportCsv = useCallback(() => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ['Rank', 'Name', 'Position', 'Invoices', 'Sales (RM)', 'Profit (RM)', `Commission ${commissionPct}% (RM)`, 'Avg per invoice (RM)'];
    const lines = [header.join(',')];
    let rank = 0;
    for (const r of rows) {
      const rk = r.is_unattributed ? '' : String(++rank);
      const hasP = Number(r.profit_invoices) > 0;
      lines.push([
        rk,
        esc(r.staff_name),
        esc(r.staff_position ?? ''),
        String(r.invoices),
        Number(r.sales).toFixed(2),
        hasP ? Number(r.profit).toFixed(2) : '',
        hasP ? ((Number(r.profit) || 0) * commissionPct / 100).toFixed(2) : '',
        Number(r.avg_invoice).toFixed(2),
      ].join(','));
    }
    lines.push(['', esc('TOTAL'), '', String(totals.inv), totals.sales.toFixed(2), totals.profit.toFixed(2), (totals.profit * commissionPct / 100).toFixed(2), ''].join(','));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-sales-${label.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, totals, label, commissionPct]);

  if (authed === null || isOwner === null) {
    return <div className="text-sm text-ink-3">Checking session…</div>;
  }
  if (authed === false) return <div className="text-sm text-ink-2">Please sign in to view this page.</div>;
  if (!isOwner) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  let rank = 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-ink">Staff Sales</h1>
          <p className="text-xs text-ink-3">Sales per mechanic · {label}</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-ink/5 disabled:opacity-40"
        >
          Download CSV
        </button>
      </div>

      {/* Controls: period mode + month stepper */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
          <button
            onClick={() => setMode('month')}
            className={`rounded-md px-3 py-1 ${mode === 'month' ? 'bg-ink/10 font-medium text-ink' : 'text-ink-2'}`}
          >
            Month
          </button>
          <button
            onClick={() => setMode('ytd')}
            className={`rounded-md px-3 py-1 ${mode === 'ytd' ? 'bg-ink/10 font-medium text-ink' : 'text-ink-2'}`}
          >
            Year-to-date
          </button>
        </div>

        {mode === 'month' && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => stepMonth(-1)}
              aria-label="Previous month"
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5"
            >
              ◀
            </button>
            <span className="min-w-[8.5rem] text-center text-sm text-ink">{label}</span>
            <button
              onClick={() => stepMonth(1)}
              disabled={!canNext}
              aria-label="Next month"
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-40"
            >
              ▶
            </button>
          </div>
        )}

        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2">
          Commission
          <input
            type="number" min={0} max={100} step={0.5} value={commissionPct}
            onChange={(e) => setCommissionPct(Math.max(0, Number(e.target.value) || 0))}
            onBlur={(e) => persistPct(Math.max(0, Number(e.target.value) || 0))}
            className="w-16 rounded-lg border border-line bg-card px-2 py-1 text-right text-sm text-ink"
          />
          %
        </label>
      </div>

      {err && <div className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}

      {!loading && rows.length > 0 && (
        <div className={`mb-3 rounded-xl border border-line p-3 ${
          healthLevel === 'ready' ? 'bg-good-soft' : healthLevel === 'partial' ? 'bg-warn-soft' : 'bg-bad-soft'
        }`}>
          <div className="flex items-center gap-2">
            <span aria-hidden>{healthLevel === 'ready' ? '🟢' : healthLevel === 'partial' ? '🟡' : '🔴'}</span>
            <span className={`text-sm font-semibold ${
              healthLevel === 'ready' ? 'text-good' : healthLevel === 'partial' ? 'text-warn' : 'text-bad'
            }`}>
              {healthLevel === 'ready'
                ? 'Ready — safe to base commission on'
                : healthLevel === 'partial'
                ? 'Partly ready — check before paying'
                : 'Not ready for commission'}
            </span>
          </div>
          <div className="mt-2 grid gap-1.5 text-xs text-ink-2 sm:grid-cols-2">
            <div>
              <span className="font-medium text-ink">{coveragePct}%</span> of invoices have cost data
              {coveragePct < 100 && <span className="text-ink-3"> · {totals.profitInv}/{totals.inv} costed</span>}
            </div>
            <div>
              <span className="font-medium text-ink">{attrPct}%</span> of sales attributed to a mechanic
              {unattrSales > 0 && <span className="text-ink-3"> · {rm(unattrSales)} unassigned</span>}
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Only pay commission on a period showing 🟢 — every invoice costed and every sale attributed. Amber or red
            means the profit figure is <span className="font-medium">incomplete, not final</span>.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Mechanic</th>
              <th className="px-3 py-2 text-right font-medium">Invoices</th>
              <th className="px-3 py-2 text-right font-medium">Sales</th>
              {hasProfit && <th className="px-3 py-2 text-right font-medium">Profit</th>}
              {hasProfit && <th className="px-3 py-2 text-right font-medium">Comm {commissionPct}%</th>}
              <th className="px-3 py-2 text-right font-medium">Avg/inv</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-sm text-ink-3">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-sm text-ink-3">No sales in this period.</td></tr>
            )}
            {!loading && rows.map((r) => {
              const sales = Number(r.sales) || 0;
              const pct = maxSales > 0 ? Math.max(2, (sales / maxSales) * 100) : 0;
              const isU = r.is_unattributed;
              const rk = isU ? null : ++rank;
              return (
                <Fragment key={r.staff_name}>
                  <tr
                    onClick={isU ? toggleUnatt : undefined}
                    className={`border-b border-line/60 ${isU ? 'cursor-pointer bg-warn-soft hover:opacity-90' : ''}`}
                  >
                    <td className="px-3 py-2 tabular-nums text-ink-3">{rk ?? '⚠️'}</td>
                    <td className="px-3 py-2">
                      <div className={isU ? 'font-medium text-warn' : 'text-ink'}>
                        {isU && <span className="mr-1">{unattOpen ? '▾' : '▸'}</span>}
                        {r.staff_name}
                      </div>
                      {r.staff_position && <div className="text-xs text-ink-3">{r.staff_position}</div>}
                      {isU && <div className="text-xs text-ink-3">tap to see the invoices</div>}
                      <div className="mt-1 h-1 w-full max-w-[10rem] overflow-hidden rounded-full bg-ink/5">
                        <div
                          className={`h-full rounded-full ${isU ? 'bg-warn' : 'bg-accent'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.invoices}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{rm(sales)}</td>
                    {hasProfit && (
                      <td className="px-3 py-2 text-right">
                        {Number(r.profit_invoices) > 0
                          ? <span className="tabular-nums font-medium text-good">{rm(Number(r.profit) || 0)}</span>
                          : <span className="text-ink-3">—</span>}
                      </td>
                    )}
                    {hasProfit && (
                      <td className="px-3 py-2 text-right">
                        {Number(r.profit_invoices) > 0
                          ? <span className="tabular-nums font-semibold text-accent">{rm((Number(r.profit) || 0) * commissionPct / 100)}</span>
                          : <span className="text-ink-3">—</span>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{rm(Number(r.avg_invoice) || 0)}</td>
                  </tr>
                  {isU && unattOpen && (
                    <tr>
                      <td colSpan={nCols} className="px-3 py-3">
                        {unattLoading ? (
                          <div className="text-xs text-ink-3">Loading…</div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-ink-3">
                              Booked under a name that isn&rsquo;t linked to a staff member. Add the name to the sales
                              map (or fix it at the till) to attribute these.
                            </p>
                            {unattGroups.map((g) => (
                              <div key={g.name} className="rounded-lg border border-line bg-card p-2">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium text-ink">{g.name}</span>
                                  <span className="text-xs text-ink-2">{g.items.length} inv · {rm(g.total)}</span>
                                </div>
                                <ul className="divide-y divide-line/60">
                                  {g.items.map((it) => (
                                    <li key={it.inv} className="flex items-baseline gap-3 py-1 text-xs">
                                      <span className="font-mono text-ink">{it.inv}</span>
                                      <span className="ml-auto text-ink-3">{fmtD(it.day)}</span>
                                      <span className="w-20 text-right tabular-nums text-ink-2">{rm(Number(it.amount) || 0)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line font-medium text-ink">
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.inv}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(totals.sales)}</td>
                {hasProfit && <td className="px-3 py-2 text-right tabular-nums text-good">{rm(totals.profit)}</td>}
                {hasProfit && <td className="px-3 py-2 text-right tabular-nums font-semibold text-accent">{rm(totals.profit * commissionPct / 100)}</td>}
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        Sales are attributed from Niagawan invoices via each person&rsquo;s salesperson name. &ldquo;Unattributed&rdquo;
        rows are invoices booked under a name that isn&rsquo;t linked to a staff member.
      </p>
      {!loading && rows.length > 0 && !hasProfit && (
        <p className="mt-1 text-xs text-ink-3">
          A <span className="font-medium">Profit</span> column will appear here once the per-invoice COGS sync is switched on.
        </p>
      )}
    </div>
  );
}
