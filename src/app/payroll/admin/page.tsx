'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  // employee-facing
  total_earn: string | number;    // gross
  manual_deduct: string | number; // manual only (no statutory)
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  total_deduct: string | number;  // manual + employee statutory
  net_pay: string | number;
  // employer-side (display only)
  epf_er: string | number;
  socso_er: string | number;
  eis_er: string | number;
};

function n(x: string | number | null | undefined) {
  const v = typeof x === 'string' ? Number(x) : x ?? 0;
  return Number.isFinite(v as number) ? (v as number) : 0;
}
function rm(x: number) {
  return `RM ${x.toFixed(2)}`;
}

export default function AdminPayrollPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // inline adjustments (per staff)
  const [earnAdj, setEarnAdj] = useState<Record<string, string>>({});
  const [dedAdj, setDedAdj] = useState<Record<string, string>>({});

  useEffect(() => {
    let unsub: { data: { subscription: { unsubscribe: () => void } } } | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      unsub = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
    })();
    return () => unsub?.data.subscription.unsubscribe();
  }, []);

  const load = async () => {
    setLoading(true);
    setMsg(null);

    // Summary (with employer/employee splits)
    const { data, error } = await supabase
      .schema('pay_v2')
      .from('v_payslip_admin_summary')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .order('staff_name', { ascending: true });

    if (error) {
      setMsg(`Failed to load: ${error.message}`);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }

    // Preload existing adjustment values (ADJ_EARN / ADJ_DEDUCT)
    // so inputs show what’s currently applied for this period.
    const { data: period } = await supabase
      .schema('pay_v2')
      .from('periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (period?.id) {
      const { data: adjRows } = await supabase
        .schema('pay_v2')
        .from('items')
        .select('staff_email, kind, code, amount')
        .eq('period_id', period.id)
        .in('code', ['ADJ_EARN', 'ADJ_DEDUCT']);

      const e: Record<string, string> = {};
      const d: Record<string, string> = {};
      (adjRows ?? []).forEach(r => {
        if (r.code === 'ADJ_EARN') e[r.staff_email] = String(r.amount ?? '0');
        if (r.code === 'ADJ_DEDUCT') d[r.staff_email] = String(r.amount ?? '0');
      });
      setEarnAdj(e);
      setDedAdj(d);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (authed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, year, month]);

  const totals = useMemo(() => {
    const sum = (k: keyof Row) => rows.reduce((a, r) => a + n(r[k]), 0);
    const gross = sum('total_earn');
    const manual = sum('manual_deduct');
    const epfEmp = sum('epf_emp');
    const socsoEmp = sum('socso_emp');
    const eisEmp = sum('eis_emp');
    const epfEr = sum('epf_er');
    const socsoEr = sum('socso_er');
    const eisEr = sum('eis_er');
    const totalDeduct = sum('total_deduct');
    const net = sum('net_pay');
    const employerCost = gross + epfEr + socsoEr + eisEr;
    return { gross, manual, epfEmp, socsoEmp, eisEmp, epfEr, socsoEr, eisEr, totalDeduct, net, employerCost };
  }, [rows]);

  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;

  // ---- persistence helpers -------------------------------------------------

  const getPeriodId = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .schema('pay_v2')
      .from('periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (error) {
      setMsg(`Failed to read period: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
  };

  const setSingleAdjustment = async ({
    period_id,
    staff_email,
    kind,      // 'EARN' | 'DEDUCT'
    code,      // 'ADJ_EARN' | 'ADJ_DEDUCT'
    label,
    amount,    // number (>=0)
  }: {
    period_id: string;
    staff_email: string;
    kind: 'EARN' | 'DEDUCT';
    code: 'ADJ_EARN' | 'ADJ_DEDUCT';
    label: string;
    amount: number;
  }) => {
    // Replace if exists (keep one clean row per staff/kind/code)
    await supabase.schema('pay_v2')
      .from('items')
      .delete()
      .eq('period_id', period_id)
      .eq('staff_email', staff_email)
      .eq('code', code);

    if (amount !== 0) {
      const { error } = await supabase.schema('pay_v2')
        .from('items')
        .insert({
          period_id,
          staff_email,
          kind,
          code,
          label,
          amount,
        });
      if (error) throw error;
    }
  };

  const saveRow = async (r: Row) => {
    setBusy(true); setMsg(null);
    try {
      const period_id = await getPeriodId();
      if (!period_id) return;

      const ea = Number(earnAdj[r.staff_email] ?? '0') || 0;
      const da = Number(dedAdj[r.staff_email] ?? '0') || 0;

      // Persist adjustments
      await setSingleAdjustment({
        period_id,
        staff_email: r.staff_email,
        kind: 'EARN',
        code: 'ADJ_EARN',
        label: 'Adjustment (Earnings)',
        amount: Math.max(0, ea),
      });

      await setSingleAdjustment({
        period_id,
        staff_email: r.staff_email,
        kind: 'DEDUCT',
        code: 'ADJ_DEDUCT',
        label: 'Adjustment (Manual Deduct)',
        amount: Math.max(0, da),
      });

      // Auto-recalc statutories after adjustments
      const { error: recalcErr } = await supabase
        .schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });

      if (recalcErr) {
        setMsg(`Recalc failed: ${recalcErr.message}`);
      } else {
        setMsg(`Saved & recalculated for ${r.staff_name ?? r.staff_email}.`);
      }

      // Reload fresh figures
      await load();
    } catch (e: any) {
      setMsg(`Save failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (authed === false) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll</h1>
        <p className="text-sm text-gray-600">Please sign in to access Payroll.</p>
      </main>
    );
  }
  if (authed === null) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="text-sm text-gray-600">Checking session…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payroll – Admin summary</h1>
          <p className="text-sm text-gray-500">Period {yyyymm}</p>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              min={2020} max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Month</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              min={1} max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>
          <button
            onClick={load}
            disabled={loading || busy}
            className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {msg && (
        <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {msg}
        </div>
      )}

      <section>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead>
                {/* group headers */}
                <tr>
                  <th className="border-b px-3 py-2 align-bottom bg-white text-left">Employee</th>
                  <th colSpan={2} className="border-b px-3 py-2 align-bottom bg-white text-right">Gross</th>

                  <th colSpan={5} className="border-b px-3 py-2 bg-rose-50 text-rose-700 text-center font-semibold">
                    Employee Deductions
                  </th>

                  <th className="border-b px-3 py-2 align-bottom bg-white text-right">Net Pay</th>

                  <th colSpan={3} className="border-b px-3 py-2 bg-emerald-50 text-emerald-700 text-center font-semibold">
                    Employer Contributions
                  </th>

                  <th className="border-b px-3 py-2 align-bottom bg-white text-right">Employer Cost</th>

                  <th className="border-b px-3 py-2 align-bottom bg-white text-right">Action</th>
                </tr>

                {/* column headers */}
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Employee</th>

                  <th className="border-b px-3 py-2 text-right">Gross Wages</th>
                  <th className="border-b px-3 py-2 text-right">Adj (Earn)</th>

                  <th className="border-b px-3 py-2 text-right bg-rose-50">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">Manual Deduct</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">Adj (Deduct)</th>

                  <th className="border-b px-3 py-2 text-right">Net</th>

                  <th className="border-b px-3 py-2 text-right bg-emerald-50">EPF (Er)</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">SOCSO (Er)</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">EIS (Er)</th>

                  <th className="border-b px-3 py-2 text-right">Total Cost</th>

                  <th className="border-b px-3 py-2"></th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const gross = n(r.total_earn);
                  const epfEmp = n(r.epf_emp);
                  const socsoEmp = n(r.socso_emp);
                  const eisEmp = n(r.eis_emp);
                  const manual = n(r.manual_deduct);
                  const net = n(r.net_pay);

                  const epfEr = n(r.epf_er);
                  const socsoEr = n(r.socso_er);
                  const eisEr = n(r.eis_er);
                  const employerCost = gross + epfEr + socsoEr + eisEr;

                  const eVal = earnAdj[r.staff_email] ?? '';
                  const dVal = dedAdj[r.staff_email] ?? '';

                  return (
                    <tr key={r.staff_email}>
                      <td className="border-b px-3 py-2">{r.staff_name ?? r.staff_email}</td>

                      <td className="border-b px-3 py-2 text-right">{rm(gross)}</td>
                      <td className="border-b px-3 py-2 text-right">
                        <input
                          inputMode="decimal"
                          className="w-28 rounded border px-2 py-1 text-right"
                          placeholder="0.00"
                          value={eVal}
                          onChange={(e) =>
                            setEarnAdj((m) => ({ ...m, [r.staff_email]: e.target.value }))
                          }
                        />
                      </td>

                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(epfEmp)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(socsoEmp)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(eisEmp)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(manual)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">
                        <input
                          inputMode="decimal"
                          className="w-28 rounded border px-2 py-1 text-right"
                          placeholder="0.00"
                          value={dVal}
                          onChange={(e) =>
                            setDedAdj((m) => ({ ...m, [r.staff_email]: e.target.value }))
                          }
                        />
                      </td>

                      <td className="border-b px-3 py-2 text-right font-medium">{rm(net)}</td>

                      <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(epfEr)}</td>
                      <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(socsoEr)}</td>
                      <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(eisEr)}</td>

                      <td className="border-b px-3 py-2 text-right">{rm(employerCost)}</td>

                      <td className="border-b px-3 py-2 text-right">
                        <button
                          onClick={() => saveRow(r)}
                          disabled={busy}
                          className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="border-t px-3 py-2 text-right">Totals:</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.gross)}</td>
                  <td className="border-t px-3 py-2 text-right">—</td>

                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.epfEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.socsoEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.eisEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.manual)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">—</td>

                  <td className="border-t px-3 py-2 text-right">{rm(totals.net)}</td>

                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.epfEr)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.socsoEr)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.eisEr)}</td>

                  <td className="border-t px-3 py-2 text-right">{rm(totals.employerCost)}</td>
                  <td className="border-t px-3 py-2 text-right">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}