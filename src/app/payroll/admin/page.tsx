'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** --- Types --- */
type PayslipRow = {
  staff_email: string;
  staff_name: string | null;
  total_earn: string;
  total_deduct: string;
  net_pay: string;
};

type PeriodRow = { id: string; year: number; month: number; status: 'OPEN' | 'LOCKED' };

type StatMap = Record<
  string,
  {
    emp_epf: number;
    emp_socso: number;
    emp_eis: number;
    er_total: number;
  }
>;

type AdjustmentRow = {
  staff_name: string | null;
  staff_email: string;
  kind: 'EARN' | 'DEDUCT';
  code: string | null;
  label: string | null;
  amount: string; // numeric text from db
};

export default function AdminPayrollDashboard() {
  // Default to current year/month
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1); // 1..12

  const [status, setStatus] = useState<'OPEN' | 'LOCKED' | 'N/A'>('N/A');
  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [companyTotals, setCompanyTotals] = useState<{ earn: string; deduct: string; net: string } | null>(null);
  const [statsByEmail, setStatsByEmail] = useState<StatMap>({});
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // scope all PostgREST calls to the pay_v2 schema
  const pg = useMemo(() => supabase.schema('pay_v2'), []);

  const yyyymm = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // Load period status + summaries + stats + adjustments
  const loadData = async () => {
    setLoading(true);
    setMsg(null);

    // Period list (for the table above)
    const { data: periodList } = await pg
      .from('periods')
      .select('id, year, month, status')
      .order('year', { ascending: false })
      .order('month', { ascending: false });
    setPeriods((periodList ?? []) as PeriodRow[]);

    // Current period status
    const { data: period, error: pErr } = await pg
      .from('periods')
      .select('id, year, month, status')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (pErr) {
      setMsg(`Failed to read period: ${pErr.message}`);
      setLoading(false);
      return;
    }
    setStatus((period?.status as 'OPEN' | 'LOCKED') ?? 'N/A');

    // Per-staff summary (view)
    const { data: list, error: lErr } = await pg
      .from('v_payslip_with_names')
      .select('staff_email, staff_name, total_earn, total_deduct, net_pay')
      .eq('year', year)
      .eq('month', month)
      .order('staff_name', { ascending: true });

    if (lErr) {
      setMsg(`Failed to load summary: ${lErr.message}`);
      setRows([]);
      setCompanyTotals(null);
      setLoading(false);
      return;
    }
    setRows((list ?? []) as PayslipRow[]);

    // Company totals
    const sum = (arr: any[], key: 'total_earn' | 'total_deduct' | 'net_pay') =>
      arr.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
    setCompanyTotals({
      earn: sum(list ?? [], 'total_earn').toFixed(2),
      deduct: sum(list ?? [], 'total_deduct').toFixed(2),
      net: sum(list ?? [], 'net_pay').toFixed(2),
    });

    // Stat lines from v_payslip_lines (employee + employer)
    const { data: statLines, error: sErr } = await pg
      .from('v_payslip_lines')
      .select('staff_email, kind, amount')
      .eq('year', year)
      .eq('month', month)
      .in('kind', ['STAT_EMP_EPF', 'STAT_EMP_SOCSO', 'STAT_EMP_EIS', 'STAT_ER_EPF', 'STAT_ER_SOCSO', 'STAT_ER_EIS']);

    if (sErr) {
      setMsg(`Failed to load statutory breakdown: ${sErr.message}`);
      setStatsByEmail({});
    } else {
      const map: StatMap = {};
      (statLines ?? []).forEach((r: any) => {
        const e = r.staff_email as string;
        if (!map[e]) map[e] = { emp_epf: 0, emp_socso: 0, emp_eis: 0, er_total: 0 };
        const amt = Number(r.amount ?? 0);
        switch (r.kind) {
          case 'STAT_EMP_EPF':
            map[e].emp_epf += amt;
            break;
          case 'STAT_EMP_SOCSO':
            map[e].emp_socso += amt;
            break;
          case 'STAT_EMP_EIS':
            map[e].emp_eis += amt;
            break;
          case 'STAT_ER_EPF':
          case 'STAT_ER_SOCSO':
          case 'STAT_ER_EIS':
            map[e].er_total += amt;
            break;
        }
      });
      setStatsByEmail(map);
    }

    // Adjustments table (show non-BASE earns/deducts for the month)
    const { data: adj, error: aErr } = await pg
      .from('items')
      .select('staff_email, kind, code, label, amount')
      .eq('year', year as any) // items table stores via period_id; a view may project year/month — if not, ignore filter
      .eq('month', month as any)
      .neq('code', 'BASE')
      .order('staff_email', { ascending: true });

    // If the items table doesn’t expose year/month, fall back to v_payslip_lines (non-stat + non-base)
    let adjustmentsData: any[] | null = adj ?? null;
    if (aErr || adjustmentsData === null) {
      const { data: fallback } = await pg
        .from('v_payslip_lines')
        .select('staff_email, staff_name, kind, code, label, amount')
        .eq('year', year)
        .eq('month', month)
        .in('kind', ['EARN', 'DEDUCT'])
        .neq('code', 'BASE')
        .order('staff_email', { ascending: true });
      adjustmentsData = fallback ?? [];
      setAdjustments(
        adjustmentsData.map((r: any) => ({
          staff_email: r.staff_email,
          staff_name: r.staff_name ?? null,
          kind: r.kind,
          code: r.code ?? null,
          label: r.label ?? null,
          amount: String(r.amount ?? '0'),
        }))
      );
    } else {
      // items table path: we don’t have staff_name here; keep email
      setAdjustments(
        (adjustmentsData ?? []).map((r: any) => ({
          staff_email: r.staff_email,
          staff_name: null,
          kind: r.kind,
          code: r.code ?? null,
          label: r.label ?? null,
          amount: String(r.amount ?? '0'),
        }))
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // --- Admin actions (RPC) ---
  const callBuild = async () => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await pg.rpc('build_period', { p_year: year, p_month: month });
    if (error) setMsg(`Build failed: ${error.message}`);
    else setMsg(`Build complete for ${yyyymm} (${Array.isArray(data) ? data.length : 0} rows affected)`);
    setBusy(false);
    await loadData();
  };

  const callLock = async () => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await pg.rpc('lock_period', { p_year: year, p_month: month });
    if (error) setMsg(`Lock failed: ${error.message}`);
    else setMsg(`Locked period ${yyyymm} (id=${data})`);
    setBusy(false);
    await loadData();
  };

  const callUnlock = async () => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await pg.rpc('unlock_period', { p_year: year, p_month: month });
    if (error) setMsg(`Unlock failed: ${error.message}`);
    else setMsg(`Unlocked period ${yyyymm} (id=${data})`);
    setBusy(false);
    await loadData();
  };

  // Helper: safe lookup
  const stat = (email: string) =>
    statsByEmail[email] ?? { emp_epf: 0, emp_socso: 0, emp_eis: 0, er_total: 0 };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin Payroll Dashboard</h1>
          <p className="text-sm text-gray-500">Build / lock / unlock, view summaries, and totals.</p>
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              value={year}
              min={2020}
              max={2100}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Month</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              value={month}
              min={1}
              max={12}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>

          <div className="ml-4">
            <div className="text-xs text-gray-600">Status</div>
            <div className={`text-sm font-semibold ${status === 'LOCKED' ? 'text-red-600' : 'text-green-700'}`}>
              {status}
            </div>
          </div>
        </div>
      </header>

      <section className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={callBuild}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Build {yyyymm}
        </button>
        <button
          onClick={callLock}
          disabled={busy || status === 'LOCKED'}
          className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Lock {yyyymm}
        </button>
        <button
          onClick={callUnlock}
          disabled={busy || status === 'OPEN'}
          className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Unlock {yyyymm}
        </button>

        <button
          onClick={loadData}
          disabled={busy}
          className="ml-auto rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </section>

      {msg && (
        <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {msg}
        </div>
      )}

      {/* Periods list */}
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Payroll Periods</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="border-b px-3 py-2">Year</th>
                <th className="border-b px-3 py-2">Month</th>
                <th className="border-b px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(periods ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="border-b px-3 py-2">{p.year}</td>
                  <td className="border-b px-3 py-2">{p.month}</td>
                  <td className="border-b px-3 py-2">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-staff summary */}
      <section className="mb-3">
        <h2 className="mb-2 text-lg font-medium">Per-staff summary ({yyyymm})</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Staff Name</th>
                  <th className="border-b px-3 py-2 text-right">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">Employer Additions</th>
                  <th className="border-b px-3 py-2 text-right">Total Earn</th>
                  <th className="border-b px-3 py-2 text-right">Total Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = stat(r.staff_email);
                  return (
                    <tr key={r.staff_email}>
                      <td className="border-b px-3 py-2">{r.staff_name ?? '—'}</td>
                      <td className="border-b px-3 py-2 text-right">{st.emp_epf.toFixed(2)}</td>
                      <td className="border-b px-3 py-2 text-right">{st.emp_socso.toFixed(2)}</td>
                      <td className="border-b px-3 py-2 text-right">{st.emp_eis.toFixed(2)}</td>
                      <td className="border-b px-3 py-2 text-right">{st.er_total.toFixed(2)}</td>
                      <td className="border-b px-3 py-2 text-right">{Number(r.total_earn).toFixed(2)}</td>
                      <td className="border-b px-3 py-2 text-right">{Number(r.total_deduct).toFixed(2)}</td>
                      <td className="border-b px-3 py-2 text-right font-medium">{Number(r.net_pay).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Company totals */}
      <section className="mt-4">
        <h2 className="mb-2 text-lg font-medium">Company total</h2>
        {companyTotals ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Total Earn</div>
              <div className="text-lg font-semibold">RM {companyTotals.earn}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Total Deduct</div>
              <div className="text-lg font-semibold">RM {companyTotals.deduct}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Net Pay</div>
              <div className="text-lg font-semibold">RM {companyTotals.net}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">—</div>
        )}
      </section>

      {/* Adjustments */}
      <section className="mt-8">
        <h2 className="mb-2 text-lg font-medium">Adjustments ({yyyymm})</h2>
        {adjustments.length === 0 ? (
          <div className="text-sm text-gray-500">No adjustments.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Staff</th>
                  <th className="border-b px-3 py-2">Kind</th>
                  <th className="border-b px-3 py-2">Label</th>
                  <th className="border-b px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a, idx) => (
                  <tr key={`${a.staff_email}-${idx}`}>
                    <td className="border-b px-3 py-2">{a.staff_name ?? a.staff_email}</td>
                    <td className="border-b px-3 py-2">{a.kind}</td>
                    <td className="border-b px-3 py-2">{a.label ?? a.code ?? '—'}</td>
                    <td className="border-b px-3 py-2 text-right">
                      {Number(a.amount) * (a.kind === 'DEDUCT' ? -1 : 1) < 0 ? '-' : ''}
                      {Math.abs(Number(a.amount)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}