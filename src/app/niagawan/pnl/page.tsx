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
type Bill = { id: number; month: string; label: string; amount: number | string };
type Pay = { staff_name: string; total_earn: number | string; epf_er: number | string | null; socso_er: number | string | null; eis_er: number | string | null };
type Meal = { meal_date: string; amount: number | string; restaurant: string | null };

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
  const [targetNet, setTargetNet] = useState(50000);
  const [ptjPct, setPtjPct] = useState(5);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newTrade, setNewTrade] = useState('');

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const firstDay = `${monthKey}-01`;
  const lastDay = `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  useEffect(() => {
    (async () => { const { data } = await supabase.rpc('is_admin'); setIsAdmin(data === true); })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, s, t, b, p, st, g, ml] = await Promise.all([
      supabase.from('niagawan_daily').select('day,invoices,sales,cogs,profit,unpaid_count').gte('day', firstDay).lte('day', lastDay).order('day'),
      supabase.from('niagawan_sale_inv').select('inv,day,customer,amount,status,staff').gte('day', firstDay).lte('day', lastDay),
      supabase.from('trade_customers').select('*').order('match'),
      supabase.from('opex_bills').select('*').eq('month', monthKey).order('id'),
      supabase.from('v_payslip_admin_summary_v2').select('staff_name,total_earn,epf_er,socso_er,eis_er').eq('year', year).eq('month', month),
      supabase.from('pnl_settings').select('*'),
      supabase.rpc('grab_meals_month_total', { p_month: monthKey }),
      supabase.from('grab_meals').select('meal_date,amount,restaurant').gte('meal_date', firstDay).lte('meal_date', lastDay).order('meal_date', { ascending: true }),
    ]);
    if (d.error) setErr(d.error.message); else setErr(null);
    setDaily((d.data ?? []) as Daily[]);
    setSalesInv((s.data ?? []) as SaleInv[]);
    setTrades((t.data ?? []) as Trade[]);
    setBills((b.data ?? []) as Bill[]);
    setPay((p.data ?? []) as Pay[]);
    setStaffMeals(n(g.data) || 0);
    setMeals((ml.data ?? []) as Meal[]);
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
    const totalSales = daily.reduce((s, r) => s + n(r.sales), 0);
    const totalCogs = daily.reduce((s, r) => s + n(r.cogs), 0);
    const totalProfit = daily.reduce((s, r) => s + n(r.profit), 0);
    const tradeRows = salesInv.filter((r) => isTrade(r.customer));
    const repairRows = salesInv.filter((r) => !isTrade(r.customer));
    const tradeSales = tradeRows.reduce((s, r) => s + n(r.amount), 0);
    const repairSales = Math.max(0, totalSales - tradeSales);
    const carCount = repairRows.length || daily.reduce((s, r) => s + (r.invoices || 0), 0);
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
    // pace: profit per day with sales, projected over 26 working days
    const daysWithSales = daily.filter((r) => n(r.sales) > 0).length;
    const projProfit = daysWithSales > 0 ? (totalProfit / daysWithSales) * 26 : 0;
    const netSoFar = totalProfit - costs;
    const netProjected = projProfit - costs;
    const pendingDays = daily.filter((r) => (r.unpaid_count ?? 0) > 0).length;
    return { totalSales, totalCogs, totalProfit, tradeSales, tradeRows, repairSales, carCount, aro, margin, mechanics, payrollGross, employer, billsTotal, staffMeals, costs, netSoFar, netProjected, daysWithSales, pendingDays };
  }, [daily, salesInv, trades, bills, pay, staffMeals]);

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

  if (isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  const c = calc;
  const onTargetProjected = c.netProjected - targetNet;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Profit &amp; Loss</h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-gray-50">◀</button>
          <span className="min-w-[130px] text-center text-sm font-semibold">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-gray-50">▶</button>
        </div>
      </div>

      {err && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{err}</div>}
      {loading ? <div className="text-sm text-gray-500">Loading…</div> : (
        <>
          {/* Verdict */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs font-medium text-gray-500">Net so far <span className="text-gray-400">(full-month costs vs {c.daysWithSales} day(s) of profit)</span></div>
              <div className={`mt-1 text-xl font-semibold ${c.netSoFar < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{rm(c.netSoFar)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs font-medium text-gray-500">Projected month-end <span className="text-gray-400">(at current pace, 26 working days)</span></div>
              <div className={`mt-1 text-xl font-semibold ${c.netProjected < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{rm(c.netProjected)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${onTargetProjected >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
              <div className="text-xs font-medium text-gray-600">Vs target {rm(targetNet)}</div>
              <div className={`mt-1 text-xl font-semibold ${onTargetProjected >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{onTargetProjected >= 0 ? '+' : ''}{rm(onTargetProjected)}</div>
            </div>
          </div>

          {/* Sales */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-gray-700">Sales (month to date{c.pendingDays > 0 ? ` · ${c.pendingDays} day(s) still pending` : ''})</div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div><div className="text-xs text-gray-500">Repair sales</div><div className="font-semibold">{rm(c.repairSales)}</div></div>
              <div><div className="text-xs text-gray-500">Trade sales (pass-through)</div><div className="font-semibold text-gray-600">{rm(c.tradeSales)}</div></div>
              <div><div className="text-xs text-gray-500">COGS</div><div className="font-semibold">{rm(c.totalCogs)}</div></div>
              <div><div className="text-xs text-gray-500">Sale profit</div><div className="font-semibold">{rm(c.totalProfit)}</div></div>
              <div><div className="text-xs text-gray-500">Margin (on repair)</div><div className="font-semibold">{c.margin.toFixed(0)}%</div></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-sm sm:grid-cols-5">
              <div><div className="text-xs text-gray-500">Car count</div><div className="font-semibold">{c.carCount}</div></div>
              <div><div className="text-xs text-gray-500">Avg per job (ARO)</div><div className="font-semibold">{rm(c.aro)}</div></div>
              <div className="col-span-2 sm:col-span-3">
                <div className="text-xs text-gray-500">Top mechanics (repair revenue)</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {c.mechanics.slice(0, 5).map((m) => (
                    <span key={m.name} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{m.name}: {rm(m.total)} ({m.jobs})</span>
                  ))}
                  {c.mechanics.length === 0 && <span className="text-xs text-gray-400">per-invoice data fills in after the next sync</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Costs */}
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-700">Payroll (auto, from the Payroll module)</div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Salaries + bonus/allowance ({pay.length} staff)</span><span className="font-semibold">{rm(c.payrollGross)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Employer EPF / SOCSO / EIS</span><span className="font-semibold">{rm(c.employer)}</span></div>
              <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold"><span>Payroll total</span><span>{rm(c.payrollGross + c.employer)}</span></div>
              {pay.length === 0 && <div className="mt-2 text-xs text-amber-600">No payroll generated for this month yet — costs are incomplete.</div>}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Bills &amp; others (manual)</span>
                {bills.length === 0 && <button onClick={copyLastMonth} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">Copy last month</button>}
              </div>
              {bills.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-700">{b.label}</span>
                  <input type="number" step="0.01" defaultValue={n(b.amount)} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== n(b.amount)) updateBill(b.id, v); }}
                    className="w-28 rounded border border-gray-200 px-1.5 py-0.5 text-right text-sm" />
                  <button onClick={() => deleteBill(b.id)} className="text-xs text-rose-400 hover:text-rose-600">✕</button>
                </div>
              ))}
              <div className="mt-2 flex items-center gap-2">
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. SEWA" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
                <input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" className="w-28 rounded border border-gray-300 px-2 py-1 text-right text-sm" />
                <button onClick={addBill} className="rounded bg-gray-900 px-2.5 py-1 text-sm font-medium text-white hover:bg-gray-700">Add</button>
              </div>
              <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold"><span>Bills total</span><span>{rm(c.billsTotal)}</span></div>
              <div className="mt-1.5 flex justify-between text-sm">
                <span className="text-gray-600">Staff meals — GrabFood <span className="text-gray-400">· auto from email receipts</span></span>
                <span className="font-semibold">{rm(c.staffMeals)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">Bonus/commission is already inside Payroll — don&rsquo;t add it here again.</div>
            </div>
          </div>

          {/* Staff meals — GrabFood, per-receipt breakdown */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Staff meals — GrabFood <span className="font-normal text-gray-400">· {meals.length} order{meals.length === 1 ? '' : 's'} this month, auto from email receipts</span></span>
              <span className="text-sm font-semibold">{rm(c.staffMeals)}</span>
            </div>
            {meals.length === 0 ? (
              <div className="text-xs text-gray-400">No GrabFood receipts found for this month.</div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                    <tr><th className="px-3 py-1.5 font-semibold">Date</th><th className="px-3 py-1.5 text-right font-semibold">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {meals.map((mm, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5">
                          <div className="text-gray-800">{fmtDate(mm.meal_date)}</div>
                          {mm.restaurant && <div className="max-w-[18rem] truncate text-xs text-gray-400">{mm.restaurant}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{rm(n(mm.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="px-3 py-1.5">Total</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{rm(c.staffMeals)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Summary + settings */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
            <div className="grid grid-cols-1 gap-1 sm:max-w-md">
              <div className="flex justify-between"><span className="text-gray-600">Total operation cost</span><span className="font-semibold">{rm(c.costs)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Sale profit (so far)</span><span className="font-semibold">{rm(c.totalProfit)}</span></div>
              <div className="flex justify-between border-t border-gray-100 pt-1"><span className="text-gray-600">Net (so far)</span><span className={`font-semibold ${c.netSoFar < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{rm(c.netSoFar)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Putrajaya share ({ptjPct}% of projected net)</span><span className="font-semibold">{rm(Math.max(0, c.netProjected) * ptjPct / 100)}</span></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
              <label className="flex items-center gap-1.5">Target net: RM
                <input type="number" defaultValue={targetNet} onBlur={(e) => { const v = Number(e.target.value) || 0; setTargetNet(v); saveSetting('target_net', v); }}
                  className="w-24 rounded border border-gray-200 px-1.5 py-0.5 text-right" />
              </label>
              <label className="flex items-center gap-1.5">Putrajaya share %:
                <input type="number" defaultValue={ptjPct} onBlur={(e) => { const v = Number(e.target.value) || 0; setPtjPct(v); saveSetting('putrajaya_pct', v); }}
                  className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right" />
              </label>
            </div>
          </div>

          {/* Trade customers */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-1 text-sm font-semibold text-gray-700">Trade customers (other workshops buying stock — excluded from repair KPIs)</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {trades.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-sm text-gray-700">
                  {t.match}
                  <button onClick={() => removeTrade(t.id)} className="text-gray-400 hover:text-rose-500">✕</button>
                </span>
              ))}
              <input value={newTrade} onChange={(e) => setNewTrade(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTrade()}
                placeholder="add name…" className="w-32 rounded border border-gray-300 px-2 py-0.5 text-sm" />
              <button onClick={addTrade} className="rounded border border-gray-300 px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-50">Add</button>
            </div>
            <div className="mt-1 text-xs text-gray-400">Invoices whose customer name contains any of these are counted as trade sales (pass-through), with their unpaid total tracked as trade debt.</div>
          </div>
        </>
      )}
    </div>
  );
}
