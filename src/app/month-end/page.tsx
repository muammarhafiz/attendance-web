'use client';
// src/app/month-end/page.tsx — the clerk's MONTHLY routine, by deadline:
//   By 25th  — pay all supplier invoices
//   By 28th  — fix any staff left as ABSENT (MC/off-days) so payroll is right
//   28–31    — payroll: transfer salaries + send payslips
// Clerk-safe except the salary detail, which is gated behind can_access('pay_salaries').
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import BackLink from '@/components/BackLink';

type Tick = { done: boolean; by: string | null; at: string | null };
type Dash = {
  error?: string;
  month: string;
  suppliers: { count: number; total: number | string; synced: string | null; list: { name: string; balance: number | string }[] };
  absents: { count: number; list: { name: string; day: string }[] };
  ticks: Record<string, Tick>;
};
type Salary = { email: string; name: string; net: number | string; bank_name: string | null; bank_acc_name: string | null; bank_acc_no: string | null; paid: boolean; paid_date: string | null };

const rm = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cleanSupplier = (name: string) => name.replace(/\s*\(\d{6,}.*$/, '').trim() || name;
const fmtD = (iso: string) => { const p = String(iso).split('-'); return p[2] && p[1] ? `${p[2]}/${p[1]}` : String(iso); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STEPS = [
  { key: 'suppliers_paid', when: 'By 25th', title: 'Pay suppliers', desc: 'Pay every supplier invoice.' },
  { key: 'fix_absent', when: 'By 28th', title: 'Fix MC / off-days', desc: 'No staff should be left ABSENT — absent is unpaid.' },
  { key: 'payroll', when: '28th–31st', title: 'Payroll', desc: 'Transfer salaries and send payslips.' },
] as const;

export default function MonthEndPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [canPay, setCanPay] = useState(false);
  const [salaries, setSalaries] = useState<Salary[]>([]);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const todayIso = today.toISOString().slice(0, 10);

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
    setLoading(true); setErr(null);
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

  const setSalaryPaid = useCallback(async (email: string, paid: boolean, date: string) => {
    setSalaries((prev) => prev.map((s) => (s.email === email ? { ...s, paid, paid_date: paid ? date : null } : s)));
    const { error } = await supabase.rpc('month_end_set_salary_paid', { p_month: monthKey, p_email: email, p_paid: paid, p_date: paid ? date : null });
    if (error) { setErr(error.message); load(); }
  }, [monthKey, load]);

  const prevMonth = () => { const dt = new Date(year, month - 2, 1); setYear(dt.getFullYear()); setMonth(dt.getMonth() + 1); };
  const nextMonth = () => { const dt = new Date(year, month, 1); setYear(dt.getFullYear()); setMonth(dt.getMonth() + 1); };

  if (allowed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for the office clerk, managers and the owner.</div>;

  const doneCount = STEPS.filter((s) => tickOf(s.key)).length;
  const allDone = doneCount === STEPS.length;
  const paidSalary = salaries.filter((s) => s.paid).length;
  const salaryTotal = salaries.reduce((s, r) => s + Number(r.net || 0), 0);

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
                  <button onClick={() => setTask(s.key, !done)} aria-label={`Mark ${s.title} ${done ? 'not done' : 'done'}`}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}>✓</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{s.when}</span>
                      <h2 className={`text-base font-semibold ${done ? 'text-emerald-800' : 'text-gray-900'}`}>{s.title}</h2>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600">{s.desc}</p>

                    {/* By 25 — suppliers owed */}
                    {s.key === 'suppliers_paid' && (
                      <div className="mt-2">
                        {d.suppliers.count > 0 ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="mb-1 text-sm font-medium text-amber-900">You still owe {rm(d.suppliers.total)} to {d.suppliers.count} supplier{d.suppliers.count === 1 ? '' : 's'}:</div>
                            <ul className="space-y-0.5 text-sm text-amber-800">
                              {d.suppliers.list.map((s2) => (
                                <li key={s2.name} className="flex justify-between gap-2">
                                  <span className="min-w-0 truncate">{cleanSupplier(s2.name)}</span>
                                  <span className="shrink-0 font-semibold">{rm(s2.balance)}</span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[11px] text-amber-700/80">Balances refresh after the supplier sync.</p>
                          </div>
                        ) : <p className="text-sm text-emerald-700">All suppliers paid ✓</p>}
                      </div>
                    )}

                    {/* By 28 — absents to fix */}
                    {s.key === 'fix_absent' && (
                      <div className="mt-2">
                        {d.absents.count > 0 ? (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-amber-900">{d.absents.count} ABSENT day{d.absents.count === 1 ? '' : 's'} to fix:</span>
                              <Link href="/attendance/checkin" className="shrink-0 text-xs font-medium text-blue-600 hover:underline">Attendance →</Link>
                            </div>
                            <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm text-amber-800">
                              {d.absents.list.map((a, i) => (
                                <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate">{a.name}</span><span className="shrink-0">{fmtD(a.day)}</span></li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[11px] text-amber-700/80">Approve their MC / off-day (or fix in attendance) so they aren&rsquo;t paid as absent.</p>
                          </div>
                        ) : <p className="text-sm text-emerald-700">No one left as absent ✓</p>}
                      </div>
                    )}

                    {/* 28-31 — payroll (salary detail is gated) */}
                    {s.key === 'payroll' && canPay && (
                      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-700">Pay salaries</span>
                          {salaries.length > 0 && <span className="text-xs text-gray-400">{paidSalary}/{salaries.length} paid</span>}
                        </div>
                        {salaries.length === 0 ? (
                          <p className="text-xs text-gray-400">No payroll generated for this month yet.</p>
                        ) : (
                          <>
                            {salaries.map((sal) => (
                              <div key={sal.email} className="border-b border-gray-50 py-2 last:border-0">
                                <div className="flex items-start gap-2">
                                  <button onClick={() => setSalaryPaid(sal.email, !sal.paid, todayIso)} aria-label={`Mark ${sal.name} ${sal.paid ? 'unpaid' : 'paid'}`}
                                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[10px] font-bold transition ${sal.paid ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}>✓</button>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className={`min-w-0 truncate text-sm font-medium ${sal.paid ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{sal.name}</span>
                                      <span className={`shrink-0 text-sm font-semibold ${sal.paid ? 'text-gray-400' : 'text-gray-900'}`}>{rm(sal.net)}</span>
                                    </div>
                                    <div className="font-mono text-xs text-gray-500">{sal.bank_name || 'no bank'} · {sal.bank_acc_no || 'no account'}{sal.bank_acc_name ? ` · ${sal.bank_acc_name}` : ''}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold"><span>Total</span><span>{rm(salaryTotal)}</span></div>
                            <p className="mt-1 text-[11px] text-gray-400">Amounts are confidential — keep the screen private. Send payslips from the Payroll page.</p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
