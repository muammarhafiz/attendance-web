'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ---------- Types from v_payslip_admin_summary_v2 ---------- */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string; // manual DEDUCT only (excludes UNPAID)
  unpaid_auto: number | string;   // auto UNPAID only
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

/* ---------- presets for code dropdowns ---------- */
const EARN_CODES: { code: string; label: string }[] = [
  { code: 'COMM', label: 'Commission' },
  { code: 'OT', label: 'Overtime' },
  { code: 'BONUS', label: 'Bonus' },
  { code: 'ALLOW', label: 'Allowance' },
  { code: 'UNPAID_ADJ', label: 'Unpaid adjustment' }, // to offset auto UNPAID
  { code: 'CUSTOM', label: 'Custom…' },
];

const DEDUCT_CODES: { code: string; label: string }[] = [
  { code: 'ADVANCE', label: 'Advance' },
  { code: 'PENALTY', label: 'Penalty' },
  { code: 'CUSTOM', label: 'Custom…' },
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
    return v.toLocaleString('en-MY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return v.toFixed(2);
}

/* ============================================================
   PAGE
============================================================ */
export default function PayrollV2Page() {
  // KL time defaults
  const klNow = useMemo(
    () =>
      new Date(
        new Date().toLocaleString('en-US', {
          timeZone: 'Asia/Kuala_Lumpur',
        })
      ),
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

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser();
      const em = data.user?.email ?? null;
      setEmail(em);
      if (em) {
        const { data: ok, error } = await supabase.rpc('is_admin', {});
        setIsAdmin(!error && ok === true);
      } else {
        setIsAdmin(false);
      }
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const em = session?.user?.email ?? null;
      setEmail(em);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const disabledWrites = !isAdmin;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Period status
      {
        const { data, error } = await supabase
          .from('pay_v2.periods')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .limit(1)
          .maybeSingle();
        if (!error) setPeriod((data as PeriodRow) ?? null);
        else setPeriod(null);
      }

      // 2) summary view (v2)
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

      // 3) live absent days via Report wrapper
      {
        const { data, error } = await supabase.rpc('absent_days_from_report', {
          p_year: year,
          p_month: month,
        });
        if (!error && Array.isArray(data)) {
          const map: Record<string, number> = {};
          for (const r of data as {
            staff_email: string;
            days_absent: number;
          }[]) {
            map[r.staff_email] = r.days_absent ?? 0;
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  // actions (RPC)
  const callRpc = async (fn: string) => {
    if (disabledWrites) return;
    const { error } = await supabase.rpc(fn, { p_year: year, p_month: month });
    if (error) {
      alert(`${fn} failed: ${error.message}`);
    } else {
      await refresh();
    }
  };
  const build = () => callRpc('build_period');
  const syncBase = () => callRpc('sync_base_items');
  const syncAbsent = () => callRpc('sync_absent_deductions');
  const recalc = () => callRpc('recalc_statutories');
  const lock = () => callRpc('lock_period');
  const unlock = () => callRpc('unlock_period');

  const finalizeAndGenerate = async () => {
    if (disabledWrites) return;
    try {
      const res = await fetch('/api/payroll/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      alert('Finalize & PDF generation started/completed.');
      await refresh();
    } catch (e) {
      alert(`Finalize failed: ${(e as Error).message}`);
    }
  };

  /* ---------- status pill ---------- */
  const statusPill = useMemo(() => {
    const st = period?.status ?? '';
    const cls =
      st === 'LOCKED'
        ? 'bg-yellow-100 text-yellow-800'
        : st === 'FINALIZED'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-green-100 text-green-800';
    return (
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}
      >
        {st || '—'}
      </span>
    );
  }, [period]);

  /* ============================================================
     DETAILS MODAL (manual items + auto & live counters)
  ============================================================ */
  const [show, setShow] = useState<boolean>(false);
  const [sel, setSel] = useState<SummaryRow | null>(null);
  const [earnItems, setEarnItems] = useState<ItemRow[]>([]);
  const [deductItems, setDeductItems] = useState<ItemRow[]>([]);
  // add form
  const [addType, setAddType] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [addCode, setAddCode] = useState<string>('COMM'); // may be 'CUSTOM'
  const [customCode, setCustomCode] = useState<string>(''); // when CUSTOM is chosen
  const [addLabel, setAddLabel] = useState<string>('');    // optional
  const [addAmt, setAddAmt] = useState<string>('0.00');
  const [working, setWorking] = useState<boolean>(false);

  // helpers for dropdown list
  const codeOptions = addType === 'DEDUCT' ? DEDUCT_CODES : EARN_CODES;

  const openDetails = async (row: SummaryRow) => {
    setSel(row);
    setShow(true);
    await loadManualItems(row.staff_email);
  };

  const loadManualItems = useCallback(
    async (email: string) => {
      if (!period) return;
      const { data, error } = await supabase
        .from('pay_v2.items')
        .select('id, kind, code, label, amount')
        .eq('period_id', period.id)
        .eq('staff_email', email.toLowerCase())
        .or('kind.eq.EARN,kind.eq.DEDUCT');

      if (error) {
        setEarnItems([]);
        setDeductItems([]);
        return;
      }
      const rows = (data as ItemRow[]).filter((r) => {
        const code = (r.code ?? '').toUpperCase();
        return code !== 'BASE' && code !== 'UNPAID' && !code.startsWith('STAT_');
      });
      setEarnItems(rows.filter((r) => r.kind === 'EARN'));
      setDeductItems(rows.filter((r) => r.kind === 'DEDUCT'));
    },
    [period]
  );

  const addItem = async () => {
    if (!sel) return;
    if (!isAdmin || period?.status !== 'OPEN') {
      alert('Period must be OPEN and you must be admin.');
      return;
    }
    const amt = Number(addAmt);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert('Amount must be > 0');
      return;
    }
    const chosenCode = addCode === 'CUSTOM' ? customCode.trim().toUpperCase() : addCode;
    if (!chosenCode) {
      alert('Please provide a code.');
      return;
    }
    // block system codes just in case
    if (['BASE', 'UNPAID'].includes(chosenCode) || chosenCode.startsWith('STAT_')) {
      alert('That code is system-managed and cannot be added.');
      return;
    }

    const defaultLabel =
      (addType === 'DEDUCT'
        ? DEDUCT_CODES.find((c) => c.code === addCode)?.label
        : EARN_CODES.find((c) => c.code === addCode)?.label) || chosenCode;

    setWorking(true);
    try {
      const { error } = await supabase.rpc('add_pay_item', {
        p_year: year,
        p_month: month,
        p_email: sel.staff_email,
        p_kind: addType,
        p_code: chosenCode,
        p_label: addLabel || defaultLabel,
        p_amount: amt,
      });
      if (error) throw error;
      await refresh();
      await loadManualItems(sel.staff_email);
      // reset partial form (keep type & code for faster entry)
      setAddLabel('');
      setAddAmt('0.00');
      if (addCode === 'CUSTOM') setCustomCode('');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const updateItem = async (itemId: string, amount: number, label?: string) => {
    if (!isAdmin || period?.status !== 'OPEN') {
      alert('Period must be OPEN and you must be admin.');
      return;
    }
    setWorking(true);
    try {
      const { error } = await supabase.rpc('update_pay_item', {
        p_item_id: itemId,
        p_amount: amount,
        p_label: label ?? null,
      });
      if (error) throw error;
      await refresh();
      if (sel) await loadManualItems(sel.staff_email);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!isAdmin || period?.status !== 'OPEN') {
      alert('Period must be OPEN and you must be admin.');
      return;
    }
    if (!confirm('Delete this item?')) return;
    setWorking(true);
    try {
      const { error } = await supabase.rpc('delete_pay_item', {
        p_item_id: itemId,
      });
      if (error) throw error;
      await refresh();
      if (sel) await loadManualItems(sel.staff_email);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  // Quick helpers for UNPAID adjustments (to zero or target)
  const cancelUnpaid = async () => {
    if (!sel) return;
    const auto = asNum(sel.unpaid_auto);
    if (auto <= 0) {
      alert('No auto UNPAID to cancel.');
      return;
    }
    setAddType('EARN');
    setAddCode('UNPAID_ADJ');
    setAddLabel('Cancel unpaid (auto)');
    setAddAmt(auto.toFixed(2));
  };

  const setUnpaidToTarget = async () => {
    if (!sel) return;
    const auto = asNum(sel.unpaid_auto);
    const inp = prompt('Set total UNPAID to (RM):', '0.00');
    if (!inp) return;
    const target = Number(inp);
    if (!Number.isFinite(target) || target < 0) {
      alert('Invalid amount');
      return;
    }
    const diff = auto - target;
    if (diff <= 0) {
      alert('Target is not less than current auto UNPAID.');
      return;
    }
    setAddType('EARN');
    setAddCode('UNPAID_ADJ');
    setAddLabel(`Adjust unpaid to RM ${target.toFixed(2)}`);
    setAddAmt(diff.toFixed(2));
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
          <div className="mb-1">
            Period: <b>{`${year}-${String(month).padStart(2, '0')}`}</b>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Status:</span>
            {statusPill}
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <div>
            <div className="text-xs text-gray-500">Year</div>
            <input
              type="number"
              className="w-24 rounded border px-2 py-1"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <div className="text-xs text-gray-500">Month</div>
            <input
              type="number"
              min={1}
              max={12}
              className="w-20 rounded border px-2 py-1"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>
          <button
            onClick={refresh}
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={build}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites
              ? 'bg-gray-100 text-gray-400'
              : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Build
        </button>
        <button
          onClick={syncBase}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites
              ? 'bg-gray-100 text-gray-400'
              : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Sync Base
        </button>
        <button
          onClick={syncAbsent}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites
              ? 'bg-gray-100 text-gray-400'
              : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Sync Absent
        </button>
        <button
          onClick={recalc}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites
              ? 'bg-gray-100 text-gray-400'
              : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Recalc Statutories
        </button>
        <span className="mx-1 text-gray-300">|</span>
        <button
          onClick={lock}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites
              ? 'bg-gray-100 text-gray-400'
              : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Lock
        </button>
        <button
          onClick={unlock}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites
              ? 'bg-gray-100 text-gray-400'
              : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Unlock
        </button>
        <button
          onClick={finalizeAndGenerate}
          disabled={disabledWrites}
          className={`ml-2 rounded px-3 py-1.5 text-sm font-semibold ${
            disabledWrites
              ? 'bg-blue-200 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          Finalize & Generate PDFs
        </button>
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
                <td
                  colSpan={12}
                  className="px-3 py-6 text-center text-gray-500"
                >
                  No data for {year}-{String(month).padStart(2, '0')}. Try
                  Build/Sync.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const absentDays = absentMap[r.staff_email] ?? 0;
                return (
                  <tr key={r.staff_email} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.staff_name ?? r.staff_email}
                      <div className="text-xs font-normal text-gray-500">
                        {r.staff_email}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.base_wage, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_earn, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.manual_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {fmt(r.unpaid_auto, true)}{' '}
                      <span className="text-xs text-gray-500">· {absentDays}d</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.epf_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.socso_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.eis_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">
                      {fmt(r.net_pay, true)}
                    </td>
                    <td className="px-3 py-2 text-center" title="Live absent from Report (OFFDAY/MC excluded; future dates ignored).">
                      {absentDays}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => openDetails(r)}
                      >
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

      <p className="mt-3 text-xs text-gray-500">
        Finalize uses your existing <code>/api/payroll/finalize</code> endpoint to
        generate & upload PDFs to your Supabase Storage bucket.
      </p>

      {/* ---------- DETAILS MODAL ---------- */}
      {show && sel && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget && !working) setShow(false);
          }}
        >
          <div className="mx-auto w-full max-w-3xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">
                Edit items — {sel.staff_name ?? sel.staff_email}
                <div className="text-xs text-gray-500">{sel.staff_email}</div>
              </div>
              <button
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                onClick={() => !working && setShow(false)}
              >
                Close
              </button>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                Auto UNPAID: RM {fmt(sel.unpaid_auto, false)} ·{' '}
                {absentMap[sel.staff_email] ?? 0}d
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                Live Absent (Report): {absentMap[sel.staff_email] ?? 0} days
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                Period status: {period?.status ?? '—'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
              <button
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                onClick={cancelUnpaid}
                disabled={!isAdmin || period?.status !== 'OPEN' || asNum(sel.unpaid_auto) <= 0}
                title="Prepare an earning that offsets current auto UNPAID fully"
              >
                Cancel UNPAID (prepare)
              </button>
              <button
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                onClick={setUnpaidToTarget}
                disabled={!isAdmin || period?.status !== 'OPEN' || asNum(sel.unpaid_auto) <= 0}
                title="Prepare an earning that adjusts UNPAID to your target amount"
              >
                Set UNPAID to…
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-2">
              {/* Manual Earnings */}
              <div className="rounded border">
                <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">
                  Earnings (manual)
                </div>
                <div className="max-h-64 overflow-auto px-3 py-2 text-sm">
                  {earnItems.length === 0 ? (
                    <div className="text-gray-500">No manual earnings.</div>
                  ) : (
                    <ul className="space-y-2">
                      {earnItems.map((it) => (
                        <li
                          key={it.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-medium">
                              {(it.label ?? it.code ?? '').toString()}
                            </div>
                            <div className="text-xs text-gray-500">
                              code: {(it.code ?? '').toString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums">
                              RM {fmt(it.amount, false)}
                            </span>
                            {isAdmin && period?.status === 'OPEN' && (
                              <>
                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={async () => {
                                    const next = prompt(
                                      'New amount (RM)',
                                      fmt(it.amount, false)
                                    );
                                    if (!next) return;
                                    const n = Number(next);
                                    if (!Number.isFinite(n) || n <= 0) {
                                      alert('Invalid amount');
                                      return;
                                    }
                                    const newLabel = prompt(
                                      'New label (optional)',
                                      it.label ?? ''
                                    ) ?? undefined;
                                    await updateItem(it.id, n, newLabel);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                  onClick={() => deleteItem(it.id)}
                                >
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

              {/* Manual Deductions */}
              <div className="rounded border">
                <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">
                  Deductions (manual)
                </div>
                <div className="max-h-64 overflow-auto px-3 py-2 text-sm">
                  {deductItems.length === 0 ? (
                    <div className="text-gray-500">No manual deductions.</div>
                  ) : (
                    <ul className="space-y-2">
                      {deductItems.map((it) => (
                        <li
                          key={it.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-medium">
                              {(it.label ?? it.code ?? '').toString()}
                            </div>
                            <div className="text-xs text-gray-500">
                              code: {(it.code ?? '').toString()}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums">
                              RM {fmt(it.amount, false)}
                            </span>
                            {isAdmin && period?.status === 'OPEN' && (
                              <>
                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={async () => {
                                    const next = prompt(
                                      'New amount (RM)',
                                      fmt(it.amount, false)
                                    );
                                    if (!next) return;
                                    const n = Number(next);
                                    if (!Number.isFinite(n) || n <= 0) {
                                      alert('Invalid amount');
                                      return;
                                    }
                                    const newLabel = prompt(
                                      'New label (optional)',
                                      it.label ?? ''
                                    ) ?? undefined;
                                    await updateItem(it.id, n, newLabel);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                  onClick={() => deleteItem(it.id)}
                                >
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
              <div className="mb-2 text-sm font-semibold">Add item</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={addType}
                  onChange={(e) =>
                    setAddType(e.target.value === 'DEDUCT' ? 'DEDUCT' : 'EARN')
                  }
                >
                  <option value="EARN">Earning</option>
                  <option value="DEDUCT">Deduction</option>
                </select>

                {/* Code dropdown */}
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={addCode}
                  onChange={(e) => setAddCode(e.target.value)}
                >
                  {(codeOptions).map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label} ({opt.code})
                    </option>
                  ))}
                </select>

                {/* Custom code input (only when CUSTOM) */}
                {addCode === 'CUSTOM' && (
                  <input
                    className="rounded border px-2 py-1 text-sm"
                    placeholder="Custom code (A–Z, 0–9, _ )"
                    value={customCode}
                    onChange={(e) =>
                      setCustomCode(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))
                    }
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
                    className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
                    disabled={working || !isAdmin || period?.status !== 'OPEN'}
                    onClick={addItem}
                    title="Period must be OPEN"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Period must be <b>OPEN</b> and you must be admin to edit.
                System-managed codes (<code>BASE</code>, <code>UNPAID</code>,{' '}
                <code>STAT_* </code>) are blocked.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
