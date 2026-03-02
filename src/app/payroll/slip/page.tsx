'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/* ============================================================
   Types
============================================================ */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string;
  unpaid_auto: number | string; // auto UNPAID (from attendance)
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

type StaffRow = {
  email: string;
  full_name: string | null;
  name: string | null;
  position: string | null;
  nric: string | null;
  phone: string | null;
};

type ManualItem = {
  id: string;
  kind: string; // 'EARN' | 'DEDUCT' | ...
  code: string | null;
  label: string | null;
  amount: number | string;
};

/* ============================================================
   Helpers
============================================================ */
function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function cur(x: number | string | null | undefined): string {
  const v = asNum(x);
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ymText(y: number, m: number) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

function isPlumbingCode(code?: string | null) {
  const c = (code || '').toUpperCase();
  return c === 'UNPAID_ADJ' || c === 'UNPAID_EXTRA' || c === 'UNPAID';
}

function safeUpper(x?: string | null) {
  return (x || '').toUpperCase();
}

/* ============================================================
   Page
============================================================ */
export default function PayslipPage() {
  const sp = useSearchParams();
  const year = Number(sp.get('year') || 0);
  const month = Number(sp.get('month') || 0);
  const email = (sp.get('email') || '').trim().toLowerCase();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>('');

  const [sum, setSum] = useState<SummaryRow | null>(null);
  const [staff, setStaff] = useState<StaffRow | null>(null);

  // manual items (already filtered on server, but we filter again defensively)
  const [manualEarn, setManualEarn] = useState<ManualItem[]>([]);
  const [manualDeduct, setManualDeduct] = useState<ManualItem[]>([]);

  // plumbing amounts
  const [unpaidAdj, setUnpaidAdj] = useState<number>(0);     // EARN/UNPAID_ADJ
  const [unpaidExtra, setUnpaidExtra] = useState<number>(0); // DEDUCT/UNPAID_EXTRA

  const periodLabel = useMemo(() => ymText(year, month), [year, month]);

  const unpaidAuto = useMemo(() => asNum(sum?.unpaid_auto), [sum]);

  // Final Unpaid shown on payslip: ONE number, ONE place (Deductions)
  const unpaidFinal = useMemo(() => {
    // final = auto + extra - adj (clamped at >= 0)
    return Math.max(0, unpaidAuto + unpaidExtra - unpaidAdj);
  }, [unpaidAuto, unpaidExtra, unpaidAdj]);

  // Display totals (so payslip stays consistent even if plumbing exists)
  const displayTotalEarn = useMemo(() => {
    // Remove UNPAID_ADJ from displayed earnings (it's not a real earning)
    const totalEarn = asNum(sum?.total_earn);
    return Math.max(0, totalEarn - unpaidAdj);
  }, [sum, unpaidAdj]);

  const displayTotalDeduct = useMemo(() => {
    // Replace (auto unpaid + unpaid extra) with ONE unpaidFinal line.
    const totalDeduct = asNum(sum?.total_deduct);
    const deductWithoutUnpaid = totalDeduct - unpaidAuto - unpaidExtra;
    return Math.max(0, deductWithoutUnpaid + unpaidFinal);
  }, [sum, unpaidAuto, unpaidExtra, unpaidFinal]);

  const displayNetPay = useMemo(() => {
    // Use display totals to keep the payslip internally consistent
    return Math.max(0, displayTotalEarn - displayTotalDeduct);
  }, [displayTotalEarn, displayTotalDeduct]);

  useEffect(() => {
    (async () => {
      setErr('');
      if (!year || !month || !email) {
        setErr('Missing query params. Expected year, month, email.');
        return;
      }

      setLoading(true);
      try {
        // 1) Summary row (public view)
        const { data: sData, error: sErr } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .eq('staff_email', email)
          .maybeSingle();

        if (sErr) throw sErr;
        if (!sData) {
          setSum(null);
          setStaff(null);
          setManualEarn([]);
          setManualDeduct([]);
          setUnpaidAdj(0);
          setUnpaidExtra(0);
          setErr(`No payslip data for ${email} in ${periodLabel}.`);
          return;
        }
        setSum(sData as SummaryRow);

        // 2) Staff details for header
        const { data: stData, error: stErr } = await supabase
          .from('staff')
          .select('email, full_name, name, position, nric, phone')
          .eq('email', email)
          .maybeSingle();

        if (stErr) throw stErr;
        setStaff((stData as StaffRow) ?? null);

        // 3) Manual items (exclude BASE/UNPAID/STAT_* server-side; still re-filter)
        const { data: items, error: iErr } = await supabase.rpc('list_manual_items', {
          p_year: year,
          p_month: month,
          p_email: email,
        });
        if (iErr) throw iErr;

        const list = (items as ManualItem[]) ?? [];
        const earn = list
          .filter((r) => safeUpper(r.kind) === 'EARN' && !isPlumbingCode(r.code))
          .sort((a, b) => (safeUpper(a.code) + (a.label || '')).localeCompare(safeUpper(b.code) + (b.label || '')));
        const ded = list
          .filter((r) => safeUpper(r.kind) === 'DEDUCT' && !isPlumbingCode(r.code))
          .sort((a, b) => (safeUpper(a.code) + (a.label || '')).localeCompare(safeUpper(b.code) + (b.label || '')));

        setManualEarn(earn);
        setManualDeduct(ded);

        // 4) Plumbing from pay_v2.items (UNPAID_ADJ / UNPAID_EXTRA)
        // Need period_id. We can fetch it via v_periods_min (public view).
        const { data: per, error: perErr } = await supabase
          .from('v_periods_min')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .maybeSingle();

        if (perErr) throw perErr;

        if (per?.id) {
          const { data: plumb, error: pErr } = await supabase
            .schema('pay_v2')
            .from('items')
            .select('kind, code, amount')
            .eq('period_id', per.id)
            .eq('staff_email', email)
            .in('code', ['UNPAID_ADJ', 'UNPAID_EXTRA']);

          if (pErr) throw pErr;

          let adj = 0;
          let extra = 0;

          (plumb ?? []).forEach((r: any) => {
            const c = safeUpper(r.code);
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
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [year, month, email, periodLabel]);

  const staffName = useMemo(() => {
    return (
      staff?.full_name?.trim() ||
      staff?.name?.trim() ||
      sum?.staff_name?.trim() ||
      email ||
      '—'
    );
  }, [staff, sum, email]);

  const pos = staff?.position || '—';
  const nric = staff?.nric || '—';
  const phone = staff?.phone || '—';

  const base = asNum(sum?.base_wage);

  // Statutory deductions (employee)
  const epfEmp = asNum(sum?.epf_emp);
  const socsoEmp = asNum(sum?.socso_emp);
  const eisEmp = asNum(sum?.eis_emp);

  // Employer contributions
  const epfEr = asNum(sum?.epf_er);
  const socsoEr = asNum(sum?.socso_er);
  const eisEr = asNum(sum?.eis_er);

  const unpaidHasAnyAdjustment = unpaidAdj !== 0 || unpaidExtra !== 0;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
        .sheet { max-width: 900px; margin: 0 auto; }
        .card { background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; }
        .mono { font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="sheet">
        {/* Top bar */}
        <div className="no-print mb-3 flex items-center justify-between">
          <div className="text-sm text-gray-600">Payslip preview · {periodLabel}</div>
          <div className="flex gap-2">
            <button className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50" onClick={() => history.back()}>
              Back
            </button>
            <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>

        <div className="card">
          {/* Company header (keep your current static header) */}
          <div className="text-center">
            <div className="text-lg font-semibold">Zordaq Auto Services <span className="text-xs font-normal">(KT0429873-U)</span></div>
            <div className="text-xs text-gray-600">
              NO 1, JALAN INDUSTRI PUTRA 1, PRESINT 14, 62050 WILAYAH PERSEKUTUAN PUTRAJAYA
            </div>
            <div className="text-xs text-gray-600">
              Phone: 017-9333995 &nbsp; · &nbsp; Email: zordaqputrajaya@gmail.com
            </div>
          </div>

          <div className="mt-5 flex items-start justify-between gap-4">
            <div>
              <div className="text-xl font-bold">PAYSLIP</div>
              <div className="text-sm text-gray-600">
                Period: <b>{periodLabel}</b>
              </div>
              <div className="text-sm text-gray-600">
                Status: <b>{/* unknown from here; keep OPEN */}OPEN</b>
              </div>
            </div>

            <div className="text-right text-sm text-gray-600">
              <div>Generated:</div>
              <div className="mono">{new Date().toLocaleString('en-GB')}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Employee block */}
            <div>
              <div className="text-sm font-semibold text-gray-700">Employee</div>
              <div className="mt-2 space-y-1 text-sm text-gray-700">
                <div>NAME : <b>{staffName}</b></div>
                <div>POSITION : <b>{pos}</b></div>
                <div>NRIC : <b>{nric}</b></div>
                <div>PHONE : <b>{phone}</b></div>
                <div className="text-gray-500">{email}</div>
              </div>
            </div>

            {/* Summary block (use DISPLAY totals, not raw DB totals) */}
            <div>
              <div className="text-sm font-semibold text-gray-700">Summary</div>
              <div className="mt-2 space-y-1 text-sm text-gray-700">
                <div>Base: <b className="mono">RM {cur(base)}</b></div>
                <div>Total Earn: <b className="mono">RM {cur(displayTotalEarn)}</b></div>
                <div>Total Deduct: <b className="mono">RM {cur(displayTotalDeduct)}</b></div>
                <div>Net Pay: <b className="mono">RM {cur(displayNetPay)}</b></div>
              </div>
            </div>
          </div>

          {/* Earnings + Deductions */}
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Earnings */}
            <div>
              <div className="text-sm font-semibold text-gray-700">Earnings</div>
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-2 py-1 text-left">Item</th>
                    <th className="border px-2 py-1 text-right">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border px-2 py-1">Base salary</td>
                    <td className="border px-2 py-1 text-right mono">{cur(base)}</td>
                  </tr>

                  {manualEarn.map((it) => (
                    <tr key={it.id}>
                      <td className="border px-2 py-1">{it.label || it.code || '—'}</td>
                      <td className="border px-2 py-1 text-right mono">{cur(it.amount)}</td>
                    </tr>
                  ))}

                  <tr className="bg-gray-50 font-medium">
                    <td className="border px-2 py-1">Total earnings</td>
                    <td className="border px-2 py-1 text-right mono">{cur(displayTotalEarn)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Deductions */}
            <div>
              <div className="text-sm font-semibold text-gray-700">Deductions</div>
              <table className="mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border px-2 py-1 text-left">Item</th>
                    <th className="border px-2 py-1 text-right">Amount (RM)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Unpaid Leave (ONE LINE ONLY) */}
                  <tr>
                    <td className="border px-2 py-1">
                      Unpaid leave
                      <div className="text-[11px] text-gray-500">
                        {unpaidHasAnyAdjustment ? (
                          <>
                            auto {cur(unpaidAuto)}
                            {unpaidAdj !== 0 ? <> – adj {cur(unpaidAdj)}</> : null}
                            {unpaidExtra !== 0 ? <> + extra {cur(unpaidExtra)}</> : null}
                          </>
                        ) : (
                          <>auto {cur(unpaidAuto)}</>
                        )}
                      </div>
                    </td>
                    <td className="border px-2 py-1 text-right mono">{cur(unpaidFinal)}</td>
                  </tr>

                  {/* Other manual deductions (excluding system unpaid & plumbing) */}
                  {manualDeduct.map((it) => (
                    <tr key={it.id}>
                      <td className="border px-2 py-1">{it.label || it.code || '—'}</td>
                      <td className="border px-2 py-1 text-right mono">{cur(it.amount)}</td>
                    </tr>
                  ))}

                  {/* Statutories */}
                  <tr>
                    <td className="border px-2 py-1">EPF</td>
                    <td className="border px-2 py-1 text-right mono">{cur(epfEmp)}</td>
                  </tr>
                  <tr>
                    <td className="border px-2 py-1">SOCSO</td>
                    <td className="border px-2 py-1 text-right mono">{cur(socsoEmp)}</td>
                  </tr>
                  <tr>
                    <td className="border px-2 py-1">EIS</td>
                    <td className="border px-2 py-1 text-right mono">{cur(eisEmp)}</td>
                  </tr>

                  <tr className="bg-gray-50 font-medium">
                    <td className="border px-2 py-1">Total deductions</td>
                    <td className="border px-2 py-1 text-right mono">{cur(displayTotalDeduct)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Net */}
          <div className="mt-6 flex items-center justify-end">
            <div className="rounded border px-4 py-3">
              <div className="text-sm text-gray-600">Net pay</div>
              <div className="mono text-xl font-semibold">RM {cur(displayNetPay)}</div>
            </div>
          </div>

          {/* Employer contributions */}
          <div className="mt-6 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="text-gray-500">
              Employer EPF: <b className="mono">RM {cur(epfEr)}</b>
            </div>
            <div className="text-gray-500">
              Employer SOCSO: <b className="mono">RM {cur(socsoEr)}</b>
            </div>
            <div className="text-gray-500">
              Employer EIS: <b className="mono">RM {cur(eisEr)}</b>
            </div>
          </div>

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
    </div>
  );
}