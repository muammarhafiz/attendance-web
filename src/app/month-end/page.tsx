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
import { Icon } from '@/components/icons';

type Tick = { done: boolean; by: string | null; at: string | null };
type Dash = {
  error?: string;
  month: string;
  suppliers: { count: number; total: number | string; synced: string | null; list: { name: string; balance: number | string }[] };
  absents: { count: number; list: { name: string; email?: string; day: string }[] };
  bills: { id: number; label: string; amount: number | string; paid: boolean; paid_date: string | null }[];
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
  const [newBillLabel, setNewBillLabel] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');
  // Inline "fix a day" on the absent card (admin-only, mirrors the Attendance report editor).
  const [canFix, setCanFix] = useState(false);
  const [me, setMe] = useState('');
  const [locked, setLocked] = useState(false); // this month's payroll period is LOCKED/FINALIZED
  const [editKey, setEditKey] = useState<string | null>(null); // `${email}|${day}` being fixed
  const [eStatus, setEStatus] = useState(''); // '', WORKING, OFFDAY, MC
  const [eIn, setEIn] = useState('');
  const [eOut, setEOut] = useState('');
  const [eNote, setENote] = useState('');
  const [eCert, setECert] = useState<File | null>(null);
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const todayIso = today.toISOString().slice(0, 10);

  useEffect(() => {
    (async () => {
      const [ma, pay, fix, sess] = await Promise.all([
        supabase.rpc('can_access', { p_feature: 'month_end' }),
        supabase.rpc('can_access', { p_feature: 'pay_salaries' }),
        supabase.rpc('is_admin'), // inline attendance edits require admin (day_status/recompute RLS)
        supabase.auth.getSession(),
      ]);
      setAllowed(ma.data === true);
      setCanPay(pay.data === true);
      setCanFix(fix.data === true);
      setMe(sess.data.session?.user?.email ?? '');
    })();
  }, []);

  // Is this month's payroll already locked? If so, block inline attendance edits (they'd desync a paid month).
  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const { data } = await supabase.from('v_periods_min').select('status').eq('year', year).eq('month', month).maybeSingle();
      const st = (data as { status?: string } | null)?.status;
      setLocked(st === 'LOCKED' || st === 'FINALIZED');
    })();
  }, [allowed, year, month]);

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

  // Auto-refresh when the user comes back to this tab/page (e.g. after fixing attendance on the
  // report page) so the "Fix MC / off-days" card never shows stale data.
  useEffect(() => {
    if (!allowed) return;
    const refetch = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => { window.removeEventListener('focus', refetch); document.removeEventListener('visibilitychange', refetch); };
  }, [allowed, load]);

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

  // Bills (operating cost) — via gated month_end RPCs so the clerk never needs direct finance access.
  const billAdd = useCallback(async () => {
    const label = newBillLabel.trim();
    if (!label) return;
    const { error } = await supabase.rpc('month_end_add_bill', { p_month: monthKey, p_label: label, p_amount: Number(newBillAmount) || 0 });
    if (error) { setErr(error.message); return; }
    setNewBillLabel(''); setNewBillAmount(''); await load();
  }, [newBillLabel, newBillAmount, monthKey, load]);
  const billSetPaid = useCallback(async (id: number, paid: boolean) => {
    const { error } = await supabase.rpc('month_end_set_bill_paid', { p_id: id, p_paid: paid, p_date: paid ? todayIso : null });
    if (error) setErr(error.message);
    await load();
  }, [todayIso, load]);
  const billSetAmount = useCallback(async (id: number, amount: number) => {
    const { error } = await supabase.rpc('month_end_update_bill', { p_id: id, p_amount: amount });
    if (error) setErr(error.message);
    await load();
  }, [load]);
  const billDelete = useCallback(async (id: number) => {
    const { error } = await supabase.rpc('month_end_delete_bill', { p_id: id });
    if (error) setErr(error.message);
    await load();
  }, [load]);

  // --- Inline fix a single absent day (Present / Off day / MC) — mirrors the Attendance report editor ---
  const startFix = useCallback((email: string, day: string) => {
    setEditKey(`${email}|${day}`); setEStatus(''); setEIn(''); setEOut(''); setENote(''); setECert(null);
  }, []);
  const cancelFix = useCallback(() => setEditKey(null), []);
  const saveRow = useCallback(async (email: string, day: string) => {
    setErr(null);
    if (!eStatus) { setErr('Choose what the day should be.'); return; }
    if (eStatus === 'WORKING' && !eIn) { setErr('Enter a check-in time to mark the day present.'); return; }
    setSavingRow(`${email}|${day}`);
    try {
      if (eStatus === 'WORKING') {
        // Present with keyed times: clear any status override, then set the manual check-in/out.
        await supabase.rpc('clear_day_half', { p_email: email, p_day: day });
        await supabase.from('day_status').delete().eq('day', day).eq('staff_email', email);
        const { error } = await supabase.from('day_time_override').upsert(
          { day, staff_email: email, check_in_kl: eIn, check_out_kl: eOut || null, note: eNote || null },
          { onConflict: 'day,staff_email' });
        if (error) throw error;
      } else {
        // OFFDAY / MC — paid leave; mark paid so an over-quota day isn't docked.
        await supabase.rpc('clear_day_half', { p_email: email, p_day: day });
        const { error } = await supabase.rpc('set_day_status', { p_email: email, p_day: day, p_status: eStatus, p_note: eNote || null });
        if (error) throw error;
        await supabase.rpc('set_day_pay', { p_email: email, p_day: day, p_paid: true });
      }
      await supabase.rpc('attendance_v2_recompute', { p_from: day, p_to: day });
      if (eStatus === 'MC' && eCert) {
        const ext = (eCert.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${email}/doc_${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from('mc').upload(path, eCert, { upsert: false });
        if (up.error) throw up.error;
        await supabase.from('attendance_doc_requests').delete().eq('staff_email', email).eq('day', day);
        await supabase.from('attendance_doc_requests').insert({ staff_email: email, day, label: 'MC', doc_path: path, required_by: me || null, uploaded_at: new Date().toISOString() });
      }
      setEditKey(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRow(null);
    }
  }, [eStatus, eIn, eOut, eNote, eCert, me, load]);

  const prevMonth = () => { const dt = new Date(year, month - 2, 1); setYear(dt.getFullYear()); setMonth(dt.getMonth() + 1); };
  const nextMonth = () => { const dt = new Date(year, month, 1); setYear(dt.getFullYear()); setMonth(dt.getMonth() + 1); };

  if (allowed === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for the office clerk, managers and the owner.</div>;

  const doneCount = STEPS.filter((s) => tickOf(s.key)).length;
  const allDone = doneCount === STEPS.length;
  const paidSalary = salaries.filter((s) => s.paid).length;
  const salaryTotal = salaries.reduce((s, r) => s + Number(r.net || 0), 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <BackLink href="/office" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">End of month</h1>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">◀</button>
          <span className="min-w-[120px] text-center text-sm font-semibold">{MONTHS[month - 1]} {year}</span>
          <button onClick={nextMonth} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5">▶</button>
          <button onClick={load} disabled={loading} title="Reload the latest — tap after fixing attendance"
            className="ml-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-50">{loading ? '…' : '↻'}</button>
        </div>
      </div>

      <div className={`mt-4 rounded-card px-4 py-3 shadow-card ${allDone ? 'bg-good-soft' : 'bg-card'}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-2">{allDone ? 'Month-end done!' : `${doneCount} of ${STEPS.length} done`}</span>
          <span className="text-xs text-ink-3">{MONTHS[month - 1]} {year}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/5">
          <div className="h-full rounded-full bg-good transition-all" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {err && <div className="mt-3 rounded-lg border border-rose-200 bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}
      {loading && <div className="mt-4 text-sm text-ink-3">Loading…</div>}

      {!loading && d && (
        <div className="mt-4 space-y-3">
          {STEPS.map((s) => {
            const done = tickOf(s.key);
            return (
              <div key={s.key} className={`rounded-card p-4 shadow-card ${done ? 'bg-good-soft' : 'bg-card'}`}>
                <div className="flex items-start gap-3">
                  <button onClick={() => setTask(s.key, !done)} aria-label={`Mark ${s.title} ${done ? 'not done' : 'done'}`}
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${done ? 'border-good bg-good text-white' : 'border-line text-transparent hover:border-good'}`}>✓</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{s.when}</span>
                      <h2 className={`text-base font-semibold ${done ? 'text-good' : 'text-ink'}`}>{s.title}</h2>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-2">{s.desc}</p>

                    {/* By 25 — suppliers owed */}
                    {s.key === 'suppliers_paid' && (
                      <div className="mt-2">
                        {d.suppliers.count > 0 ? (
                          <div className="rounded-lg border border-amber-200 bg-warn-soft p-3">
                            <div className="mb-1 text-sm font-medium text-warn">You still owe {rm(d.suppliers.total)} to {d.suppliers.count} supplier{d.suppliers.count === 1 ? '' : 's'}:</div>
                            <ul className="space-y-0.5 text-sm text-warn">
                              {d.suppliers.list.map((s2) => (
                                <li key={s2.name} className="flex justify-between gap-2">
                                  <span className="min-w-0 truncate">{cleanSupplier(s2.name)}</span>
                                  <span className="shrink-0 font-semibold">{rm(s2.balance)}</span>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-[11px] text-warn/80">Balances refresh after the supplier sync.</p>
                          </div>
                        ) : <p className="text-sm text-good">All suppliers paid ✓</p>}
                      </div>
                    )}

                    {/* By 28 — absents to fix */}
                    {s.key === 'fix_absent' && (
                      <div className="mt-2">
                        <div className="mb-1.5 flex justify-end">
                          <button onClick={load} disabled={loading} title="Reload the latest after fixing attendance"
                            className="rounded-lg border border-amber-300 bg-card px-2 py-0.5 text-xs font-medium text-warn hover:bg-warn-soft disabled:opacity-50">{loading ? '…' : '↻ Refresh'}</button>
                        </div>
                        {d.absents.count > 0 ? (
                          <div className="rounded-lg border border-amber-200 bg-warn-soft p-3">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-warn">{d.absents.count} ABSENT day{d.absents.count === 1 ? '' : 's'} to fix:</span>
                              <Link href="/attendance/checkin" className="shrink-0 text-xs font-medium text-accent hover:underline">Attendance →</Link>
                            </div>
                            {locked && <p className="mb-1.5 text-[11px] font-medium text-bad">This month&rsquo;s payroll is locked — unlock it (Payroll page) to change attendance.</p>}
                            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm text-warn">
                              {d.absents.list.map((a, i) => {
                                const key = a.email ? `${a.email}|${a.day}` : `${i}`;
                                const editing = editKey === key;
                                return (
                                  <li key={i} className="rounded-md bg-card/60 px-2 py-1">
                                    <div className="flex items-center justify-between gap-2">
                                      {a.email
                                        ? <Link href={`/attendance/report?staff=${encodeURIComponent(a.email)}`} className="min-w-0 truncate font-medium text-accent hover:underline">{a.name}</Link>
                                        : <span className="min-w-0 truncate font-medium text-ink">{a.name}</span>}
                                      <div className="flex shrink-0 items-center gap-2">
                                        <span className="text-ink-2">{fmtD(a.day)}</span>
                                        {canFix && !locked && a.email && !editing && (
                                          <button onClick={() => startFix(a.email!, a.day)} className="rounded-md border border-amber-300 bg-card px-2 py-0.5 text-xs font-medium text-warn hover:bg-warn-soft">Fix</button>
                                        )}
                                      </div>
                                    </div>
                                    {editing && a.email && (
                                      <div className="mt-1.5 space-y-1.5 border-t border-amber-200 pt-1.5">
                                        <select value={eStatus} onChange={(e) => setEStatus(e.target.value)} className="block w-full rounded-md border border-line bg-card px-2 py-1 text-sm text-ink">
                                          <option value="">Set this day as…</option>
                                          <option value="WORKING">Present (worked)</option>
                                          <option value="OFFDAY">Off day (paid leave)</option>
                                          <option value="MC">MC (paid sick)</option>
                                        </select>
                                        {eStatus === 'WORKING' && (
                                          <div className="grid grid-cols-2 gap-2">
                                            <label className="text-[11px] text-ink-2">Check-in <span className="text-bad">*</span>
                                              <input type="time" value={eIn} onChange={(e) => setEIn(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-card px-2 py-1 text-sm text-ink" />
                                            </label>
                                            <label className="text-[11px] text-ink-2">Check-out
                                              <input type="time" value={eOut} onChange={(e) => setEOut(e.target.value)} className="mt-0.5 block w-full rounded-md border border-line bg-card px-2 py-1 text-sm text-ink" />
                                            </label>
                                          </div>
                                        )}
                                        {eStatus === 'MC' && (
                                          <label className="block text-[11px] text-ink-2">Certificate (optional)
                                            <input type="file" accept="image/*,application/pdf" onChange={(e) => setECert(e.target.files?.[0] ?? null)} className="mt-0.5 block w-full text-xs text-ink-2 file:mr-2 file:rounded file:border-0 file:bg-accent file:px-2 file:py-1 file:text-xs file:font-medium file:text-white" />
                                          </label>
                                        )}
                                        {(eStatus === 'OFFDAY' || eStatus === 'MC') && (
                                          <p className="text-[11px] text-ink-3">Uses one of their {eStatus === 'MC' ? 'sick-leave (MC)' : 'annual-leave'} days.</p>
                                        )}
                                        <input value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="Note (optional)" className="block w-full rounded-md border border-line bg-card px-2 py-1 text-sm text-ink" />
                                        <div className="flex gap-2">
                                          <button onClick={() => saveRow(a.email!, a.day)} disabled={savingRow === key} className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{savingRow === key ? 'Saving…' : 'Save'}</button>
                                          <button onClick={cancelFix} disabled={savingRow === key} className="rounded-md border border-line bg-card px-3 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Cancel</button>
                                        </div>
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                            <p className="mt-2 text-[11px] text-warn/80">{canFix ? 'Tap Fix to set a day as Present / Off day / MC — no need to open Attendance. Days truly absent stay unpaid.' : 'Approve their MC / off-day (or fix in attendance) so they aren’t paid as absent.'}</p>
                          </div>
                        ) : <p className="text-sm text-good">No one left as absent ✓</p>}
                      </div>
                    )}

                    {/* 28-31 — payroll (salary detail is gated) */}
                    {s.key === 'payroll' && canPay && (
                      <div className="mt-2 rounded-card bg-card shadow-card p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-ink-2">Pay salaries</span>
                          {salaries.length > 0 && <span className="text-xs text-ink-3">{paidSalary}/{salaries.length} paid</span>}
                        </div>
                        {salaries.length === 0 ? (
                          <p className="text-xs text-ink-3">No payroll generated for this month yet.</p>
                        ) : (
                          <>
                            {salaries.map((sal) => (
                              <div key={sal.email} className="border-b border-line py-2 last:border-0">
                                <div className="flex items-start gap-2">
                                  <button onClick={() => setSalaryPaid(sal.email, !sal.paid, todayIso)} aria-label={`Mark ${sal.name} ${sal.paid ? 'unpaid' : 'paid'}`}
                                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[10px] font-bold transition ${sal.paid ? 'border-good bg-good text-white' : 'border-line text-transparent hover:border-good'}`}>✓</button>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className={`min-w-0 truncate text-sm font-medium ${sal.paid ? 'text-ink-3 line-through' : 'text-ink-2'}`}>{sal.name}</span>
                                      <span className={`shrink-0 text-sm font-semibold ${sal.paid ? 'text-ink-3' : 'text-ink'}`}>{rm(sal.net)}</span>
                                    </div>
                                    <div className="font-mono text-xs text-ink-2">{sal.bank_name || 'no bank'} · {sal.bank_acc_no || 'no account'}{sal.bank_acc_name ? ` · ${sal.bank_acc_name}` : ''}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Total</span><span>{rm(salaryTotal)}</span></div>
                            <p className="mt-1 text-[11px] text-ink-3">Amounts are confidential — keep the screen private. Send payslips from the Payroll page.</p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Bills (operating cost) — step 7 of the routine, editable here via gated RPCs */}
          <div className="rounded-card bg-card shadow-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-ink-2"><Icon name="receipt" size={17} /></span>
              <h2 className="text-base font-semibold text-ink">Bills</h2>
              <span className="text-xs text-ink-3">operating cost · tick when paid</span>
            </div>
            {d.bills.length === 0 ? (
              <p className="text-sm text-ink-3">No bills added for this month yet.</p>
            ) : (
              d.bills.map((b) => (
                <div key={b.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={!!b.paid} onChange={(e) => billSetPaid(b.id, e.target.checked)} title="Mark paid — stamps today's date" className="shrink-0 cursor-pointer" />
                  <span className={`min-w-0 flex-1 truncate ${b.paid ? 'text-ink-3 line-through' : 'text-ink-2'}`}>{b.label}</span>
                  {b.paid && b.paid_date && <span className="shrink-0 text-[11px] font-medium text-good">paid {fmtD(b.paid_date)}</span>}
                  <input type="number" step="0.01" defaultValue={Number(b.amount)} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== Number(b.amount)) billSetAmount(b.id, v); }}
                    className="w-24 rounded-lg border border-line px-1.5 py-0.5 text-right text-sm" />
                  <button onClick={() => billDelete(b.id)} className="shrink-0 text-xs text-bad/70 hover:text-bad">✕</button>
                </div>
              ))
            )}
            <div className="mt-2 flex items-center gap-2">
              <input value={newBillLabel} onChange={(e) => setNewBillLabel(e.target.value)} placeholder="e.g. SEWA" className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-sm" />
              <input value={newBillAmount} onChange={(e) => setNewBillAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" className="w-24 rounded-lg border border-line px-2 py-1 text-right text-sm" />
              <button onClick={billAdd} className="shrink-0 rounded-lg bg-btn px-2.5 py-1 text-sm font-semibold text-btn-ink hover:opacity-90">Add</button>
            </div>
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Bills total</span><span>{rm(d.bills.reduce((s, b) => s + Number(b.amount || 0), 0))}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
