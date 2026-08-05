// src/app/niagawan/staff-sales/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  staff_name: string;
  staff_position: string | null;
  invoices: number;
  sales: number | string;
  avg_invoice: number | string;
  is_unattributed: boolean;
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

export default function StaffSalesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

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

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  const totals = useMemo(() => {
    let inv = 0;
    let sales = 0;
    for (const r of rows) {
      inv += Number(r.invoices) || 0;
      sales += Number(r.sales) || 0;
    }
    return { inv, sales };
  }, [rows]);

  const maxSales = useMemo(
    () => rows.reduce((mx, r) => Math.max(mx, Number(r.sales) || 0), 0),
    [rows]
  );

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
    const header = ['Rank', 'Name', 'Position', 'Invoices', 'Sales (RM)', 'Avg per invoice (RM)'];
    const lines = [header.join(',')];
    let rank = 0;
    for (const r of rows) {
      const rk = r.is_unattributed ? '' : String(++rank);
      lines.push([
        rk,
        esc(r.staff_name),
        esc(r.staff_position ?? ''),
        String(r.invoices),
        Number(r.sales).toFixed(2),
        Number(r.avg_invoice).toFixed(2),
      ].join(','));
    }
    lines.push(['', esc('TOTAL'), '', String(totals.inv), totals.sales.toFixed(2), ''].join(','));
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-sales-${label.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, totals, label]);

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
      </div>

      {err && <div className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}

      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Mechanic</th>
              <th className="px-3 py-2 text-right font-medium">Invoices</th>
              <th className="px-3 py-2 text-right font-medium">Sales</th>
              <th className="px-3 py-2 text-right font-medium">Avg/inv</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-3">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-3">No sales in this period.</td></tr>
            )}
            {!loading && rows.map((r) => {
              const sales = Number(r.sales) || 0;
              const pct = maxSales > 0 ? Math.max(2, (sales / maxSales) * 100) : 0;
              const rk = r.is_unattributed ? null : ++rank;
              return (
                <tr
                  key={r.staff_name}
                  className={`border-b border-line/60 ${r.is_unattributed ? 'bg-warn-soft' : ''}`}
                >
                  <td className="px-3 py-2 tabular-nums text-ink-3">{rk ?? '⚠️'}</td>
                  <td className="px-3 py-2">
                    <div className={r.is_unattributed ? 'font-medium text-warn' : 'text-ink'}>{r.staff_name}</div>
                    {r.staff_position && <div className="text-xs text-ink-3">{r.staff_position}</div>}
                    <div className="mt-1 h-1 w-full max-w-[10rem] overflow-hidden rounded-full bg-ink/5">
                      <div
                        className={`h-full rounded-full ${r.is_unattributed ? 'bg-warn' : 'bg-accent'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.invoices}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{rm(sales)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{rm(Number(r.avg_invoice) || 0)}</td>
                </tr>
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
    </div>
  );
}
