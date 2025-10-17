'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ---------- Types ---------- */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;     // fixed
  base_wage: number | string;
  manual_deduct: number | string;  // manual DEDUCT only (excludes UNPAID)
  unpaid_auto: number | string;    // auto UNPAID only
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  total_deduct: number | string;
  net_pay: number | string;
  earn_breakdown?: any;
  deduct_breakdown?: any;
};

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'LOCKED' | 'FINALIZED' | string;
};

type ItemRow = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number | string;
};

/* ---------- presets for dropdowns ---------- */
const EARN_CODES: { code: string; label: string }[] = [
  { code: 'COMM',  label: 'Commission' },
  { code: 'OT',    label: 'Overtime' },
  { code: 'BONUS', label: 'Bonus' },
  { code: 'ALLOW', label: 'Allowance' },
  { code: 'CUSTOM',label: 'Custom…' },
];

const DEDUCT_CODES: { code: string; label: string }[] = [
  { code: 'ADVANCE', label: 'Advance' },
  { code: 'PENALTY', label: 'Penalty' },
  { code: 'CUSTOM',  label: 'Custom…' },
];

/* ---------- helpers ---------- */
function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number | string, currency = false): string {
  const v = asNum(n);
  if (currency) {
    return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return v.toFixed(2);
}

/* ============================================================
   PAGE
============================================================ */
export default function PayrollV2Page() {
  // KL time defaults
  const klNow = useMemo(
    () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })),
    []
  );
  const [year, setYear] = useState<number>(klNow.getFullYear());
  const [month, setMonth] = useState<number>(klNow.getMonth() + 1);

  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [absentMap, setAbsentMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);

  // auth/admin
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // admin status toast
  const [adminToast, setAdminToast] = useState<{ show: boolean; text: string }>({ show: false, text: '' });
  const showAdminToastText = (flag: boolean) => {
    setAdminToast({ show: true, text: flag ? 'You are Admin' : 'You are NOT Admin' });
    setTimeout(() => setAdminToast({ show: false, text: '' }), 2000);
  };

  // inline diagnostics
  const [lastAction, setLastAction] = useState<string>('');
  const [lastPayload, setLastPayload] = useState<any>(null);
  const [lastError, setLastError] = useState<string>('');
  const [formMsg, setFormMsg] = useState<{ ok?: string; err?: string }>({});

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser();
      const em = data.user?.email ?? null;
      setEmail(em);
      if (em) {
        const { data: ok, error } = await supabase.rpc('is_admin', {});
        const flag = !error && ok === true;
        setIsAdmin(flag);
        showAdminToastText(flag);
      } else {
        setIsAdmin(false);
        showAdminToastText(false);
      }
    };
    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const em = session?.user?.email ?? null;
      setEmail(em);
      const { data: ok2, error: e2 } = await supabase.rpc('is_admin', {});
      const flag = !e2 && ok2 === true;
      setIsAdmin(flag);
      showAdminToastText(flag);
    });

    return () => { sub?.subscription?.unsubscribe?.(); };
  }, []);

  const disabledWrites = !isAdmin;

  /* ---------- smart RPC (pay_v2 first, then public fallback) ---------- */
  const callRpcSmart = async (fn: string, args: Record<string, any>) => {
    setLastAction(fn);
    setLastPayload(args);
    setLastError('');

    // Try pay_v2 first
    const r1 = await supabase.schema('pay_v2').rpc(fn, args);
    if (!r1.error) return true;

    // Always fall back to public (covers function-not-found or schema cache hiccups)
    const r2 = await supabase.rpc(fn, args);
    if (r2.error) {
      const msg = `${r1.error.message} | fallback: ${r2.error.message}`;
      setLastError(msg);
      alert(`${fn} failed: ${r2.error.message}`);
      return false;
    }
    return true;
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setAbsentMap({}); // reset to avoid stale values during reload
    try {
      // 1) Period status — use public view to avoid RLS surprises
      {
        const { data, error } = await supabase
          .from('v_periods_min')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .maybeSingle();
        if (!error) setPeriod((data as PeriodRow) ?? null);
        else setPeriod(null);
      }

      // 2) summary view (v2, public)
      {
        const { data, error } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .order('staff_name', { ascending: true });
        if (error) throw error;
        setRows((data as SummaryRow[]) ?? []);
      }

      // 3) live absent days from Report source
      {
        const { data, error } = await supabase.rpc('report_absent_days_from_print', {
          p_year: year,
          p_month: month,
        });

        if (!error && Array.isArray(data)) {
          const map: Record<string, number> = {};
          for (const r of data as { staff_email: string; days_absent: number }[]) {
            map[(r.staff_email || '').toLowerCase()] = r.days_absent ?? 0;
          }
          setAbsentMap(map);
        } else {
          setAbsentMap({});
        }
      }
    } catch (e) {
      console.error(e);
      alert(`Failed to load payroll data: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { refresh(); }, [refresh]);

  // actions (RPC) with diagnostics
  const callPeriodFn = async (fn: string) => {
    if (disabledWrites) return;
    const ok = await callRpcSmart(fn, { p_year: year, p_month: month });
    if (ok) await refresh();
  };

  // Map buttons to the right functions
  const build      = () => callPeriodFn('build_period');                     // pay_v2
  const syncBase   = () => callPeriodFn('sync_base_items_respect_archive');  // pay_v2
  const syncAbsent = () => callPeriodFn('sync_absent_deductions');           // wherever it lives
  const recalc     = () => callPeriodFn('recalc_statutories_respect_temp');  // pay_v2 wrapper
  const lock       = () => callPeriodFn('lock_period');                      // pay_v2
  const unlock     = () => callPeriodFn('unlock_period');                    // pay_v2

  

  /* ---------- status pill ---------- */
  const statusPill = useMemo(() => {
    const st = period?.status ?? '';
    const cls =
      st === 'LOCKED'   ? 'bg-yellow-100 text-yellow-800' :
      st === 'FINALIZED'? 'bg-blue-100 text-blue-800' :
                          'bg-green-100 text-green-800';
    return (
      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
        {st || '—'}
      </span>
    );
  }, [period]);

  /* ============================================================
     DETAILS MODAL
  ============================================================ */
  const [show, setShow] = useState<boolean>(false);
  const [sel, setSel] = useState<SummaryRow | null>(null);

  const [earnItems, setEarnItems] = useState<ItemRow[]>([]);
  const [deductItems, setDeductItems] = useState<ItemRow[]>([]);

  // UNPAID plumbing (for final unpaid line)
  const [unpaidAdjAmt, setUnpaidAdjAmt] = useState<number>(0);     // EARN/UNPAID_ADJ
  const [unpaidExtraAmt, setUnpaidExtraAmt] = useState<number>(0); // DEDUCT/UNPAID_EXTRA
  const unpaidFinal = useMemo(() => {
    if (!sel) return 0;
    return Math.max(0, asNum(sel.unpaid_auto) + unpaidExtraAmt - unpaidAdjAmt);
  }, [sel, unpaidAdjAmt, unpaidExtraAmt]);

  // add form state
  const [addType, setAddType] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [addCode, setAddCode] = useState<string>('COMM'); // changes with type
  const [customCode, setCustomCode] = useState<string>('');
  const [addLabel, setAddLabel] = useState<string>('');
  const [addAmt, setAddAmt] = useState<string>('0.00');
  const [working, setWorking] = useState<boolean>(false);

  // When type changes, reset to a sane default code and clear CUSTOM
  useEffect(() => {
    if (addType === 'DEDUCT') setAddCode('ADVANCE'); else setAddCode('COMM');
    setCustomCode('');
  }, [addType]);

  const openDetails = async (row: SummaryRow) => {
    setSel(row);
    setShow(true);
    setFormMsg({});
    try {
      await loadManualAndUnpaid(row.staff_email);
    } catch (e) {
      console.error(e); // don't block modal from showing
    }
  };

  const loadManualAndUnpaid = useCallback(
    async (emailAddr: string) => {
      if (!period) return;

      // Manual items (exclude BASE/UNPAID/STAT_*) via function
      const { data: listData } = await supabase.rpc('list_manual_items', {
        p_year: year, p_month: month, p_email: emailAddr,
      });

      const rows = (listData as ItemRow[]) ?? [];
      setEarnItems(rows.filter(r => r.kind === 'EARN'));
      setDeductItems(rows.filter(r => r.kind === 'DEDUCT'));

      // UNPAID plumbing items for final total (EARN/UNPAID_ADJ & DEDUCT/UNPAID_EXTRA)
      if (period?.id) {
        const { data: plumb, error } = await supabase
          .schema('pay_v2')
          .from('items')
          .select('kind, code, amount')
          .eq('period_id', period.id)
          .eq('staff_email', emailAddr.toLowerCase())
          .in('code', ['UNPAID_ADJ','UNPAID_EXTRA']);
        if (error) throw error;

        let adj = 0, extra = 0;
        (plumb ?? []).forEach((r: any) => {
          const code = (r.code ?? '').toUpperCase();
          if (code === 'UNPAID_ADJ')   adj = asNum(r.amount);
          if (code === 'UNPAID_EXTRA') extra = asNum(r.amount);
        });
        setUnpaidAdjAmt(adj);
        setUnpaidExtraAmt(extra);
      }
    },
    [period, year, month]
  );

  const addItem = async () => {
    setFormMsg({}); setLastError('');
    if (!sel) return;

    if (!isAdmin) { setFormMsg({ err: 'You are not admin.' }); return; }
    if (period?.status !== 'OPEN') { setFormMsg({ err: `Period must be OPEN (now ${period?.status || '—'})` }); return; }

    const amt = Number(addAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setFormMsg({ err: 'Amount must be > 0' }); return; }

    const chosenCode = addCode === 'CUSTOM' ? customCode.trim().toUpperCase() : addCode;
    if (!chosenCode) { setFormMsg({ err: 'Please provide a code.' }); return; }
    if (['BASE','UNPAID'].includes(chosenCode) || chosenCode.startsWith('STAT_')) {
      setFormMsg({ err: 'That code is system-managed and cannot be added.' });
      return;
    }

    // default label from the FINAL chosenCode, respecting CUSTOM
    const list = addType === 'DEDUCT' ? DEDUCT_CODES : EARN_CODES;
    const defaultLabel = (list.find(c => c.code === chosenCode)?.label) || chosenCode;

    setWorking(true);
    setLastAction('add_pay_item');
    const payload = {
      p_year: year, p_month: month, p_email: sel.staff_email,
      p_kind: addType, p_code: chosenCode, p_label: addLabel || defaultLabel, p_amount: amt,
    };
    setLastPayload(payload);

    try {
      const ok = await callRpcSmart('add_pay_item', payload);
      if (ok) {
        await refresh();
        await loadManualAndUnpaid(sel.staff_email);
        setAddLabel(''); setAddAmt('0.00');
        if (addCode === 'CUSTOM') setCustomCode('');
        setFormMsg({ ok: 'Item added.' });
      }
    } catch (e) {
      const msg = (e as Error).message;
      setLastError(msg);
      setFormMsg({ err: msg });
    } finally { setWorking(false); }
  };

  const updateItem = async (itemId: string, amount: number, label?: string) => {
    setFormMsg({});
    if (!isAdmin || period?.status !== 'OPEN') { setFormMsg({ err: 'Period must be OPEN and you must be admin.' }); return; }
    setWorking(true);
    setLastAction('update_pay_item');
    setLastPayload({ p_item_id: itemId, p_amount: amount, p_label: label ?? null });
    setLastError('');
    try {
      const ok = await callRpcSmart('update_pay_item', {
        p_item_id: itemId, p_amount: amount, p_label: label ?? null,
      });
      if (ok) {
        await refresh();
        if (sel) await loadManualAndUnpaid(sel.staff_email);
        setFormMsg({ ok: 'Item updated.' });
      }
    } catch (e) {
      const msg = (e as Error).message;
      setLastError(msg);
      setFormMsg({ err: msg });
    } finally { setWorking(false); }
  };

  const deleteItem = async (itemId: string) => {
    setFormMsg({});
    if (!isAdmin || period?.status !== 'OPEN') { setFormMsg({ err: 'Period must be OPEN and you must be admin.' }); return; }
    if (!confirm('Delete this item?')) return;
    setWorking(true);
    setLastAction('delete_pay_item');
    setLastPayload({ p_item_id: itemId });
    setLastError('');
    try {
      const ok = await callRpcSmart('delete_pay_item', { p_item_id: itemId });
      if (ok) {
        await refresh();
        if (sel) await loadManualAndUnpaid(sel.staff_email);
        setFormMsg({ ok: 'Item deleted.' });
      }
    } catch (e) {
      const msg = (e as Error).message;
      setLastError(msg);
      setFormMsg({ err: msg });
    } finally { setWorking(false); }
  };

  /** EDIT UNPAID (admin-only) */
  const setFinalUnpaid = async () => {
    if (!sel) return;
    if (!isAdmin) { setFormMsg({ err: 'You are not admin.' }); return; }
    if (period?.status !== 'OPEN') { setFormMsg({ err: `Period must be OPEN (now ${period?.status || '—'})` }); return; }

    const current = unpaidFinal || 0;
    const raw = prompt('Set final Unpaid Leave (RM):', fmt(current, false));
    if (raw == null) return; // cancelled
    const target = Number(raw);
    if (!Number.isFinite(target) || target < 0) {
      setFormMsg({ err: 'Please enter a valid non-negative number.' });
      return;
    }

    try {
      setWorking(true);
      setLastAction('set_unpaid_total');
      setLastPayload({ p_year: year, p_month: month, p_email: sel.staff_email, p_target: target });
      setLastError('');

      const ok = await callRpcSmart('set_unpaid_total', {
        p_year: year,
        p_month: month,
        p_email: sel.staff_email,
        p_target: target,
      });

      if (ok) {
        await refresh();
        await loadManualAndUnpaid(sel.staff_email);
        setFormMsg({ ok: 'Unpaid total updated.' });
      }
    } catch (e) {
      const msg = (e as Error).message;
      setLastError(msg);
      setFormMsg({ err: msg });
    } finally {
      setWorking(false);
    }
  };

  /** PRINT PAYSLIP (opens new tab) */
  const openPayslip = () => {
    if (!sel) return;
    const q = new URLSearchParams({
      year: String(year),
      month: String(month),
      email: sel.staff_email.toLowerCase(),
    }).toString();
    window.open(`/payroll/slip?${q}`, '_blank', 'noopener,noreferrer');
  };

  /* ============================================================
     RENDER
  ============================================================ */
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">Payroll v2</h1>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="text-sm text-gray-600">
          <div className="mb-1">Period: <b>{`${year}-${String(month).padStart(2, '0')}`}</b></div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Status:</span>{statusPill}
            <span
              className={`ml-2 inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${isAdmin ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}
              title="Admin recognition"
            >
              {isAdmin ? 'Admin' : 'Not admin'}
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <div>
            <div className="text-xs text-gray-500">Year</div>
            <input type="number" className="w-24 rounded border px-2 py-1" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div>
            <div className="text-xs text-gray-500">Month</div>
            <input type="number" min={1} max={12} className="w-20 rounded border px-2 py-1" value={month} onChange={(e) => setMonth(Number(e.target.value))} />
          </div>
          <button onClick={refresh} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Refresh</button>
          <button
            onClick={async () => {
              const { data: ok3, error: e3 } = await supabase.rpc('is_admin', {});
              const flag = !e3 && ok3 === true;
              setIsAdmin(flag);
              showAdminToastText(flag);
            }}
            className="rounded border px-2 py-1.5 text-xs hover:bg-gray-50"
            title="Re-check admin status"
          >
            Check admin
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={build}      disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Build</button>
        <button onClick={syncBase}   disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Sync Base</button>
        <button onClick={syncAbsent} disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Sync Absent</button>
        <button onClick={recalc}     disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Recalc Statutories</button>
        <span className="mx-1 text-gray-300">|</span>
        <button onClick={lock}       disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Lock</button>
        <button onClick={unlock}     disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Unlock</button>
        
      </div>

      {loading && (
        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Loading…
        </div>
      )}

      {/* Main summary table */}
      <div className="overflow-x-auto rounded border">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="border-b px-3 py-2">Staff</th>
              <th className="border-b px-3 py-2">Base</th>
              <th className="border-b px-3 py-2">Earn</th>
              <th className="border-b px-3 py-2">Manual Deduct</th>
              <th className="border-b px-3 py-2">Unpaid (auto)</th>
              <th className="border-b px-3 py-2">EPF (Emp)</th>
              <th className="border-b px-3 py-2">SOCSO (Emp)</th>
              <th className="border-b px-3 py-2">EIS (Emp)</th>
              <th className="border-b px-3 py-2">Total Deduct</th>
              <th className="border-b px-3 py-2">Net</th>
              <th className="border-b px-3 py-2">Absent (days)</th>
              <th className="border-b px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-gray-500">
                  No data for {year}-{String(month).padStart(2, '0')}. Try Build/Sync.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const absentDays = absentMap[(r.staff_email || '').toLowerCase()] ?? 0;
                return (
                  <tr key={r.staff_email} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.staff_name ?? r.staff_email}
                      <div className="text-xs font-normal text-gray-500">{r.staff_email}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.base_wage, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_earn, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.manual_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {fmt(r.unpaid_auto, true)} <span className="text-xs text-gray-500">· {absentDays}d</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.epf_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.socso_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.eis_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{fmt(r.net_pay, true)}</td>
                    <td className="px-3 py-2 text-center" title="Live absent from Report (from month_print_report with status='Absent').">
                      {absentDays}
                    </td>
                    <td className="px-3 py-2">
                      <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50" onClick={() => openDetails(r)}>
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      

      {/* ---------- DETAILS MODAL ---------- */}
      {show && sel && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          onClick={(e) => { if (e.target === e.currentTarget && !working) setShow(false); }}
        >
          <div className="mx-auto w-full max-w-3xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">
                Edit items — {sel.staff_name ?? sel.staff_email}
                <div className="text-xs text-gray-500">{sel.staff_email}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  onClick={openPayslip}
                  title="Open printable payslip in a new tab"
                >
                  Print payslip
                </button>
                <button
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  onClick={() => !working && setShow(false)}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                Auto UNPAID: RM {fmt(sel.unpaid_auto, false)}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                Period status: {period?.status ?? '—'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-2">
              {/* Manual Earnings */}
              <div className="rounded border">
                <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Earnings (manual)</div>
                <div className="max-h-64 overflow-auto px-3 py-2 text-sm">
                  {earnItems.length === 0 ? (
                    <div className="text-gray-500">No manual earnings.</div>
                  ) : (
                    <ul className="space-y-2">
                      {earnItems.map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{(it.label ?? it.code ?? '').toString()}</div>
                            <div className="text-xs text-gray-500">code: {(it.code ?? '').toString()}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums">RM {fmt(it.amount, false)}</span>
                            {isAdmin && period?.status === 'OPEN' && (
                              <>
                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={async () => {
                                    const next = prompt('New amount (RM)', fmt(it.amount, false));
                                    if (!next) return;
                                    const n = Number(next);
                                    if (!Number.isFinite(n) || n <= 0) { setFormMsg({ err: 'Invalid amount' }); return; }
                                    const newLabel = prompt('New label (optional)', it.label ?? '') ?? undefined;
                                    await updateItem(it.id, n, newLabel);
                                  }}
                                >
                                  Edit
                                </button>
                                <button className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => deleteItem(it.id)}>
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Deductions (includes UNPAID as first-class row) */}
              <div className="rounded border">
                <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Deductions</div>

                {/* UNPAID row with EDIT button */}
                <div className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      Unpaid leave
                      {isAdmin && period?.status === 'OPEN' && (
                        <button
                          type="button"
                          className="ml-2 rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
                          title="Set final Unpaid Leave total"
                          onClick={setFinalUnpaid}
                          disabled={working}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      Final total = auto ({fmt(sel.unpaid_auto, false)}) + extra ({fmt(unpaidExtraAmt, false)}) – adj ({fmt(unpaidAdjAmt, false)})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">RM {fmt(unpaidFinal, false)}</span>
                  </div>
                </div>

                {/* Manual deductions (excluding system UNPAID & statutories) */}
                <div className="max-h-60 overflow-auto px-3 py-2 text-sm">
                  {deductItems.length === 0 ? (
                    <div className="text-gray-500">No other manual deductions.</div>
                  ) : (
                    <ul className="space-y-2">
                      {deductItems.map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{(it.label ?? it.code ?? '').toString()}</div>
                            <div className="text-xs text-gray-500">code: {(it.code ?? '').toString()}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums">RM {fmt(it.amount, false)}</span>
                            {isAdmin && period?.status === 'OPEN' && (
                              <>
                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={async () => {
                                    const next = prompt('New amount (RM)', fmt(it.amount, false));
                                    if (!next) return;
                                    const n = Number(next);
                                    if (!Number.isFinite(n) || n <= 0) { setFormMsg({ err: 'Invalid amount' }); return; }
                                    const newLabel = prompt('New label (optional)', it.label ?? '') ?? undefined;
                                    await updateItem(it.id, n, newLabel);
                                  }}
                                >
                                  Edit
                                </button>
                                <button className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => deleteItem(it.id)}>
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Add item */}
            <div className="border-t px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">Add item</div>
                <div className="text-[11px] text-gray-500">
                  Add as: <b>{addType}</b> · <b>{addCode === 'CUSTOM' ? (customCode || '—') : addCode}</b>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={addType}
                  onChange={(e) => setAddType(e.target.value === 'DEDUCT' ? 'DEDUCT' : 'EARN')}
                >
                  <option value="EARN">Earning</option>
                  <option value="DEDUCT">Deduction</option>
                </select>

                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={addCode}
                  onChange={(e) => setAddCode(e.target.value)}
                >
                  {(addType === 'DEDUCT' ? DEDUCT_CODES : EARN_CODES).map((opt) => (
                    <option key={opt.code} value={opt.code}>{opt.label} ({opt.code})</option>
                  ))}
                </select>

                {addCode === 'CUSTOM' && (
                  <input
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="Custom code (A–Z, 0–9, _ )"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                  />
                )}

                <input
                  className="rounded border px-2 py-1 text-sm md:col-span-2"
                  placeholder="Display label"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <input
                    className="w-full rounded border px-2 py-1 text-right text-sm tabular-nums"
                    placeholder="0.00"
                    value={addAmt}
                    onChange={(e) => setAddAmt(e.target.value)}
                  />
                  <button
                    className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                    disabled={!isAdmin || period?.status !== 'OPEN' || working}
                    onClick={addItem}
                    title="Period must be OPEN"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Inline result/error from actions */}
              {formMsg.err && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formMsg.err}</div>
              )}
              {formMsg.ok && (
                <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{formMsg.ok}</div>
              )}

              {/* Tiny debug box */}
              <div className="mt-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-700">
                <div><b>Debug (last action)</b></div>
                <div>action: {lastAction || '—'}</div>
                <div>payload: <code>{lastPayload ? JSON.stringify(lastPayload) : '—'}</code></div>
                <div className={lastError ? 'text-red-700' : 'text-gray-500'}>error: {lastError || '—'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin toast */}
      {adminToast.show && (
        <div className="fixed right-4 top-4 z-[60] rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-lg">
          {adminToast.text}
        </div>
      )}
    </div>
  );
}
