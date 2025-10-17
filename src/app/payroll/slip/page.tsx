'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type SummaryRow = {
  year: number; month: number; staff_name: string | null; staff_email: string;
  base_wage: number | string; total_earn: number | string;
  unpaid_auto: number | string; manual_deduct: number | string;
  epf_emp: number | string; socso_emp: number | string; eis_emp: number | string;
  total_deduct: number | string; net_pay: number | string;
};

type PeriodRow = { id: string; status: string };

type ItemRow = {
  id: string; kind: 'EARN'|'DEDUCT'|string;
  code: string | null; label: string | null; amount: number | string;
};

const n = (x: number | string | null | undefined) =>
  typeof x === 'number' ? x : Number(x ?? 0) || 0;

const rm = (x: number | string) =>
  n(x).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isPlumbing = (code?: string | null) => {
  const c = (code || '').toUpperCase();
  return c === 'UNPAID_ADJ' || c === 'UNPAID_EXTRA';
};

export default function PayslipPage() {
  const sp = useSearchParams();
  const year  = Number(sp.get('year')  || 0);
  const month = Number(sp.get('month') || 0);
  const email = (sp.get('email') || '').toLowerCase();

  const periodKey = useMemo(
    () => `${year}-${String(month).padStart(2,'0')}`,
    [year, month]
  );

  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [sum, setSum] = useState<SummaryRow | null>(null);
  const [earnItems, setEarnItems] = useState<ItemRow[]>([]);
  const [deductItems, setDeductItems] = useState<ItemRow[]>([]);
  const [unpaidAdj, setUnpaidAdj] = useState(0);   // EARN/UNPAID_ADJ (offset)
  const [unpaidExtra, setUnpaidExtra] = useState(0); // DEDUCT/UNPAID_EXTRA (extra)
  const [loading, setLoading] = useState(true);

  const unpaidFinal = useMemo(() => {
    if (!sum) return 0;
    return Math.max(0, n(sum.unpaid_auto) + unpaidExtra - unpaidAdj);
  }, [sum, unpaidAdj, unpaidExtra]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) period id
      {
        const { data } = await supabase
          .from('v_periods_min')
          .select('id,status')
          .eq('year', year).eq('month', month)
          .maybeSingle();
        setPeriod((data as PeriodRow) ?? null);
      }

      // 2) summary row for this employee
      {
        const { data } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', year).eq('month', month)
          .eq('staff_email', email)
          .maybeSingle();
        setSum((data as SummaryRow) ?? null);
      }

      // 3) manual items (exclude base/unpaid/statutories)
      {
        const { data: listData } = await supabase.rpc('list_manual_items', {
          p_year: year, p_month: month, p_email: email,
        });
        const rows = (listData as ItemRow[]) ?? [];
        setEarnItems(rows.filter(r => r.kind === 'EARN' && !isPlumbing(r.code)));
        setDeductItems(rows.filter(r => r.kind === 'DEDUCT' && !isPlumbing(r.code)));
      }

      // 4) plumbing for unpaid final
      if (period?.id) {
        const { data } = await supabase
          .schema('pay_v2')
          .from('items')
          .select('code,amount')
          .eq('period_id', period.id)
          .eq('staff_email', email)
          .in('code', ['UNPAID_ADJ','UNPAID_EXTRA']);
        let adj = 0, extra = 0;
        (data ?? []).forEach((r: any) => {
          const c = (r.code || '').toUpperCase();
          if (c === 'UNPAID_ADJ') adj = n(r.amount);
          if (c === 'UNPAID_EXTRA') extra = n(r.amount);
        });
        setUnpaidAdj(adj);
        setUnpaidExtra(extra);
      }
    } finally {
      setLoading(false);
    }
  }, [year, month, email, period?.id]);

  useEffect(() => { if (year && month && email) load(); }, [load, year, month, email]);

  if (!year || !month || !email) {
    return <div className="p-6 text-sm text-gray-600">Missing year / month / email.</div>;
  }
  if (loading || !sum) {
    return <div className="p-6 text-sm text-gray-600">Loading…</div>;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Payslip</h1>
            <div className="text-sm text-gray-600">Period: {periodKey}</div>
          </div>
          <button
            onClick={() => window.print()}
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50 print:hidden"
          >
            Print
          </button>
        </div>

        <div className="mb-4">
          <div className="font-semibold">{sum.staff_name ?? sum.staff_email}</div>
          <a className="text-sm text-blue-600 underline" href={`mailto:${sum.staff_email}`}>{sum.staff_email}</a>
        </div>

        {/* Earnings — classic layout: Base + manual earnings, NO "Total earnings" row */}
        <section className="mb-4 rounded border">
          <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Earnings</div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="border-b px-3 py-2">Description</th>
                <th className="border-b px-3 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b px-3 py-2">Base salary</td>
                <td className="border-b px-3 py-2 text-right tabular-nums">{rm(sum.base_wage)}</td>
              </tr>
              {earnItems.map(it => (
                <tr key={it.id}>
                  <td className="border-b px-3 py-2">{it.label || it.code}</td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">{rm(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Deductions — show Unpaid leave ONLY when final > 0 */}
        <section className="mb-4 rounded border">
          <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Deductions</div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="border-b px-3 py-2">Description</th>
                <th className="border-b px-3 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {unpaidFinal > 0 && (
                <tr>
                  <td className="border-b px-3 py-2">Unpaid leave</td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">{rm(unpaidFinal)}</td>
                </tr>
              )}
              <tr>
                <td className="border-b px-3 py-2">EPF (Employee)</td>
                <td className="border-b px-3 py-2 text-right tabular-nums">{rm(sum.epf_emp)}</td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2">SOCSO (Employee)</td>
                <td className="border-b px-3 py-2 text-right tabular-nums">{rm(sum.socso_emp)}</td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2">EIS (Employee)</td>
                <td className="border-b px-3 py-2 text-right tabular-nums">{rm(sum.eis_emp)}</td>
              </tr>
              {deductItems.map(it => (
                <tr key={it.id}>
                  <td className="border-b px-3 py-2">{it.label || it.code}</td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">{rm(it.amount)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-medium">
                <td className="px-3 py-2">Total deductions</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(sum.total_deduct)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Net pay */}
        <div className="mb-2 rounded border px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Net pay</div>
            <div className="tabular-nums font-semibold">RM {rm(sum.net_pay)}</div>
          </div>
        </div>

        <div className="text-[11px] text-gray-500">
          Note: “Unpaid leave” is displayed only when the final computed value is &gt; 0. Internal plumbing items
          (UNPAID_ADJ / UNPAID_EXTRA) are hidden.
        </div>
      </div>
    </main>
  );
}
