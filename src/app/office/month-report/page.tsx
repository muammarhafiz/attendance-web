'use client';
// Office → Monthly report: one consolidated end-of-month owner report — financials (paid basis)
// through to net profit, sales highlights, attendance, and vs last month. Read-only; owner-gated.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Top = { name: string; sales: number | string; invoices: number };
type Report = {
  year: number; month: number; label: string; cost_coverage_pct: number | string | null;
  financials: { sales: number|string; cogs: number|string; gross_profit: number|string; margin_pct: number|string|null;
                payroll: number|string; employer: number|string; bills: number|string; meals: number|string; net_profit: number|string };
  sales: { car_count: number; avg_per_car: number|string; trade_sales: number|string|null; receivable: number|string; top: Top[] };
  attendance: { staff_count: number; present_days: number; absent_days: number; late_days: number; leave_days: number };
  prev: { label: string; sales: number|string; gross_profit: number|string; net_profit: number|string; cost_coverage_pct: number|string|null };
  delta: { sales: number|string; gross_profit: number|string; net_profit: number|string };
};

const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const rm = (x: number) => `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function Delta({ v }: { v: number }) {
  if (!v) return <span className="text-ink-3">— vs last month</span>;
  const up = v > 0;
  return <span className={up ? 'text-good' : 'text-bad'}>{up ? '▲' : '▼'} {rm(Math.abs(v))} vs last month</span>;
}

export default function MonthReportPage() {
  const today = new Date();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { supabase.rpc('can_access', { p_feature: 'pnl' }).then(({ data }) => setAllowed(data === true)); }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.rpc('owner_month_report', { p_year: year, p_month: month });
    if (error) { setErr(error.message); setR(null); } else { setR(data as Report); }
    setLoading(false);
  }, [year, month]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const prevMonth = () => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };
  const nextMonth = () => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };

  const coverage = n(r?.cost_coverage_pct);
  const prevCoverage = n(r?.prev?.cost_coverage_pct);
  const f = r?.financials;
  const netClass = useMemo(() => (n(f?.net_profit) < 0 ? 'text-bad' : 'text-good'), [f?.net_profit]);

  if (allowed === null) return <div className="mx-auto max-w-4xl px-4 py-6 text-sm text-ink-3">Checking…</div>;
  if (!allowed) return <div className="mx-auto max-w-4xl px-4 py-6 text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Monthly report</h1>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">◀</button>
          <span className="min-w-[130px] text-center text-sm font-semibold">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">▶</button>
        </div>
      </div>

      {err && <div className="mb-3 rounded-md border border-rose-200 bg-bad-soft p-2 text-sm text-bad">{err}</div>}
      {loading || !r || !f ? <div className="text-sm text-ink-3">Loading…</div> : (
        <>
          {coverage > 0 && coverage < 100 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-warn-soft px-3 py-2 text-xs text-warn">
              Cost data is {coverage.toFixed(0)}% complete for this month — profit and net are still provisional. (Paid-invoice cost tracking began July 2026.)
            </div>
          )}

          {/* Headline tiles */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-card bg-card shadow-card p-4">
              <div className="text-xs font-medium text-ink-2">Net profit</div>
              <div className={`mt-1 text-2xl font-semibold ${netClass}`}>{rm(n(f.net_profit))}</div>
              <div className="mt-1 text-[11px]"><Delta v={n(r.delta.net_profit)} /></div>
            </div>
            <div className="rounded-card bg-card shadow-card p-4">
              <div className="text-xs font-medium text-ink-2">Sales (paid)</div>
              <div className="mt-1 text-2xl font-semibold text-ink">{rm(n(f.sales))}</div>
              <div className="mt-1 text-[11px]"><Delta v={n(r.delta.sales)} /></div>
            </div>
            <div className="rounded-card bg-card shadow-card p-4">
              <div className="text-xs font-medium text-ink-2">Gross profit</div>
              <div className="mt-1 text-2xl font-semibold text-ink">{rm(n(f.gross_profit))}</div>
              <div className="mt-1 text-[11px]"><Delta v={n(r.delta.gross_profit)} /></div>
            </div>
          </div>

          {/* Financials */}
          <div className="mb-4 rounded-card bg-card shadow-card p-4">
            <div className="mb-2 text-sm font-semibold text-ink-2">Money</div>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm sm:grid-cols-4">
              <Row label="Sales (paid)" value={rm(n(f.sales))} />
              <Row label="Parts cost" value={rm(n(f.cogs))} />
              <Row label="Gross profit" value={rm(n(f.gross_profit))} />
              <Row label="Margin" value={`${n(f.margin_pct).toFixed(0)}%`} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Costs</div>
              <Line label={`Payroll (${r.attendance.staff_count} staff)`} value={rm(n(f.payroll))} />
              <Line label="Employer EPF / SOCSO / EIS" value={rm(n(f.employer))} />
              <Line label="Bills & others" value={rm(n(f.bills))} />
              <Line label="Staff meals" value={rm(n(f.meals))} />
              <div className={`mt-2 flex items-center justify-between border-t border-line pt-2 text-sm font-semibold ${netClass}`}>
                <span>Net profit</span><span>{rm(n(f.net_profit))}</span>
              </div>
            </div>
          </div>

          {/* Sales highlights */}
          <div className="mb-4 rounded-card bg-card shadow-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-2">Sales highlights</span>
              <Link href="/niagawan/pnl" className="text-xs font-medium text-accent hover:underline">full P&amp;L ↗</Link>
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm sm:grid-cols-3">
              <Row label="Cars serviced" value={String(r.sales.car_count)} />
              <Row label="Average per car" value={rm(n(r.sales.avg_per_car))} />
              <Row label="Outstanding (unpaid)" value={rm(n(r.sales.receivable))} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Top sellers</div>
              <div className="space-y-1">
                {(r.sales.top ?? []).map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">{i + 1}. {t.name}</span>
                    <span className="tabular-nums font-medium">{rm(n(t.sales))} <span className="text-ink-3">({t.invoices})</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Attendance */}
          <div className="mb-4 rounded-card bg-card shadow-card p-4">
            <div className="mb-2 text-sm font-semibold text-ink-2">Attendance</div>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm sm:grid-cols-4">
              <Row label="Present days" value={String(r.attendance.present_days)} />
              <Row label="Late days" value={String(r.attendance.late_days)} />
              <Row label="Leave / off days" value={String(r.attendance.leave_days)} />
              <Row label="Absent days" value={String(r.attendance.absent_days)} />
            </div>
          </div>

          <p className="text-xs text-ink-3">Compared with {r.prev.label}: sales {rm(n(r.prev.sales))}, gross profit {rm(n(r.prev.gross_profit))}, net {rm(n(r.prev.net_profit))}{prevCoverage > 0 && prevCoverage < 100 ? ' (last month’s cost was still provisional)' : ''}. All sales figures count paid invoices only.</p>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-ink-2">{label}</div><div className="font-semibold tabular-nums">{value}</div></div>;
}
function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-ink-2">{label}</span><span className="tabular-nums font-medium">{value}</span></div>;
}
