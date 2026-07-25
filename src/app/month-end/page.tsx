'use client';
// src/app/month-end/page.tsx — clerk's end-of-month routine. A simple checklist: the clerk works
// through 4 steps and ticks each off. No profit/salary shown (clerk-safe). Data + ticks come from
// month_end_status() / month_end_set_task(); bills are keyed here via the gated bill RPCs.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import BackLink from '@/components/BackLink';

type Tick = { done: boolean; by: string | null; at: string | null };
type Dash = {
  error?: string;
  month: string;
  not_final_days: { day: string; unpaid: number; no_cost: number }[];
  unpaid: { inv: string; customer: string | null; balance: number | string }[];
  bills: { id: number; label: string; amount: number | string; paid: boolean; paid_date: string | null }[];
  ticks: Record<string, Tick>;
};
type Salary = { email: string; name: string; net: number | string; bank_name: string | null; bank_acc_name: string | null; bank_acc_no: string | null; paid: boolean; paid_date: string | null };

const rm = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string) => { const p = String(iso).split('-'); return p[2] && p[1] ? `${p[2]}/${p[1]}` : String(iso); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STEPS = [
  { key: 'clear_days', n: 1, title: 'Clear every day', desc: 'No day should still have unpaid invoices or parts without a cost.' },
  { key: 'key_bills', n: 2, title: 'Key in the bills', desc: 'Enter the month’s bills — rent, utilities, makan, etc.' },
  { key: 'cash_count', n: 3, title: 'Cash count', desc: 'Count and reconcile the cash for the month.' },
  { key: 'stock_check', n: 4, title: 'Stock check', desc: 'Do a stock count and update the quantities in Niagawan.' },
] as const;

export default function MonthEndPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [canPay, setCanPay] = useState(false);      // pay_salaries feature (Office clerk + Owner)
  const [salaries, setSalaries] = useState<Salary[]>([]);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  useEffect(() => {
    (async () => {
      const [me, pay] = await Promise.all([
        supabase.rpc('can_access', { p_feature: 'month_end' }),
        supabase.rpc('can_access', { p_feature: 'pay_salaries' }),
      ]);
      setAllowed(me.data === true);
      setCanPay(pay.data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data } = await supabase.rpc('month_end_status', { p_month: monthKey });
    setD((data ?? null) as Dash);
    if (canPay) {
      const { data: sal } = await supabase.rpc('month_end_salaries', { p_month: monthKey });
      setSalaries((sal ?? []) as Salary[]);
    }
    setLoading(false);
  }, [monthKey, canPay]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const tickOf = (step: string) => !!d?.ticks?.[step]?.done;

  const setTask = useCallback(async (step: string, done: boolean) => {
    setD((prev) => (prev ? { ...prev, ticks: { ...prev.ticks, [step]: { done, by: null, at: null } } } : prev));
    const { error } = await supabase.rpc('month_end_set_task', { p_month: monthKey, p_step: step, p_done: done });
    if (error) { setErr(error.message); load(); }
  }, [monthKey, load]);

  const addBill = useCallback(async () => {
    if (!newLabel.trim()) return;
    const amt = Number(newAmount);
    if (newAmount.trim() !== '' && (!Number.isFinite(amt) || amt < 0)) { setErr('Enter a valid amount.'); return; }
    const { error } = await supabase.rpc('month_end_add_bill', { p_month: monthKey, p_label: newLabel.trim(), p_amount: Number.isFinite(amt) ? amt : 0 });
    if (error) { setErr(error.message); return; }
    setNewLabel(''); setNewAmount(''); await load();
  }, [newLabel, newAmount, monthKey, load]);

  const delBill = useCallback(async (id: number) => {
    const { error } = await supabase.rpc('month_end_delete_bill', { p_id: id });
    if (error) { setErr(error.message); return; }
    await load();
  }, [load]);

  const setBillPaid = useCallback(async (id: number, paid: boolean, date: string) => {
    setD((prev) => (prev ? { ...prev, bills: prev.bills.map((b) => (b.id === id ? { ...b, paid, paid_date: paid ? date : null } : b)) } : prev));
    const { error } = await supabase.rpc('month_end_set_bill_paid', { p_id: id, p_paid: paid, p_date: paid ? date : null });
    if (error) { setErr(error.message); load(); }
  }, [load]);

  const setSalaryPaid = useCallback(async (email: string, paid: boolean, date: string) => {
    setSalaries((prev) => prev.map((s) => (s.email === email ? { ...s, paid, paid_date: paid ? date : null } : s)));
    const { error } = await supabase.rpc('month_end_set_salary_paid', { p_month: monthKey, p_email: email, p_paid: paid, p_date: paid ? date : null });
    if (error) { setErr(error.message); load(); }
  }, [monthKey, load]);

  const prevMonth = () => { const dt = new Date(year, month - 2, 1); setYear(dt.getFullYear()); setMonth(dt.getMonth() + 1); };
  const nextMonth = () => { const dt = new Date(year, month, 1); setYear(dt.getFullYear()); setMonth(dt.getMonth() + 1); };

  if (allowed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for the office clerk, managers and the owner.</div>;

  const blockers = d?.not_final_days ?? [];
  const unpaid = d?.unpaid ?? [];
  const bills = d?.bills ?? [];
  const billsTotal = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
  const paidCount = bills.filter((b) => b.paid).length;
  const todayIso = today.toISOString().slice(0, 10);
  const paidSalaryCount = salaries.filter((s) => s.paid).length;
  const salaryTotal = salaries.reduce((sum, r) => sum + Number(r.net || 0), 0);
  const doneCount = STEPS.filter((s) => tickOf(s.key)).length;
  const allDone = doneCount === STEPS.length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <BackLink />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">🗓️ End of month</h1>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-gray-50">◀</button>
          <span className="min-w-[120px] text-center text-sm font-semibold">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-md border px-2.5 py-1.5 text-sm hover:bg-gray-50">▶</button>
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-500">Work through the steps and tick each one. Tap <button onClick={load} className="font-medium text-blue-600 underline">Check again</button> after you fix things in Niagawan.</p>

      {/* progress */}
      <div className={`mt-4 rounded-xl border px-4 py-3 ${allDone ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">{allDone ? '🎉 Month-end done!' : `${doneCount} of ${STEPS.length} done`}</span>
          <span className="text-xs text-gray-400">{MONTHS[month - 1]} {year}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {err && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
      {loading && <div className="mt-4 text-sm text-gray-400">Loading…</div>}

      {!loading && d && (
        <div className="mt-4 space-y-3">
          {STEPS.map((s) => {
            const done = tickOf(s.key);
            return (
              <div key={s.key} className={`rounded-xl border p-4 ${done ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setTask(s.key, !done)}
                    aria-label={`Mark ${s.title} ${done ? 'not done' : 'done'}`}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}
                  >✓</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400">STEP {s.n}</span>
                      <h2 className={`text-base font-semibold ${done ? 'text-emerald-800' : 'text-gray-900'}`}>{s.title}</h2>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600">{s.desc}</p>

                    {/* STEP 1 — clear every day */}
                    {s.key === 'clear_days' && (
                      <div className="mt-2">
                        {blockers.length === 0 ? (
                          <p className="text-sm font-medium text-emerald-700">All days are settled ✓</p>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-medium text-amber-900">{blockers.length} day{blockers.length === 1 ? '' : 's'} still need fixing in Niagawan:</p>
                            <ul className="mt-1 space-y-0.5 text-sm text-amber-800">
                              {blockers.map((b) => (
                                <li key={b.day}>
                                  <span className="font-semibold">{fmtDay(b.day)}</span> —{' '}
                                  {b.no_cost > 0 && `${b.no_cost} part${b.no_cost === 1 ? '' : 's'} with no cost`}
                                  {b.no_cost > 0 && b.unpaid > 0 ? ' · ' : ''}
                                  {b.unpaid > 0 && `${b.unpaid} unpaid`}
                                </li>
                              ))}
                            </ul>
                            {unpaid.length > 0 && (
                              <div className="mt-2 border-t border-amber-200 pt-2">
                                <p className="text-xs font-medium text-amber-900">Unpaid invoices to chase:</p>
                                <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-amber-800">
                                  {unpaid.map((u) => (
                                    <li key={u.inv} className="flex justify-between gap-2">
                                      <span className="min-w-0 truncate">{u.inv} · {u.customer || '—'}</span>
                                      <span className="shrink-0 font-semibold">{rm(u.balance)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <p className="mt-2 text-[11px] text-amber-700/80">Fix these in Niagawan (key the part costs, settle/carry the unpaid), then tap <span className="font-medium">Check again</span>. This list refreshes after Niagawan syncs.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* STEP 2 — bills */}
                    {s.key === 'key_bills' && (
                      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
                        {bills.map((b) => (
                          <div key={b.id} className="border-b border-gray-50 py-1 last:border-0">
                            <div className="flex items-center gap-2 text-sm">
                              <button
                                onClick={() => setBillPaid(b.id, !b.paid, todayIso)}
                                aria-label={`Mark ${b.label} ${b.paid ? 'unpaid' : 'paid'}`}
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[10px] font-bold transition ${b.paid ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}
                              >✓</button>
                              <span className={`min-w-0 flex-1 truncate ${b.paid ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{b.label}</span>
                              <span className={`shrink-0 font-medium ${b.paid ? 'text-gray-400' : 'text-gray-800'}`}>{rm(b.amount)}</span>
                              <button onClick={() => delBill(b.id)} className="shrink-0 text-xs text-rose-400 hover:text-rose-600">✕</button>
                            </div>
                            {b.paid && (
                              <div className="ml-7 mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700">
                                Paid on
                                <input type="date" value={b.paid_date ?? todayIso} onChange={(e) => setBillPaid(b.id, true, e.target.value)}
                                  className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
                              </div>
                            )}
                          </div>
                        ))}
                        {bills.length === 0 && <p className="text-xs text-gray-400">No bills keyed yet for this month.</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. SEWA" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
                          <input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} type="number" inputMode="decimal" step="0.01" placeholder="0.00" className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm" />
                          <button onClick={addBill} className="shrink-0 rounded bg-gray-900 px-2.5 py-1 text-sm font-medium text-white hover:bg-gray-700">Add</button>
                        </div>
                        {bills.length > 0 && <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold"><span>Total <span className="font-normal text-gray-400">· {paidCount}/{bills.length} paid</span></span><span>{rm(billsTotal)}</span></div>}
                      </div>
                    )}

                    {/* STEP 3 — cash count */}
                    {s.key === 'cash_count' && (
                      <Link href="/cash-count" className="mt-2 inline-flex items-center gap-1 rounded-lg border border-blue-600 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
                        Open cash count →
                      </Link>
                    )}

                    {/* STEP 4 — stock check */}
                    {s.key === 'stock_check' && (
                      <p className="mt-2 text-xs text-gray-400">Count the stock on the shelf and update the quantities in Niagawan, then tick this off.</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {canPay && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">💰</span>
                <h2 className="text-base font-semibold text-gray-900">Pay salaries</h2>
                {salaries.length > 0 && <span className="ml-auto text-xs text-gray-400">{paidSalaryCount}/{salaries.length} paid</span>}
              </div>
              <p className="mt-0.5 text-sm text-gray-600">Transfer each staff their pay, then tick them off. Amounts are confidential — keep the screen private.</p>
              {salaries.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">No payroll generated for this month yet.</p>
              ) : (
                <div className="mt-2">
                  {salaries.map((s) => (
                    <div key={s.email} className="border-b border-gray-50 py-2 last:border-0">
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => setSalaryPaid(s.email, !s.paid, todayIso)}
                          aria-label={`Mark ${s.name} ${s.paid ? 'unpaid' : 'paid'}`}
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[10px] font-bold transition ${s.paid ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}
                        >✓</button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`min-w-0 truncate text-sm font-medium ${s.paid ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.name}</span>
                            <span className={`shrink-0 text-sm font-semibold ${s.paid ? 'text-gray-400' : 'text-gray-900'}`}>{rm(s.net)}</span>
                          </div>
                          <div className="font-mono text-xs text-gray-500">{s.bank_name || 'no bank'} · {s.bank_acc_no || 'no account'}{s.bank_acc_name ? ` · ${s.bank_acc_name}` : ''}</div>
                          {s.paid && (
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700">
                              Paid on
                              <input type="date" value={s.paid_date ?? todayIso} onChange={(e) => setSalaryPaid(s.email, true, e.target.value)} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold"><span>Total</span><span>{rm(salaryTotal)}</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
