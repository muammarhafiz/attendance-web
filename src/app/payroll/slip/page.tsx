'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  base_wage: number | string;
  total_earn: number | string;
  manual_deduct: number | string;
  unpaid_auto: number | string;
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  total_deduct: number | string;
  net_pay: number | string;
};

type ItemRow = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number | string;
};

function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number | string) {
  return asNum(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad2(m: number) {
  return String(m).padStart(2, '0');
}

export default function PayslipPage() {
  const params = useSearchParams();
  const pYear = Number(params.get('year') ?? '');
  const pMonth = Number(params.get('month') ?? '');
  const emailRaw = (params.get('email') ?? '').toLowerCase().trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [earnItems, setEarnItems] = useState<ItemRow[]>([]);
  const [deductItems, setDeductItems] = useState<ItemRow[]>([]);
  const [unpaidAdj, setUnpaidAdj] = useState(0);   // EARN/UNPAID_ADJ (reduces unpaid)
  const [unpaidExtra, setUnpaidExtra] = useState(0); // DEDUCT/UNPAID_EXTRA (adds unpaid)
  const [employeeName, setEmployeeName] = useState<string>('');

  const yyyymm = `${pYear || '—'}-${pad2(pMonth || 0)}`;

  const finalUnpaid = useMemo(
    () => Math.max(0, asNum(summary?.unpaid_auto) + unpaidExtra - unpaidAdj),
    [summary?.unpaid_auto, unpaidAdj, unpaidExtra]
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        if (!pYear || !pMonth || !emailRaw) {
          setErr('Missing year/month/email.');
          setLoading(false);
          return;
        }

        // 1) Period id (for plumbing lookup)
        const { data: period, error: pErr } = await supabase
          .from('v_periods_min')
          .select('id')
          .eq('year', pYear)
          .eq('month', pMonth)
          .maybeSingle();
        if (pErr) throw pErr;
        const periodId = period?.id;

        // 2) Summary for this employee
        const { data: sData, error: sErr } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', pYear)
          .eq('month', pMonth)
          .eq('staff_email', emailRaw)
          .maybeSingle();
        if (sErr) throw sErr;
        setSummary((sData as SummaryRow) ?? null);
        setEmployeeName((sData?.staff_name as string) || emailRaw);

        // 3) Manual items (function excludes BASE/UNPAID/STAT_* automatically)
        const { data: listData, error: listErr } = await supabase.rpc('list_manual_items', {
          p_year: pYear,
          p_month: pMonth,
          p_email: emailRaw,
        });
        if (listErr) throw listErr;

        // Hide plumbing if the function ever returns them
        const isPlumbing = (code?: string | null) => {
          const c = (code || '').toUpperCase();
          return c === 'UNPAID_ADJ' || c === 'UNPAID_EXTRA';
        };
        const rows = (listData as ItemRow[]) ?? [];
        setEarnItems(rows.filter((r) => r.kind === 'EARN' && !isPlumbing(r.code)));
        setDeductItems(rows.filter((r) => r.kind === 'DEDUCT' && !isPlumbing(r.code)));

        // 4) Read plumbing directly to compute final unpaid
        if (periodId) {
          const { data: plumb, error: plErr } = await supabase
            .schema('pay_v2')
            .from('items')
            .select('code, amount')
            .eq('period_id', periodId)
            .eq('staff_email', emailRaw)
            .in('code', ['UNPAID_ADJ', 'UNPAID_EXTRA']);
          if (plErr) throw plErr;

          let adj = 0,
            extra = 0;
          (plumb ?? []).forEach((r: any) => {
            const c = (r.code || '').toUpperCase();
            if (c === 'UNPAID_ADJ') adj = asNum(r.amount);
            if (c === 'UNPAID_EXTRA') extra = asNum(r.amount);
          });
          setUnpaidAdj(adj);
          setUnpaidExtra(extra);
        } else {
          setUnpaidAdj(0);
          setUnpaidExtra(0);
        }
      } catch (e: any) {
        setErr(e.message || 'Failed to load payslip.');
      } finally {
        setLoading(false);
      }
    })();
  }, [pYear, pMonth, emailRaw]);

  const sum = (xs: ItemRow[]) => xs.reduce((a, x) => a + asNum(x.amount), 0);

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0">
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          main { padding: 0 !important; }
          .card { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="card rounded-lg border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">Payslip</h1>
            <div className="text-sm text-gray-600">Period: {yyyymm}</div>
            {summary && (
              <div className="mt-3">
                <div className="font-medium">{employeeName}</div>
                <div className="text-sm text-gray-600">{summary.staff_email}</div>
              </div>
            )}
          </div>
          <button onClick={() => window.print()} className="no-print rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
            Print
          </button>
        </div>

        {loading && <div className="text-sm text-gray-600">Loading…</div>}
        {err && <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}

        {!loading && !err && summary && (
          <>
            {/* Earnings */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Earnings</h2>
              <div className="overflow-hidden rounded border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border-b px-3 py-2 text-left">Description</th>
                      <th className="border-b px-3 py-2 text-right">Amount (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2">Base salary</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(summary.base_wage)}</td>
                    </tr>
                    {earnItems.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2">{it.label || it.code || ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-medium">
                      <td className="px-3 py-2">Total earnings</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(summary.total_earn)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* Deductions */}
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Deductions</h2>
              <div className="overflow-hidden rounded border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border-b px-3 py-2 text-left">Description</th>
                      <th className="border-b px-3 py-2 text-right">Amount (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Unpaid leave — ONLY if > 0 */}
                    {finalUnpaid > 0 && (
                      <tr>
                        <td className="px-3 py-2">Unpaid leave</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(finalUnpaid)}</td>
                      </tr>
                    )}

                    {/* Manual deductions (Advance, Penalty, etc.) */}
                    {deductItems.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2">{it.label || it.code || ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(it.amount)}</td>
                      </tr>
                    ))}

                    {/* Statutories (employee only) */}
                    <tr>
                      <td className="px-3 py-2">EPF (Employee)</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(summary.epf_emp)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2">SOCSO (Employee)</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(summary.socso_emp)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2">EIS (Employee)</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(summary.eis_emp)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-medium">
                      <td className="px-3 py-2">Total deductions</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(summary.total_deduct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* Net pay */}
            <section>
              <div className="flex items-center justify-between rounded border bg-gray-50 px-4 py-3">
                <div className="text-sm font-semibold">Net pay</div>
                <div className="tabular-nums text-lg font-semibold">RM {fmt(summary.net_pay)}</div>
              </div>
            </section>

            {/* Tiny reconciliation note (optional, non-print) */}
            <p className="no-print mt-3 text-xs text-gray-500">
              Note: “Unpaid leave” shows only when final value &gt; 0. Internal plumbing items (UNPAID_ADJ / UNPAID_EXTRA) are hidden.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
