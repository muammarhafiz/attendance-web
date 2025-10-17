// src/app/payroll/slip/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/* ========= Types ========= */
type SummaryRow = {
  year: number; month: number;
  staff_name: string | null; staff_email: string;
  base_wage: number | string;
  unpaid_auto: number | string;
  epf_emp: number | string; socso_emp: number | string; eis_emp: number | string;
  net_pay: number | string;
};

type PeriodRow = { id: string; status: string };

type ItemRow = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number | string;
};

/* ========= Company header (edit to your real info) ========= */
const COMPANY = {
  name: 'ZAKI ENTERPRISE SDN. BHD.',
  regNo: 'Reg. No: 1234567-X',
  address: [
    'No. 11, Jalan Contoh 3/2,',
    'Taman Contoh Industri,',
    '43000 Kajang, Selangor',
  ],
  phone: '+60 3-1234 5678',
  email: 'accounts@zaki.com',
};

/* ========= Helpers ========= */
const n = (x: number | string | null | undefined) =>
  typeof x === 'number' ? x : Number(x ?? 0) || 0;

const rm = (x: number | string) =>
  n(x).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isPlumbing = (code?: string | null) => {
  const c = (code || '').toUpperCase();
  return c === 'UNPAID_ADJ' || c === 'UNPAID_EXTRA';
};

