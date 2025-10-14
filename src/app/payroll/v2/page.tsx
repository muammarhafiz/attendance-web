// src/app/payroll/v2/page.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// ---- types from v_payslip_admin_summary_v2 ----
type BreakdownItem = { code: string; label: string; amount: number };
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string; // manual only (excludes UNPAID)
  unpaid_auto: number | string;   // auto absence (UNPAID)
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  total_deduct: number | string;
  net_pay: number | string;
  earn_breakdown?: BreakdownItem[];
  deduct_breakdown?: BreakdownItem[];
};

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'LOCKED' | 'FINALIZED' | string;
};

function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number | string, currency = false): string {
  const v = asNum(n);
  if (currency) return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toFixed(2);
}

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

  // modal state (new)
  const [showDetail, setShowDetail] = useState<boolean>(false);
  const [detailRow, setDetailRow] = useState<SummaryRow | null>(null);

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

      // 3) absent days via RPC wrapper (public.absent_days_from_report)
      {
        const { data, error } = await supabase.rpc('absent_days_from_report', {
          p_year: year,
          p_month: month,
        });
        if (!error && Array.isArray(data)) {
          const map: Record<string, number> = {};
          for (const r of data as { staff_email: string; days_absent: number }[]) {
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

  // actions
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

  // ui helpers
  const statusPill = useMemo(() => {
    const st = period?.status ?? '';
    const cls =
      st === 'LOCKED'
        ? 'bg-yellow-100 text-yellow-800'
        : st === 'FINALIZED'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-green-100 text-green-800';
    return (
      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
        {st || '—'}
      </span>
    );
  }, [period]);

  // modal helpers
  const openDetail = (row: SummaryRow) => {
    setDetailRow(row);
    setShowDetail(true);
  };
  const closeDetail = () => {
    setShowDetail(false);
    setDetailRow(null);
  };

  const modalTotals = useMemo(() => {
    if (!detailRow) return { earn: 0, deduct: 0 };
    const earn = (detailRow.earn_breakdown ?? []).reduce((a, b) => a + asNum(b.amount), 0);
    const deduct = (detailRow.deduct_breakdown ?? []).reduce((a, b) => a + asNum(b.amount), 0);
    return { earn, deduct };
  }, [detailRow]);

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
          <button onClick={refresh} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={build}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Build
        </button>
        <button
          onClick={syncBase}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Sync Base
        </button>
        <button
          onClick={syncAbsent}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Sync Absent
        </button>
        <button
          onClick={recalc}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Recalc Statutories
        </button>
        <span className="mx-1 text-gray-300">|</span>
        <button
          onClick={lock}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Lock
        </button>
        <button
          onClick={unlock}
          disabled={disabledWrites}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            disabledWrites ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'
          }`}
        >
          Unlock
        </button>
        <button
          onClick={finalizeAndGenerate}
          disabled={disabledWrites}
          className={`ml-2 rounded px-3 py-1.5 text-sm font-semibold ${
            disabledWrites ? 'bg-blue-200 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          Finalize & Generate PDFs
        </button>
      </div>

      {/* Data / errors */}
      {loading && (
        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Loading…
        </div>
      )}

      {/* Table */}
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
              <th className="border-b px-3 py-2">Details</th>
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
                const absent = absentMap[r.staff_email] ?? 0;
                return (
                  <tr key={r.staff_email} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.staff_name ?? r.staff_email}
                      <div className="text-xs font-normal text-gray-500">{r.staff_email}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.base_wage, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_earn, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.manual_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.unpaid_auto, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.epf_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.socso_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.eis_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{fmt(r.net_pay, true)}</td>
                    <td className="px-3 py-2 text-center">{absent}</td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => openDetail(r)}
                      >
                        View
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
        Finalize uses your existing <code>/api/payroll/finalize</code> endpoint to generate & upload PDFs to your
        Supabase Storage bucket.
      </p>

      {/* Detail Modal */}
      {showDetail && detailRow && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDetail();
          }}
        >
          <div className="w-[min(900px,96vw)] rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b p-3">
              <div className="text-sm font-semibold">
                Details — {detailRow.staff_name ?? detailRow.staff_email}{' '}
                <span className="text-gray-500">({detailRow.staff_email})</span>
              </div>
              <button
                onClick={closeDetail}
                className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
              {/* Earnings */}
              <div>
                <div className="mb-2 text-sm font-semibold">Earnings</div>
                <div className="overflow-hidden rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border-b px-3 py-2 text-left">Label</th>
                        <th className="border-b px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailRow.earn_breakdown ?? []).length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-center text-gray-500" colSpan={2}>
                            No items
                          </td>
                        </tr>
                      ) : (
                        (detailRow.earn_breakdown ?? []).map((it, idx) => (
                          <tr key={`e-${idx}`} className="odd:bg-white even:bg-gray-50">
                            <td className="px-3 py-1.5">{it.label}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(it.amount, true)}
                            </td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-gray-50">
                        <td className="px-3 py-2 font-medium">Total</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {fmt(modalTotals.earn, true)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Deductions */}
              <div>
                <div className="mb-2 text-sm font-semibold">Deductions</div>
                <div className="overflow-hidden rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border-b px-3 py-2 text-left">Label</th>
                        <th className="border-b px-3 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailRow.deduct_breakdown ?? []).length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-center text-gray-500" colSpan={2}>
                            No items
                          </td>
                        </tr>
                      ) : (
                        (detailRow.deduct_breakdown ?? []).map((it, idx) => (
                          <tr key={`d-${idx}`} className="odd:bg-white even:bg-gray-50">
                            <td className="px-3 py-1.5">{it.label}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {fmt(it.amount, true)}
                            </td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-gray-50">
                        <td className="px-3 py-2 font-medium">Total</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {fmt(modalTotals.deduct, true)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t p-3 text-sm">
              <div className="mr-auto text-gray-600">
                Net pay:&nbsp;
                <b className="tabular-nums">{fmt(detailRow.net_pay, true)}</b>
              </div>
              <button
                onClick={closeDetail}
                className="rounded border px-3 py-1.5 hover:bg-gray-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
