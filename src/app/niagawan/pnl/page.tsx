// src/app/niagawan/pnl/page.tsx — monthly P&L (replaces the owner's manual Excel sheet).
// Auto: payroll + employer contributions (payroll module), sales/COGS/profit (Niagawan sync),
// trade-customer split (per-invoice rows), revenue per mechanic.
// Manual: monthly bills (rent, utilities, makan...) — pre-fillable from last month.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Daily = { day: string; invoices: number; sales: number | string; cogs: number | string; profit: number | string; unpaid_count: number | null };
type SaleInv = { inv: string; day: string; customer: string | null; amount: number | string | null; status: string | null; staff: string | null };
type Trade = { id: number; match: string; note: string | null };
type Bill = { id: number; month: string; label: string; amount: number | string; paid?: boolean | null; paid_date?: string | null };
type Pay = { staff_name: string; total_earn: number | string; epf_er: number | string | null; socso_er: number | string | null; eis_er: number | string | null };
type Meal = { meal_date: string; amount: number | string; item_count: number | null; drink_count: number | null };
type StaffSales = { staff_email: string | null; staff_name: string; niagawan_names: string | null; total: number | string; invoices: number };
type ZeroCount = { audit_date: string; n: number | string }; // days with un-priced (zero-cost) parts

const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const rm = (x: number) => `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string) => { const [y, m, dd] = String(d).split('-'); return dd && m && y ? `${dd}/${m}/${y}` : String(d); };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PnlPage() {
  const today = new Date();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [daily, setDaily] = useState<Daily[]>([]);
  const [salesInv, setSalesInv] = useState<SaleInv[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [pay, setPay] = useState<Pay[]>([]);
  const [staffMeals, setStaffMeals] = useState(0); // GrabFood staff lunch total (auto from email receipts)
  const [meals, setMeals] = useState<Meal[]>([]);   // individual GrabFood receipts for the month
  const [staffSales, setStaffSales] = useState<StaffSales[]>([]); // per-staff sales (admin RPC, matches each staff's "My sales")
  const [zeroByDay, setZeroByDay] = useState<Record<string, number>>({}); // day -> count of un-priced parts (Sales-page finality)
  const [targetNet, setTargetNet] = useState(50000);
  const [ptjPct, setPtjPct] = useState(5);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'costs' | 'staff'>('overview');
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newTrade, setNewTrade] = useState('');

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const firstDay = `${monthKey}-01`;
  const lastDay = `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  useEffect(() => {
    (async () => { const { data } = await supabase.rpc('can_access', { p_feature: 'pnl' }); setIsAdmin(data === true); })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, s, t, b, p, st, g, ml, ss, zc] = await Promise.all([
      supabase.from('niagawan_daily').select('day,invoices,sales,cogs,profit,unpaid_count').gte('day', firstDay).lte('day', lastDay).order('day'),
      supabase.from('niagawan_sale_inv').select('inv,day,customer,amount,status,staff').gte('day', firstDay).lte('day', lastDay),
      supabase.from('trade_customers').select('*').order('match'),
      supabase.from('opex_bills').select('*').eq('month', monthKey).order('id'),
      supabase.from('v_payslip_admin_summary_v2').select('staff_name,total_earn,epf_er,socso_er,eis_er').eq('year', year).eq('month', month),
      supabase.from('pnl_settings').select('*'),
      supabase.rpc('grab_meals_month_total', { p_month: monthKey }),
      supabase.from('grab_meals').select('meal_date,amount,item_count,drink_count').gte('meal_date', firstDay).lte('meal_date', lastDay).order('meal_date', { ascending: true }),
      supabase.rpc('all_staff_sales', { p_year: year, p_month: month }),
      supabase.rpc('cogs_zero_day_counts'), // days with un-priced parts -> Sales-page day finality
    ]);
    const loadErr = d.error || ss.error; // surface a Staff-sales RPC failure, don't mask it as empty
    if (loadErr) setErr(loadErr.message); else setErr(null);
    setDaily((d.data ?? []) as Daily[]);
    setSalesInv((s.data ?? []) as SaleInv[]);
    setTrades((t.data ?? []) as Trade[]);
    setBills((b.data ?? []) as Bill[]);
    setPay((p.data ?? []) as Pay[]);
    setStaffMeals(n(g.data) || 0);
    setMeals((ml.data ?? []) as Meal[]);
    setStaffSales((ss.data ?? []) as StaffSales[]);
    const zmap: Record<string, number> = {};
    for (const row of (zc.data ?? []) as ZeroCount[]) zmap[row.audit_date] = Number(row.n) || 0;
    setZeroByDay(zmap);
    for (const row of (st.data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.key === 'target_net') setTargetNet(n(row.value) || 50000);
      if (row.key === 'putrajaya_pct') setPtjPct(n(row.value));
    }
    setLoading(false);
  }, [firstDay, lastDay, monthKey, year, month]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  /* ------------------------------ computations ------------------------------ */
  const calc = useMemo(() => {
    const isTrade = (cust: string | null) => {
      const c = String(cust ?? '').toLowerCase();
      return trades.some((t) => c.includes(String(t.match).toLowerCase()));
    };
    // A day is FINAL only when it has no unpaid invoices AND no un-priced (zero-cost) parts —
    // the SAME rule the Sales page uses. Provisional days are excluded from every figure and
    // shown separately, so the P&L never counts money that isn't settled yet.
    const isFinal = (r: Daily) => r.unpaid_count === 0 && (zeroByDay[r.day] ?? 0) === 0;
    const finalDaily = daily.filter(isFinal);
    const finalDays = new Set(finalDaily.map((r) => r.day));
    const pendingDaily = daily.filter((r) => !isFinal(r) && n(r.sales) > 0);
    const pendingProfit = pendingDaily.reduce((s, r) => s + n(r.profit), 0);
    const pendingSales = pendingDaily.reduce((s, r) => s + n(r.sales), 0);
    const pendingDays = pendingDaily.length;

    const totalSales = finalDaily.reduce((s, r) => s + n(r.sales), 0);
    const totalCogs = finalDaily.reduce((s, r) => s + n(r.cogs), 0);
    const totalProfit = finalDaily.reduce((s, r) => s + n(r.profit), 0);
    // per-invoice splits use only invoices on final days, to stay consistent with the totals
    const finalInv = salesInv.filter((r) => finalDays.has(r.day));
    const tradeRows = finalInv.filter((r) => isTrade(r.customer));
    const repairRows = finalInv.filter((r) => !isTrade(r.customer));
    const tradeSales = tradeRows.reduce((s, r) => s + n(r.amount), 0);
    const repairSales = Math.max(0, totalSales - tradeSales);
    const carCount = repairRows.length || finalDaily.reduce((s, r) => s + (r.invoices || 0), 0);
    const aro = carCount > 0 ? repairSales / carCount : 0;
    const margin = repairSales > 0 ? (totalProfit / repairSales) * 100 : 0;
    // revenue per mechanic (repair jobs only)
    const perMech: Record<string, { total: number; jobs: number }> = {};
    for (const r of repairRows) {
      const who = (r.staff || '').trim() || '(no mechanic)';
      (perMech[who] = perMech[who] || { total: 0, jobs: 0 });
      perMech[who].total += n(r.amount); perMech[who].jobs += 1;
    }
    const mechanics = Object.entries(perMech).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
    // costs
    const payrollGross = pay.reduce((s, r) => s + n(r.total_earn), 0);
    const employer = pay.reduce((s, r) => s + n(r.epf_er) + n(r.socso_er) + n(r.eis_er), 0);
    const billsTotal = bills.reduce((s, r) => s + n(r.amount), 0);
    const costs = payrollGross + employer + billsTotal + staffMeals;
    // pace: profit per FINAL day with sales, projected over 26 working days
    const daysWithSales = finalDaily.filter((r) => n(r.sales) > 0).length;
    const projProfit = daysWithSales > 0 ? (totalProfit / daysWithSales) * 26 : 0;
    const netSoFar = totalProfit - costs;
    const netProjected = projProfit - costs;
    return { totalSales, totalCogs, totalProfit, tradeSales, tradeRows, repairSales, carCount, aro, margin, mechanics, payrollGross, employer, billsTotal, staffMeals, costs, netSoFar, netProjected, daysWithSales, pendingDays, pendingProfit, pendingSales };
  }, [daily, salesInv, trades, bills, pay, staffMeals, zeroByDay]);

  /* --------------------------------- actions -------------------------------- */
  const addBill = useCallback(async () => {
    if (!newLabel.trim()) return;
    const { error } = await supabase.from('opex_bills').insert({ month: monthKey, label: newLabel.trim(), amount: Number(newAmount) || 0 });
    if (error) { setErr(error.message); return; }
    setNewLabel(''); setNewAmount('');
    await load();
  }, [newLabel, newAmount, monthKey, load]);

  const updateBill = useCallback(async (id: number, amount: number) => {
    await supabase.from('opex_bills').update({ amount }).eq('id', id);
    await load();
  }, [load]);

  const deleteBill = useCallback(async (id: number) => {
    await supabase.from('opex_bills').delete().eq('id', id);
    await load();
  }, [load]);

  // Tick a bill as paid -> auto-stamps today's date (untick clears it).
  const updateBillPaid = useCallback(async (id: number, paid: boolean) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    await supabase.from('opex_bills').update({ paid, paid_date: paid ? todayIso : null }).eq('id', id);
    await load();
  }, [load]);

  const copyLastMonth = useCallback(async () => {
    const prev = new Date(year, month - 2, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const { data } = await supabase.from('opex_bills').select('label,amount').eq('month', prevKey);
    if (!data || !data.length) { setErr(`No bills saved for ${prevKey} to copy.`); return; }
    const { error } = await supabase.from('opex_bills').insert(data.map((b) => ({ month: monthKey, label: b.label, amount: b.amount })));
    if (error) setErr(error.message);
    await load();
  }, [year, month, monthKey, load]);

  const addTrade = useCallback(async () => {
    if (!newTrade.trim()) return;
    const { error } = await supabase.from('trade_customers').insert({ match: newTrade.trim() });
    if (error) { setErr(error.message); return; }
    setNewTrade('');
    await load();
  }, [newTrade, load]);

  const removeTrade = useCallback(async (id: number) => {
    await supabase.from('trade_customers').delete().eq('id', id);
    await load();
  }, [load]);

  const saveSetting = useCallback(async (key: string, value: number) => {
    await supabase.from('pnl_settings').upsert({ key, value: value as unknown as object }, { onConflict: 'key' });
  }, []);

  const prevMonth = () => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };
  const nextMonth = () => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1); };

  if (isAdmin === null) return <div className="text-sm text-ink-2">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  const c = calc;
  const onTargetProjected = c.netProjected - targetNet;
  // Staff-meal portions split into food vs drinks (drinks classified at parse time).
  const mealDrink = meals.reduce((s, m) => s + n(m.drink_count), 0);
  const mealFood = meals.reduce((s, m) => s + (m.item_count == null ? 0 : n(m.item_count) - n(m.drink_count)), 0);
  // Staff sales: mapped staff by total desc, "Unattributed" bucket (staff_email === null) pinned last.
  const staffRows = [...staffSales].sort((a, b) => {
    if ((a.staff_email === null) !== (b.staff_email === null)) return a.staff_email === null ? 1 : -1;
    return n(b.total) - n(a.total);
  });
  const staffSalesTotal = staffRows.reduce((s, r) => s + n(r.total), 0);
  const staffSalesInv = staffRows.reduce((s, r) => s + n(r.invoices), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">Profit &amp; Loss</h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-ink/5">◀</button>
          <span className="min-w-[130px] text-center text-sm font-semibold">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-ink/5">▶</button>
        </div>
      </div>

      {err && <div className="mb-3 rounded-md border border-rose-200 bg-bad-soft p-2 text-sm text-bad">{err}</div>}
      {loading ? <div className="text-sm text-ink-2">Loading…</div> : (
        <>
          {/* Tabs */}
          <div className="mb-4 flex gap-1 border-b border-line">
            {([['overview', 'Overview'], ['costs', 'Operating costs'], ['staff', 'Staff sales']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${tab === k ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-ink-2'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Staff sales — per-salesperson, matches each staff's own "My sales" */}
          {tab === 'staff' && (
            <div className="mb-4 rounded-card bg-card shadow-card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-2">Staff sales <span className="font-normal text-ink-3">· {MONTHS[month - 1]} {year} · matches each staff&rsquo;s own &ldquo;My sales&rdquo;</span></span>
                <span className="text-sm font-semibold">{rm(staffSalesTotal)}</span>
              </div>
              {staffRows.length === 0 ? (
                <div className="text-xs text-ink-3">No sales data for this month yet.</div>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto rounded border border-line">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-ink/[0.03] text-left text-ink-2">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">#</th>
                        <th className="px-3 py-1.5 font-semibold">Staff</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Invoices</th>
                        <th className="px-3 py-1.5 text-right font-semibold">Sales</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {staffRows.map((r, i) => (
                        <tr key={r.staff_email ?? '__unmapped__'} className={r.staff_email === null ? 'bg-ink/[0.03]' : ''}>
                          <td className="px-3 py-1.5 tabular-nums text-ink-3">{r.staff_email === null ? '·' : i + 1}</td>
                          <td className="px-3 py-1.5">
                            <div className={r.staff_email === null ? 'text-ink-2' : 'text-ink-2'}>{r.staff_name}</div>
                            {r.niagawan_names && <div className="text-xs text-ink-3">{r.niagawan_names}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{n(r.invoices)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-ink-2">{rm(n(r.total))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line font-semibold">
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5">Total</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{staffSalesInv}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{rm(staffSalesTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <div className="mt-2 text-xs text-ink-3">All invoices for the month, attributed by salesperson (Niagawan &ldquo;Delivery&rdquo; name → staff). &ldquo;Unattributed&rdquo; = invoices whose salesperson isn&rsquo;t in the mapping yet. This is total sales, not repair-only — it can differ from the Overview&rsquo;s &ldquo;Top mechanics&rdquo; (repair revenue only).</div>
            </div>
          )}

          {/* Verdict */}
          {tab === 'overview' && (<>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-card bg-card shadow-card p-3">
              <div className="text-xs font-medium text-ink-2">Net profit (so far) <span className="text-ink-3">(settled days only · full-month costs)</span></div>
              <div className={`mt-1 text-xl font-semibold ${c.netSoFar < 0 ? 'text-bad' : 'text-good'}`}>{rm(c.netSoFar)}</div>
            </div>
            <div className="rounded-card bg-card shadow-card p-3">
              <div className="text-xs font-medium text-ink-2">Projected net profit <span className="text-ink-3">(full month, at current pace)</span></div>
              <div className={`mt-1 text-xl font-semibold ${c.netProjected < 0 ? 'text-bad' : 'text-good'}`}>{rm(c.netProjected)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${onTargetProjected >= 0 ? 'border-emerald-300 bg-good-soft' : 'border-rose-300 bg-bad-soft'}`}>
              <div className="text-xs font-medium text-ink-2">Vs target {rm(targetNet)}</div>
              <div className={`mt-1 text-xl font-semibold ${onTargetProjected >= 0 ? 'text-good' : 'text-bad'}`}>{onTargetProjected >= 0 ? '+' : ''}{rm(onTargetProjected)}</div>
            </div>
          </div>

          {c.pendingDays > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-warn-soft px-3 py-2 text-xs text-warn">
              Not counted yet: <span className="font-semibold">{rm(c.pendingProfit)}</span> profit from {c.pendingDays} day{c.pendingDays === 1 ? '' : 's'} still settling (unpaid, or parts not priced yet). It&rsquo;s added automatically once those days are finalised — same rule as the Sales page.
            </div>
          )}

          {/* Sales */}
          <div className="mb-4 rounded-card bg-card shadow-card p-4">
            <div className="mb-2 text-sm font-semibold text-ink-2">Sales (month to date{c.pendingDays > 0 ? ` · ${c.pendingDays} day(s) still pending` : ''})</div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div><div className="text-xs text-ink-2">Repair sales</div><div className="font-semibold">{rm(c.repairSales)}</div></div>
              <div><div className="text-xs text-ink-2">Sold to other shops</div><div className="font-semibold text-ink-2">{rm(c.tradeSales)}</div></div>
              <div><div className="text-xs text-ink-2">Parts cost</div><div className="font-semibold">{rm(c.totalCogs)}</div></div>
              <div><div className="text-xs text-ink-2">Gross profit</div><div className="font-semibold">{rm(c.totalProfit)}</div></div>
              <div><div className="text-xs text-ink-2">Profit margin</div><div className="font-semibold">{c.margin.toFixed(0)}%</div></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm sm:grid-cols-5">
              <div><div className="text-xs text-ink-2">Car count</div><div className="font-semibold">{c.carCount}</div></div>
              <div><div className="text-xs text-ink-2">Average per car</div><div className="font-semibold">{rm(c.aro)}</div></div>
              <div className="col-span-2 sm:col-span-3">
                <div className="text-xs text-ink-2">Top mechanics (repair sales)</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {c.mechanics.slice(0, 5).map((m) => (
                    <span key={m.name} className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-2">{m.name}: {rm(m.total)} ({m.jobs})</span>
                  ))}
                  {c.mechanics.length === 0 && <span className="text-xs text-ink-3">per-invoice data fills in after the next sync</span>}
                </div>
              </div>
            </div>
          </div>
          </>)}

          {/* Payroll (auto) — Overview tab */}
          {tab === 'overview' && (
            <div className="mb-4 rounded-card bg-card shadow-card p-4">
              <div className="mb-2 text-sm font-semibold text-ink-2">Payroll (auto, from the Payroll module)</div>
              <div className="flex justify-between text-sm"><span className="text-ink-2">Salaries + bonus/allowance ({pay.length} staff)</span><span className="font-semibold">{rm(c.payrollGross)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-2">Employer EPF / SOCSO / EIS</span><span className="font-semibold">{rm(c.employer)}</span></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Payroll total</span><span>{rm(c.payrollGross + c.employer)}</span></div>
              {pay.length === 0 && <div className="mt-2 text-xs text-warn">No payroll generated for this month yet — costs are incomplete.</div>}
            </div>
          )}

          {/* Bills & others (manual) — Operating costs tab */}
          {tab === 'costs' && (
            <div className="mb-4 rounded-card bg-card shadow-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink-2">Bills &amp; others (manual)</span>
                {bills.length === 0 && <button onClick={copyLastMonth} className="rounded border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-ink/5">Copy last month</button>}
              </div>
              {bills.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={!!b.paid} onChange={(e) => updateBillPaid(b.id, e.target.checked)} title="Mark paid — stamps today's date" className="shrink-0 cursor-pointer" />
                  <span className={`min-w-0 flex-1 truncate ${b.paid ? 'text-ink-3 line-through' : 'text-ink-2'}`}>{b.label}</span>
                  {b.paid && b.paid_date && <span className="shrink-0 text-[11px] font-medium text-good">paid {fmtDate(b.paid_date)}</span>}
                  <input type="number" step="0.01" defaultValue={n(b.amount)} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== n(b.amount)) updateBill(b.id, v); }}
                    className="w-28 rounded border border-line px-1.5 py-0.5 text-right text-sm" />
                  <button onClick={() => deleteBill(b.id)} className="text-xs text-bad hover:text-bad">✕</button>
                </div>
              ))}
              <div className="mt-2 flex items-center gap-2">
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. SEWA" className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
                <input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" className="w-28 rounded border border-line px-2 py-1 text-right text-sm" />
                <button onClick={addBill} className="rounded bg-gray-900 px-2.5 py-1 text-sm font-medium text-white hover:bg-gray-700">Add</button>
              </div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Bills total</span><span>{rm(c.billsTotal)}</span></div>
              <div className="mt-1 text-xs text-ink-3">Bonus/commission is already inside Payroll — don&rsquo;t add it here again.</div>
            </div>
          )}

          {/* Staff meals — GrabFood, per-receipt breakdown — Operating costs tab */}
          {tab === 'costs' && (
          <div className="mb-4 rounded-card bg-card shadow-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-2">Staff meals — GrabFood <span className="font-normal text-ink-3">· {mealFood} food{mealDrink > 0 ? ` · ${mealDrink} drink` : ''} · {meals.length} order{meals.length === 1 ? '' : 's'} this month, auto from email receipts</span></span>
              <span className="text-sm font-semibold">{rm(c.staffMeals)}</span>
            </div>
            {meals.length === 0 ? (
              <div className="text-xs text-ink-3">No GrabFood receipts found for this month.</div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded border border-line">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-ink/[0.03] text-left text-ink-2">
                    <tr><th className="px-3 py-1.5 font-semibold">Date</th><th className="px-3 py-1.5 text-right font-semibold">Food</th><th className="px-3 py-1.5 text-right font-semibold">Drink</th><th className="px-3 py-1.5 text-right font-semibold">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {meals.map((mm, i) => {
                      const dr = n(mm.drink_count);
                      const fd = mm.item_count == null ? null : n(mm.item_count) - dr;
                      return (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-ink-2">{fmtDate(mm.meal_date)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{fd == null ? '—' : fd}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{dr > 0 ? dr : '·'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-ink-2">{rm(n(mm.amount))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line font-semibold">
                      <td className="px-3 py-1.5">Total</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{mealFood}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{mealDrink}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{rm(c.staffMeals)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
              <span className="text-sm font-medium text-sky-900">Top up the meal account</span>
              <span className="text-base font-bold text-sky-900">{rm(c.staffMeals)}</span>
            </div>
            <div className="mt-1 text-[11px] text-ink-3">Re-transfer this month&rsquo;s meal spend to replenish the Grab account.</div>
          </div>
          )}

          {/* Total operation cost — Operating costs tab */}
          {tab === 'costs' && (
            <div className="mb-4 rounded-card bg-card shadow-card p-4">
              <div className="mb-2 text-sm font-semibold text-ink-2">Total operation cost</div>
              <div className="flex justify-between text-sm"><span className="text-ink-2">Payroll (salaries + employer)</span><span className="font-semibold">{rm(c.payrollGross + c.employer)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-2">Bills &amp; others (manual)</span><span className="font-semibold">{rm(c.billsTotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-ink-2">Staff meals — GrabFood</span><span className="font-semibold">{rm(c.staffMeals)}</span></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total operation cost</span><span>{rm(c.costs)}</span></div>
            </div>
          )}

          {/* Summary + settings */}
          {tab === 'overview' && (
          <div className="mb-4 rounded-card bg-card shadow-card p-4 text-sm">
            <div className="grid grid-cols-1 gap-1 sm:max-w-md">
              <div className="flex justify-between"><span className="text-ink-2">Total operation cost</span><span className="font-semibold">{rm(c.costs)}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Gross profit (so far)</span><span className="font-semibold">{rm(c.totalProfit)}</span></div>
              <div className="flex justify-between border-t border-line pt-1"><span className="text-ink-2">Net profit (so far)</span><span className={`font-semibold ${c.netSoFar < 0 ? 'text-bad' : 'text-good'}`}>{rm(c.netSoFar)}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Putrajaya share ({ptjPct}% of projected net)</span><span className="font-semibold">{rm(Math.max(0, c.netProjected) * ptjPct / 100)}</span></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line pt-3 text-xs text-ink-2">
              <label className="flex items-center gap-1.5">Target net: RM
                <input type="number" defaultValue={targetNet} onBlur={(e) => { const v = Number(e.target.value) || 0; setTargetNet(v); saveSetting('target_net', v); }}
                  className="w-24 rounded border border-line px-1.5 py-0.5 text-right" />
              </label>
              <label className="flex items-center gap-1.5">Putrajaya share %:
                <input type="number" defaultValue={ptjPct} onBlur={(e) => { const v = Number(e.target.value) || 0; setPtjPct(v); saveSetting('putrajaya_pct', v); }}
                  className="w-16 rounded border border-line px-1.5 py-0.5 text-right" />
              </label>
            </div>
          </div>
          )}

          {/* Trade customers */}
          {tab === 'overview' && (
          <div className="rounded-card bg-card shadow-card p-4">
            <div className="mb-1 text-sm font-semibold text-ink-2">Trade customers (other workshops buying stock — excluded from repair KPIs)</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {trades.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2.5 py-0.5 text-sm text-ink-2">
                  {t.match}
                  <button onClick={() => removeTrade(t.id)} className="text-ink-3 hover:text-bad">✕</button>
                </span>
              ))}
              <input value={newTrade} onChange={(e) => setNewTrade(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTrade()}
                placeholder="add name…" className="w-32 rounded border border-line px-2 py-0.5 text-sm" />
              <button onClick={addTrade} className="rounded border border-line px-2 py-0.5 text-sm text-ink-2 hover:bg-ink/5">Add</button>
            </div>
            <div className="mt-1 text-xs text-ink-3">Invoices whose customer name contains any of these are counted as trade sales (pass-through), with their unpaid total tracked as trade debt.</div>
          </div>
          )}
        </>
      )}
    </div>
  );
}
