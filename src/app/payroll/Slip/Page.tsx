'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/** ================= Company Header (edit these to your details) ================= */
const COMPANY = {
  name: 'Your Company Sdn Bhd',
  regNo: 'SSM: 1234567-X',
  addressLine1: 'No. 1, Jalan Contoh',
  addressLine2: '47000 Sungai Buloh, Selangor',
};

/** ================= Types (extend to match your views) ================= */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;

  // core totals
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string;
  unpaid_auto: number | string;

  // statutory (employee)
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  pcb_emp?: number | string | null;     // optional in your view
  zakat_emp?: number | string | null;   // optional in your view
  hrdf_emp?: number | string | null;    // optional in your view

  // statutory (employer)
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  pcb_er?: number | string | null;      // rarely used, safe default 0
  zakat_er?: number | string | null;    // rarely used, safe default 0
  hrdf_er?: number | string | null;     // if tracked, safe default 0

  // legacy totals
  total_deduct: number | string;
  net_pay: number | string;

  // optional staff meta (rendered with "–" fallback)
  nric?: string | null;
  employee_id?: string | null;
  epf_no?: string | null;
  socso_no?: string | null;
  eis_no?: string | null;
  pcb_no?: string | null;
  department?: string | null;
  job_title?: string | null;
  nationality?: string | null;
  gender?: string | null;
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
function dash(s?: string | null) {
  return s && String(s).trim() ? String(s) : '–';
}

