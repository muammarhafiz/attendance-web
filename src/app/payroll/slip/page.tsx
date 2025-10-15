'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/** ===== Types (match your existing shapes) ===== */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string;
  unpaid_auto: number | string;
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  total_deduct: number | string;
  net_pay: number | string;
};

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string; // OPEN | LOCKED | FINALIZED
};

type ItemRow = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number | string;
};

function asNum(x: number | string | null | undefined) {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function cur(n: number | string) {
  const v = asNum(n);
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ============================================================
 *  Printable Payslip
 *  URL: /payroll/slip?year=YYYY&month=M&email=someone@example.com
 *  Data sources:
 *   - v_periods_min (or pay_v2.periods) => status / period id
 *   - v_payslip_admin_summary_v2        => main totals
 *   - list_manual_items()               => manual EARN/DEDUCT (excludes BASE/UNPAID/STAT_*)
 *   - pay_v2.items (UNPAID_ADJ/UNPAID_EXTRA) to compute Unpaid (final)
 * ============================================================ */
export default function PayslipPage() {
  const params = useSearchParams();
  const year = Number(params.get('year'));
  const month = Number(params.get('month'));
  const email = (params.get('email') || '').toLowerCase();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');
  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [sum, setSum] = useState<SummaryRow | null>(null);
  const [manualEarn, setManualEarn] = useState<ItemRow[]>([]);
  const [manualDeduct, setManualDeduct] = useState<ItemRow[]>([]);
  const [unpaidAdj, setUnpaidAdj] = useState<number>(0);   // EARN/UNPAID_ADJ
  const [unpaidExtra, setUnpaidExtra] = useState<number>(0); // DEDUCT/UNPAID_EXTRA

  const unpaidFinal = useMemo(() => {
    if (!sum) return 0;
    return Math.max(0, asNum(sum.unpaid_auto) + unpaidExtra - unpaidAdj);
  }, [sum, unpaidAdj, unpaidExtra]);

  const load = useCallback(async () => {
    if (!year || !month || !email) {
      setErr('Missing year, month or email in the URL.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr('');

    try {
      // 1) Period
      let periodData: PeriodRow | null = null;
      {
        const { data, error } = await supabase
          .from('v_periods_min')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .maybeSingle();
        if (error) throw error;
        periodData = data as PeriodRow | null;
        setPeriod(periodData);
      }

      // 2) Summary for this staff
      let summaryData: SummaryRow | null = null;
      {
        const { data, error } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .eq('staff_email', email)
          .maybeSingle();
        if (error) throw error;
        summaryData = (data as SummaryRow | null) ?? null;
        setSum(summaryData);
      }

      // 3) Manual items (EARN/DEDUCT only; excludes BASE/UNPAID/STAT_*)
      {
        const { data, error } = await supabase.rpc('list_manual_items', {
          p_year: year,
          p_month: month,
          p_email: email,
        });
        if (error) throw error;
        const rows = (data as ItemRow[]) ?? [];
        setManualEarn(rows.filter((r) => r.kind === 'EARN'));
        setManualDeduct(rows.filter((r) => r.kind === 'DEDUCT'));
      }

      // 4) UNPAID plumbing
      if (periodData?.id) {
        const { data, error } = await supabase
          .from('pay_v2.items')
          .select('code, amount')
          .eq('period_id', periodData.id)
          .eq('staff_email', email)
          .in('code', ['UNPAID_ADJ', 'UNPAID_EXTRA']);
        if (error) throw error;

        let adj = 0, extra = 0;
        (data ?? []).forEach((r: any) => {
          const code = (r.code || '').toUpperCase();
          if (code === 'UNPAID_ADJ') adj = asNum(r.amount);
          if (code === 'UNPAID_EXTRA') extra = asNum(r.amount);
        });
        setUnpaidAdj(adj);
        setUnpaidExtra(extra);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year, month, email]);

  useEffect(() => {
    load();
  }, [load]);

  const staffName = sum?.staff_name || email;

  return (
    <div className="min-h-screen bg-neutral-50 p-4 print:bg-white">
      {/* Inline styles for print */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff; }
          .sheet { box-shadow: none !important; margin: 0 !important; }
        }
        .mono { font-variant-numeric: tabular-nums; }
        .sheet {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: white;
          box-shadow: 0 1px 10px rgba(0,0,0,0.08);
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Payslip preview {sum ? `· ${sum.year}-${String(sum.month).padStart(2, '0')}` : ''}
        </div>
        <div className="flex gap-2">
          {/* FIXED: Back to /payroll/v2 to avoid 404 */}
          <a
            href={`/payroll/v2?year=${year}&month=${month}`}
            className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >Back</a>
          <button
            onClick={() => window.print()}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >Print</button>
        </div>
      </div>

      <div className="sheet rounded-md border p-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">PAYSLIP</h1>
            <div className="text-sm text-gray-600">
              Period: <b>{year}-{String(month).padStart(2, '0')}</b>
              {period?.status ? <> · Status: <b>{period.status}</b></> : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Generated:</div>
            <div className="text-sm">
              {new Date().toLocaleString('en-MY', { hour12: false })}
            </div>
          </div>
        </div>

        {/* Employee */}
        <div className="mb-6 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-gray-500">Employee</div>
            <div className="font-medium">{staffName}</div>
            <div className="text-gray-600">{email}</div>
          </div>
          <div>
            <div className="text-gray-500">Summary</div>
            {sum ? (
              <>
                <div>Base: <b className="mono">RM {cur(sum.base_wage)}</b></div>
                <div>Total Earn: <b className="mono">RM {cur(sum.total_earn)}</b></div>
                <div>Total Deduct: <b className="mono">RM {cur(sum.total_deduct)}</b></div>
                <div>Net Pay: <b className="mono">RM {cur(sum.net_pay)}</b></div>
              </>
            ) : (
              <div className="text-rose-600">No data.</div>
            )}
          </div>
        </div>

        {/* Tables */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Earnings */}
          <div>
            <div className="mb-2 text-sm font-semibold">Earnings</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Amount (RM)</th>
                </tr>
              </thead>
              <tbody>
                {/* Base salary */}
                {sum && (
                  <tr className="border-b">
                    <td className="px-2 py-1">Base salary</td>
                    <td className="mono px-2 py-1 text-right">{cur(sum.base_wage)}</td>
                  </tr>
                )}
                {/* Manual earnings */}
                {manualEarn.length === 0 ? (
                  <tr className="border-b">
                    <td className="px-2 py-1 text-gray-500">—</td>
                    <td className="px-2 py-1 text-right mono">0.00</td>
                  </tr>
                ) : manualEarn.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="px-2 py-1">{e.label || e.code}</td>
                    <td className="mono px-2 py-1 text-right">{cur(e.amount)}</td>
                  </tr>
                ))}
                {/* Earnings subtotal (from summary) */}
                {sum && (
                  <tr>
                    <td className="px-2 py-2 font-medium">Total earnings</td>
                    <td className="mono px-2 py-2 text-right font-medium">{cur(sum.total_earn)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Deductions */}
          <div>
            <div className="mb-2 text-sm font-semibold">Deductions</div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Amount (RM)</th>
                </tr>
              </thead>
              <tbody>
                {/* Unpaid (final) */}
                {sum && (
                  <tr className="border-b">
                    <td className="px-2 py-1">
                      Unpaid leave
                      <span className="ml-1 text-[11px] text-gray-500">
                        (auto {cur(sum.unpaid_auto)}{unpaidExtra ? ` + extra ${cur(unpaidExtra)}` : ''}{unpaidAdj ? ` – adj ${cur(unpaidAdj)}` : ''})
                      </span>
                    </td>
                    <td className="mono px-2 py-1 text-right">{cur(unpaidFinal)}</td>
                  </tr>
                )}

                {/* Manual deductions */}
                {manualDeduct.length === 0 ? (
                  <tr className="border-b">
                    <td className="px-2 py-1 text-gray-500">—</td>
                    <td className="px-2 py-1 text-right mono">0.00</td>
                  </tr>
                ) : manualDeduct.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="px-2 py-1">{d.label || d.code}</td>
                    <td className="mono px-2 py-1 text-right">{cur(d.amount)}</td>
                  </tr>
                ))}

                {/* Statutory (employee) */}
                {sum && (
                  <>
                    <tr className="border-b">
                      <td className="px-2 py-1">EPF (Emp)</td>
                      <td className="mono px-2 py-1 text-right">{cur(sum.epf_emp)}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="px-2 py-1">SOCSO (Emp)</td>
                      <td className="mono px-2 py-1 text-right">{cur(sum.socso_emp)}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="px-2 py-1">EIS (Emp)</td>
                      <td className="mono px-2 py-1 text-right">{cur(sum.eis_emp)}</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-2 font-medium">Total deductions</td>
                      <td className="mono px-2 py-2 text-right font-medium">{cur(sum.total_deduct)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Net */}
        <div className="mt-6 flex items-center justify-end">
          <div className="rounded border px-4 py-3">
            <div className="text-sm text-gray-600">Net pay</div>
            <div className="mono text-xl font-semibold">
              RM {sum ? cur(sum.net_pay) : '0.00'}
            </div>
          </div>
        </div>

        {/* Employer contributions (optional show) */}
        {sum && (
          <div className="mt-6 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="text-gray-500">Employer EPF: <b className="mono">RM {cur(sum.epf_er)}</b></div>
            <div className="text-gray-500">Employer SOCSO: <b className="mono">RM {cur(sum.socso_er)}</b></div>
            <div className="text-gray-500">Employer EIS: <b className="mono">RM {cur(sum.eis_er)}</b></div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center text-xs text-gray-500">
          This is a computer-generated payslip. No signature is required.
        </div>
      </div>

      {loading && (
        <div className="no-print fixed inset-x-0 bottom-4 mx-auto w-fit rounded border bg-white px-3 py-2 text-sm shadow">
          Loading…
        </div>
      )}
      {err && (
        <div className="no-print fixed inset-x-0 bottom-4 mx-auto w-fit rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow">
          {err}
        </div>
      )}
    </div>
  );
}