/* ========= Page ========= */
export default function PayslipPage() {
  const sp = useSearchParams();
  const year = Number(sp.get('year') || 0);
  const month = Number(sp.get('month') || 0);
  const email = (sp.get('email') || '').toLowerCase();

  const yyyymm = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [sum, setSum] = useState<SummaryRow | null>(null);
  const [earnItems, setEarnItems] = useState<ItemRow[]>([]);
  const [deductItems, setDeductItems] = useState<ItemRow[]>([]);
  const [unpaidAdj, setUnpaidAdj] = useState(0);    // EARN/UNPAID_ADJ
  const [unpaidExtra, setUnpaidExtra] = useState(0); // DEDUCT/UNPAID_EXTRA
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // computed “final” unpaid
  const unpaidFinal = useMemo(() => {
    if (!sum) return 0;
    return Math.max(0, n(sum.unpaid_auto) + unpaidExtra - unpaidAdj);
  }, [sum, unpaidAdj, unpaidExtra]);

  // totals for tables (only visible rows)
  const totalEarningsDisplay = useMemo(() => {
    if (!sum) return 0;
    const base = n(sum.base_wage);
    const manualEarn = earnItems.reduce((a, r) => a + n(r.amount), 0);
    return base + manualEarn;
  }, [sum, earnItems]);

  const manualDeductTotal = useMemo(
    () => deductItems.reduce((a, r) => a + n(r.amount), 0),
    [deductItems]
  );

  const totalDeductionsDisplay = useMemo(() => {
    if (!sum) return 0;
    return (
      (unpaidFinal > 0 ? unpaidFinal : 0) +
      n(sum.epf_emp) + n(sum.socso_emp) + n(sum.eis_emp) +
      manualDeductTotal
    );
  }, [sum, unpaidFinal, manualDeductTotal]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // 1) Period id/status
      const { data: per } = await supabase
        .from('v_periods_min')
        .select('id,status')
        .eq('year', year).eq('month', month)
        .maybeSingle();
      setPeriod((per as PeriodRow) ?? null);

      // 2) Main summary for staff
      const { data: s } = await supabase
        .from('v_payslip_admin_summary_v2')
        .select('*')
        .eq('year', year).eq('month', month).eq('staff_email', email)
        .maybeSingle();
      setSum((s as SummaryRow) ?? null);

      // 3) Manual items (cleaned; plumbing hidden)
      const { data: listData } = await supabase.rpc('list_manual_items', {
        p_year: year, p_month: month, p_email: email,
      });
      const rows = (listData as ItemRow[]) ?? [];
      setEarnItems(rows.filter(r => r.kind === 'EARN' && !isPlumbing(r.code)));
      setDeductItems(rows.filter(r => r.kind === 'DEDUCT' && !isPlumbing(r.code)));

      // 4) Get plumbing values for final unpaid calc
      if (per?.id) {
        const { data: plumb } = await supabase
          .schema('pay_v2')
          .from('items')
          .select('code,amount')
          .eq('period_id', per.id)
          .eq('staff_email', email)
          .in('code', ['UNPAID_ADJ', 'UNPAID_EXTRA']);
        let adj = 0, extra = 0;
        (plumb ?? []).forEach((r: any) => {
          const c = (r.code ?? '').toUpperCase();
          if (c === 'UNPAID_ADJ') adj = n(r.amount);
          if (c === 'UNPAID_EXTRA') extra = n(r.amount);
        });
        setUnpaidAdj(adj);
        setUnpaidExtra(extra);
      } else {
        setUnpaidAdj(0); setUnpaidExtra(0);
      }
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [year, month, email]);

  useEffect(() => { if (year && month && email) load(); }, [load, year, month, email]);

  if (loading) {
    return <main className="mx-auto max-w-5xl p-6 text-sm text-gray-600">Loading payslip…</main>;
  }
  if (err || !sum) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {err ?? 'Payslip not found.'}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mx-auto rounded-lg border bg-white p-5 shadow-sm print:shadow-none print:border-0 print:p-0">
        {/* Header with company block (classic layout) */}
        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
          <div>
            <h1 className="text-xl font-semibold">{COMPANY.name}</h1>
            <div className="text-xs text-gray-600">{COMPANY.regNo}</div>
            <div className="mt-1 whitespace-pre-line text-sm text-gray-700">
              {COMPANY.address.join('\n')}
            </div>
            <div className="mt-1 text-sm text-gray-700">
              {COMPANY.phone} · {COMPANY.email}
            </div>
          </div>
          <div className="flex items-start justify-between md:justify-end">
            <div className="text-right">
              <div className="text-2xl font-semibold">Payslip</div>
              <div className="text-sm text-gray-600">Period: {yyyymm}</div>
              {period?.status && (
                <div className="mt-1 inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  Status: {period.status}
                </div>
              )}
            </div>
            <button
              onClick={() => window.print()}
              className="ml-3 hidden rounded border px-3 py-1.5 text-sm hover:bg-gray-50 print:hidden md:inline-block"
            >
              Print
            </button>
          </div>
        </div>

        {/* Employee */}
        <div className="mb-4">
          <div className="text-sm font-semibold">
            {sum.staff_name ?? sum.staff_email}
          </div>
          <div className="text-sm text-blue-700 underline">{sum.staff_email}</div>
        </div>

        {/* Earnings */}
        <section className="mb-4 rounded border">
          <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Earnings</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-white text-left">
                <th className="w-3/5 border-b px-3 py-2">Description</th>
                <th className="w-2/5 border-b px-3 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b px-3 py-2">Base salary</td>
                <td className="border-b px-3 py-2 text-right">{rm(sum.base_wage)}</td>
              </tr>
              {earnItems.map((it) => (
                <tr key={it.id}>
                  <td className="border-b px-3 py-2">{it.label || it.code}</td>
                  <td className="border-b px-3 py-2 text-right">{rm(it.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-medium">
                <td className="border-t px-3 py-2">Total earnings</td>
                <td className="border-t px-3 py-2 text-right">{rm(totalEarningsDisplay)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Deductions */}
        <section className="mb-4 rounded border">
          <div className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold">Deductions</div>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-white text-left">
                <th className="w-3/5 border-b px-3 py-2">Description</th>
                <th className="w-2/5 border-b px-3 py-2 text-right">Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {unpaidFinal > 0 && (
                <tr>
                  <td className="border-b px-3 py-2">Unpaid leave</td>
                  <td className="border-b px-3 py-2 text-right">{rm(unpaidFinal)}</td>
                </tr>
              )}
              <tr>
                <td className="border-b px-3 py-2">EPF (Employee)</td>
                <td className="border-b px-3 py-2 text-right">{rm(sum.epf_emp)}</td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2">SOCSO (Employee)</td>
                <td className="border-b px-3 py-2 text-right">{rm(sum.socso_emp)}</td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2">EIS (Employee)</td>
                <td className="border-b px-3 py-2 text-right">{rm(sum.eis_emp)}</td>
              </tr>

              {deductItems.map((it) => (
                <tr key={it.id}>
                  <td className="border-b px-3 py-2">
                    {it.label || it.code}
                  </td>
                  <td className="border-b px-3 py-2 text-right">{rm(it.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-medium">
                <td className="border-t px-3 py-2">Total deductions</td>
                <td className="border-t px-3 py-2 text-right">{rm(totalDeductionsDisplay)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Net pay */}
        <section className="rounded border">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="font-semibold">Net pay</div>
            <div className="tabular-nums font-semibold">RM {rm(sum.net_pay)}</div>
          </div>
        </section>

        {/* Note */}
        <p className="mt-2 text-[11px] text-gray-500">
          Note: “Unpaid leave” is displayed only when the computed final value is &gt; 0.
          Internal plumbing items (UNPAID_ADJ / UNPAID_EXTRA) are hidden from this slip.
        </p>

        {/* Print button for small screens */}
        <div className="mt-4 flex justify-end md:hidden print:hidden">
          <button onClick={() => window.print()} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
            Print
          </button>
        </div>
      </div>
    </main>
  );
}