/** =============================================================================
 *  Printable Payslip (Gross → Contributions → Net Earnings → Totals)
 *  URL: /payroll/slip?year=YYYY&month=M&email=someone@example.com
 *  Data:
 *    - v_periods_min                     => status / id
 *    - v_payslip_admin_summary_v2        => totals + staff meta (if present)
 *    - list_manual_items()               => manual EARN/DEDUCT (excludes BASE/UNPAID/STAT_*)
 *    - pay_v2.items (UNPAID_ADJ/UNPAID_EXTRA) to compute final Unpaid
 * ============================================================================= */
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
  const [unpaidAdj, setUnpaidAdj] = useState<number>(0);     // EARN/UNPAID_ADJ
  const [unpaidExtra, setUnpaidExtra] = useState<number>(0); // DEDUCT/UNPAID_EXTRA

  /** Final unpaid as per your rules */
  const unpaidFinal = useMemo(() => {
    if (!sum) return 0;
    return Math.max(0, asNum(sum.unpaid_auto) + unpaidExtra - unpaidAdj);
  }, [sum, unpaidAdj, unpaidExtra]);

  /** Gross pay (base minus unpaid) */
  const grossPay = useMemo(() => {
    if (!sum) return 0;
    return Math.max(0, asNum(sum.base_wage) - asNum(unpaidFinal));
  }, [sum, unpaidFinal]);

  /** Employee contributions total (subtract from net) */
  const empContribTotal = useMemo(() => {
    if (!sum) return 0;
    return (
      asNum(sum.epf_emp) +
      asNum(sum.socso_emp) +
      asNum(sum.eis_emp) +
      asNum(sum.pcb_emp) +
      asNum(sum.zakat_emp) +
      asNum(sum.hrdf_emp)
    );
  }, [sum]);

  /** Net earnings (manual items only, EARN positive, DEDUCT negative) */
  const netEarningsSum = useMemo(() => {
    const earn = manualEarn.reduce((a, r) => a + asNum(r.amount), 0);
    const deduct = manualDeduct.reduce((a, r) => a + asNum(r.amount), 0);
    return earn - deduct;
  }, [manualEarn, manualDeduct]);

  /** Final net (display) */
  const finalNet = useMemo(() => {
    return Math.max(0, asNum(grossPay) - asNum(empContribTotal) + asNum(netEarningsSum));
  }, [grossPay, empContribTotal, netEarningsSum]);

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

      // 2) Summary
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

      // 4) UNPAID adj/extra
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
  const monthName = useMemo(
    () =>
      new Date(year || 2000, (month || 1) - 1, 1).toLocaleString('en-MY', {
        month: 'long',
        year: 'numeric',
      }),
    [year, month]
  );

  return (
    <div className="min-h-screen bg-neutral-50 p-4 print:bg-white">
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff; }
          .sheet { box-shadow: none !important; margin: 0 !important; }
          .screen-only { display: none !important; }
          .avoid-break { break-inside: avoid; page-break-inside: avoid; }
        }
        .mono { font-variant-numeric: tabular-nums; }
        .sheet {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: white;
          box-shadow: 0 1px 10px rgba(0,0,0,0.08);
        }
        .table th, .table td { border-bottom: 1px solid #e5e7eb; }
      `}</style>

      {/* Toolbar (screen only) */}
      <div className="no-print mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Payslip preview {sum ? `· ${sum.year}-${String(sum.month).padStart(2, '0')}` : ''}
        </div>
        <div className="flex gap-2">
          <a
            href={`/payroll?year=${year}&month=${month}`}
            className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Back
          </a>
          <button
            onClick={() => window.print()}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Print
          </button>
        </div>
      </div>

      <div className="sheet rounded-md border p-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div className="max-w-[70%]">
            <div className="text-lg font-semibold">{COMPANY.name}</div>
            <div className="text-sm text-gray-700">{COMPANY.addressLine1}</div>
            <div className="text-sm text-gray-700">{COMPANY.addressLine2}</div>
            <div className="text-sm text-gray-500">{COMPANY.regNo}</div>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold">Payslip for {monthName}</div>
            <div className="text-sm text-gray-600">
              Issued on:{' '}
              {new Date().toLocaleDateString('en-MY', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </div>
            <div className="screen-only mt-1 text-xs text-gray-500">
              Generated: {new Date().toLocaleString('en-MY', { hour12: false })}
            </div>
          </div>
        </div>

        {/* Employee Panel */}
        <div className="mb-6 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="space-y-0.5">
            <div className="text-gray-500">Employee</div>
            <div className="font-medium">{staffName}</div>
            <div className="text-gray-600">{email}</div>
            <div>Department: <b>{dash(sum?.department)}</b></div>
            <div>Job Title: <b>{dash(sum?.job_title)}</b></div>
            <div>Nationality: <b>{dash(sum?.nationality)}</b></div>
          </div>
          <div className="space-y-0.5">
            <div className="text-gray-500">Identifiers</div>
            <div>NRIC/Passport: <b>{dash(sum?.nric)}</b></div>
            <div>Employee ID: <b>{dash(sum?.employee_id)}</b></div>
            <div>EPF No: <b>{dash(sum?.epf_no)}</b></div>
            <div>SOCSO No: <b>{dash(sum?.socso_no)}</b></div>
            <div>EIS No: <b>{dash(sum?.eis_no)}</b></div>
            <div>PCB No: <b>{dash(sum?.pcb_no)}</b></div>
          </div>
        </div>

        {/* A) Gross Earnings */}
        <div className="avoid-break">
          <div className="mb-2 text-sm font-semibold">Gross Earnings</div>
          <table className="table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left">Description</th>
                <th className="px-2 py-2 text-right">Units</th>
                <th className="px-2 py-2 text-right">Rate (RM)</th>
                <th className="px-2 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {/* Salary */}
              <tr>
                <td className="px-2 py-1">Salary</td>
                <td className="px-2 py-1 text-right">—</td>
                <td className="px-2 py-1 text-right">—</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.base_wage) : '0.00'}</td>
              </tr>

              {/* Unpaid Leave (negative) */}
              <tr>
                <td className="px-2 py-1">
                  Unpaid Leave
                  <span className="ml-1 text-[11px] text-gray-500 screen-only">
                    (auto {sum ? cur(sum.unpaid_auto) : '0.00'}
                    {unpaidExtra ? ` + extra ${cur(unpaidExtra)}` : ''}
                    {unpaidAdj ? ` – adj ${cur(unpaidAdj)}` : ''})
                  </span>
                </td>
                <td className="px-2 py-1 text-right">—</td>
                <td className="px-2 py-1 text-right">—</td>
                <td className="mono px-2 py-1 text-right">-{cur(unpaidFinal)}</td>
              </tr>

              {/* Gross subtotal */}
              <tr>
                <td className="px-2 py-2 font-medium">Gross pay</td>
                <td />
                <td />
                <td className="mono px-2 py-2 text-right font-medium">{cur(grossPay)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* B) Contributions (Employee & Employer) */}
        <div className="avoid-break mt-6">
          <div className="mb-2 text-sm font-semibold">Contributions</div>
          <table className="table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left">Type</th>
                <th className="px-2 py-2 text-right">EPF</th>
                <th className="px-2 py-2 text-right">SOCSO</th>
                <th className="px-2 py-2 text-right">EIS</th>
                <th className="px-2 py-2 text-right">Zakat</th>
                <th className="px-2 py-2 text-right">PCB</th>
                <th className="px-2 py-2 text-right">HRDF</th>
                <th className="px-2 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {/* Employee row */}
              <tr>
                <td className="px-2 py-1">Employee</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.epf_emp) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.socso_emp) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.eis_emp) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.zakat_emp ?? 0) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.pcb_emp ?? 0) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.hrdf_emp ?? 0) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right font-medium">-{cur(empContribTotal)}</td>
              </tr>

              {/* Employer row */}
              <tr>
                <td className="px-2 py-1">Employer</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.epf_er) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.socso_er) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.eis_er) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.zakat_er ?? 0) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.pcb_er ?? 0) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right">{sum ? cur(sum.hrdf_er ?? 0) : '0.00'}</td>
                <td className="mono px-2 py-1 text-right text-gray-500">info</td>
              </tr>
            </tbody>
          </table>

          {/* Footnotes (edit text to match your slip; kept minimal here) */}
          <div className="mt-2 text-xs text-gray-500">
            1) Employee contributions are deducted from Net Pay. Employer contributions are informational and do not reduce Net Pay.
          </div>
        </div>

        {/* C) Net Earnings (manual items only) */}
        <div className="avoid-break mt-6">
          <div className="mb-2 text-sm font-semibold">Net Earnings</div>
          <table className="table w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left">Description</th>
                <th className="px-2 py-2 text-right">Units</th>
                <th className="px-2 py-2 text-right">Rate (RM)</th>
                <th className="px-2 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {/* Manual EARN rows (positive) */}
              {manualEarn.map((e) => (
                <tr key={e.id}>
                  <td className="px-2 py-1">{e.label || e.code}</td>
                  <td className="px-2 py-1 text-right">—</td>
                  <td className="px-2 py-1 text-right">—</td>
                  <td className="mono px-2 py-1 text-right">{cur(e.amount)}</td>
                </tr>
              ))}

              {/* Manual DEDUCT rows (negative) */}
              {manualDeduct.map((d) => (
                <tr key={d.id}>
                  <td className="px-2 py-1">{d.label || d.code}</td>
                  <td className="px-2 py-1 text-right">—</td>
                  <td className="px-2 py-1 text-right">—</td>
                  <td className="mono px-2 py-1 text-right">-{cur(d.amount)}</td>
                </tr>
              ))}

              {/* Empty state */}
              {manualEarn.length + manualDeduct.length === 0 && (
                <tr>
                  <td className="px-2 py-1 text-gray-500">—</td>
                  <td className="px-2 py-1 text-right">—</td>
                  <td className="px-2 py-1 text-right">—</td>
                  <td className="mono px-2 py-1 text-right">0.00</td>
                </tr>
              )}

              {/* Subtotal */}
              <tr>
                <td className="px-2 py-2 font-medium">Net earnings sum</td>
                <td />
                <td />
                <td className="mono px-2 py-2 text-right font-medium">{cur(netEarningsSum)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totals box */}
        <div className="avoid-break mt-6 flex items-start justify-end">
          <div className="rounded border px-4 py-3">
            <div className="text-sm text-gray-600">Net pay</div>
            <div className="mono text-xl font-semibold">RM {cur(finalNet)}</div>
            <div className="mt-2 text-xs text-gray-500">
              Taxable pay: <b className="mono">RM {cur(grossPay)}</b>
            </div>

            {/* Optional reconciliation line (screen only, to verify against DB net) */}
            <div className="screen-only mt-1 text-[11px] text-gray-400">
              (DB net_pay for sanity: RM {sum ? cur(sum.net_pay) : '0.00'})
            </div>
          </div>
        </div>

        {/* Employer contributions info row */}
        {sum && (
          <div className="mt-6 grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-3">
            <div>Employer EPF: <b className="mono">RM {cur(sum.epf_er)}</b></div>
            <div>Employer SOCSO: <b className="mono">RM {cur(sum.socso_er)}</b></div>
            <div>Employer EIS: <b className="mono">RM {cur(sum.eis_er)}</b></div>
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
