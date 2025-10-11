'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  year: number;
  month: number;
  staff_name: string | null;
  // employee-facing
  total_earn: string | number;    // gross
  manual_deduct: string | number; // manual only (no statutory)
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  total_deduct: string | number;  // manual + employee statutory
  net_pay: string | number;
  // employer-side (for display only)
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
  // period
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  // auth gate (same behavior as Manager: show message if not signed in)
  const [authed, setAuthed] = useState<boolean | null>(null);

  // data
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ---- auth listener (safe for Next 15) ----
  useEffect(() => {
    let unsub: { data: { subscription: { unsubscribe: () => void } } } | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      unsub = supabase.auth.onAuthStateChange((_e, session) => {
        setAuthed(!!session);
      });
    })();
    return () => unsub?.data.subscription.unsubscribe();
  }, []);

  // ---- load data from pay_v2 view ----
  const load = async () => {
    setLoading(true);
    setMsg(null);
    const pg = supabase.schema('pay_v2');
    const { data, error } = await pg
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
    setLoading(false);
  };

  useEffect(() => {
    if (authed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, year, month]);

  // ---- totals footer ----
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

  // ---- admin action: recompute statutory lines then refresh ----
  const recalc = async () => {
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });
      if (error) setMsg(`Recalc failed: ${error.message}`);
      else setMsg(`Recalculated statutory lines for ${year}-${String(month).padStart(2, '0')}.`);
    } finally {
      setBusy(false);
      await load();
    }
  };

  // ---- UI ----
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

  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;

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
          <button
            onClick={recalc}
            disabled={loading || busy}
            className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Recalc Statutories
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
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Employee</th>
                  <th className="border-b px-3 py-2 text-right">Gross</th>
                  <th className="border-b px-3 py-2 text-right">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">Manual Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Total Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net</th>
                  <th className="border-b px-3 py-2 text-right">EPF (Er)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (Er)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (Er)</th>
                  <th className="border-b px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const gross = n(r.total_earn);
                  const cost = gross + n(r.epf_er) + n(r.socso_er) + n(r.eis_er);
                  return (
                    <tr key={`${r.staff_name}-${gross}-${n(r.net_pay)}`}>
                      <td className="border-b px-3 py-2">{r.staff_name ?? '—'}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(gross)}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.epf_emp))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.socso_emp))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.eis_emp))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.manual_deduct))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.total_deduct))}</td>
                      <td className="border-b px-3 py-2 text-right font-medium">{rm(n(r.net_pay))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.epf_er))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.socso_er))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(n(r.eis_er))}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="border-t px-3 py-2 text-right">Totals:</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.gross)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.epfEmp)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.socsoEmp)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.eisEmp)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.manual)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.totalDeduct)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.net)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.epfEr)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.socsoEr)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.eisEr)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.employerCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}