'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type SummaryRow = {
  staff_name: string | null;
  staff_email: string; // not shown in UI, but useful internally
  total_earn: number;
  manual_deduct: number;
  epf_emp: number;
  socso_emp: number;
  eis_emp: number;
  epf_er: number;
  socso_er: number;
  eis_er: number;
  total_deduct: number; // employee-facing (manual + emp statutory)
  net_pay: number;
};

export default function AdminPayrollDashboard() {
  // Default to current year/month (1..12)
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);

  // Gatekeeping & UI state
  const [authed, setAuthed] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [status, setStatus] = useState<'OPEN' | 'LOCKED' | 'N/A'>('N/A');
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [companyTotals, setCompanyTotals] = useState<{
    earn: string; deduct: string; net: string;
    epf_emp: string; socso_emp: string; eis_emp: string;
    epf_er: string; socso_er: string; eis_er: string;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const yyyymm = useMemo(
    () => `${year}-${String(month).padStart(2, '0')}`,
    [year, month]
  );

  // ---------- Auth wiring (fixed typing) ----------
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuthed(!!data.session);
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthed(!!session);
    });

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
    };
  }, []);

  // ---------- Admin check (uses public.is_admin()) ----------
  useEffect(() => {
    if (!authed) {
      setIsAdmin(null);
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc('is_admin');
      if (error) {
        // If the function isn't exposed, fall back to false (page shows “admins only”)
        setIsAdmin(false);
        return;
      }
      setIsAdmin(!!data);
    })();
  }, [authed]);

  // ---------- Data loader ----------
  const pg = useMemo(() => supabase.schema('pay_v2'), []);

  const loadData = async () => {
    setLoading(true);
    setMsg(null);

    // 1) Period status
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

    // 2) Read the admin summary view (already net/gross computed by DB)
    const { data: list, error: lErr } = await pg
      .from('v_payslip_admin_summary')
      .select(
        'staff_name, staff_email, total_earn, manual_deduct, epf_emp, socso_emp, eis_emp, epf_er, socso_er, eis_er, total_deduct, net_pay'
      )
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

    const parsed = (list ?? []).map((r: any) => ({
      ...r,
      total_earn: Number(r.total_earn ?? 0),
      manual_deduct: Number(r.manual_deduct ?? 0),
      epf_emp: Number(r.epf_emp ?? 0),
      socso_emp: Number(r.socso_emp ?? 0),
      eis_emp: Number(r.eis_emp ?? 0),
      epf_er: Number(r.epf_er ?? 0),
      socso_er: Number(r.socso_er ?? 0),
      eis_er: Number(r.eis_er ?? 0),
      total_deduct: Number(r.total_deduct ?? 0),
      net_pay: Number(r.net_pay ?? 0),
    })) as SummaryRow[];

    setRows(parsed);

    // 3) Company totals (sum client-side)
    const sum = (key: keyof SummaryRow) => parsed.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

    setCompanyTotals({
      earn: sum('total_earn').toFixed(2),
      deduct: (sum('manual_deduct') + sum('epf_emp') + sum('socso_emp') + sum('eis_emp')).toFixed(2),
      net: sum('net_pay').toFixed(2),
      epf_emp: sum('epf_emp').toFixed(2),
      socso_emp: sum('socso_emp').toFixed(2),
      eis_emp: sum('eis_emp').toFixed(2),
      epf_er: sum('epf_er').toFixed(2),
      socso_er: sum('socso_er').toFixed(2),
      eis_er: sum('eis_er').toFixed(2),
    });

    setLoading(false);
  };

  useEffect(() => {
    if (!authed) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, year, month]);

  // ---------- Actions (admin only) ----------
  const callBuild = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await pg.rpc('build_period', { p_year: year, p_month: month });
    if (error) setMsg(`Build failed: ${error.message}`);
    else setMsg(`Build complete for ${yyyymm} (${Array.isArray(data) ? data.length : 0} rows affected)`);
    setBusy(false);
    await loadData();
  };

  const callLock = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await pg.rpc('lock_period', { p_year: year, p_month: month });
    if (error) setMsg(`Lock failed: ${error.message}`);
    else setMsg(`Locked period ${yyyymm} (id=${data})`);
    setBusy(false);
    await loadData();
  };

  const callUnlock = async () => {
    setBusy(true); setMsg(null);
    const { data, error } = await pg.rpc('unlock_period', { p_year: year, p_month: month });
    if (error) setMsg(`Unlock failed: ${error.message}`);
    else setMsg(`Unlocked period ${yyyymm} (id=${data})`);
    setBusy(false);
    await loadData();
  };

  const callRecalc = async () => {
    setBusy(true); setMsg(null);
    const { error } = await pg.rpc('recalc_statutories', { p_year: year, p_month: month });
    if (error) setMsg(`Recalc failed: ${error.message}`);
    else setMsg(`Recalculated statutory lines for ${yyyymm}.`);
    setBusy(false);
    await loadData();
  };

  // ---------- Render ----------
  if (!authed) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-xl font-semibold mb-2">Payroll</h1>
        <p className="text-sm text-gray-600">Please sign in to access Payroll.</p>
      </main>
    );
  }

  if (isAdmin === false) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-xl font-semibold mb-2">Payroll</h1>
        <p className="text-sm text-rose-700">Admins only.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin Payroll Dashboard</h1>
          <p className="text-sm text-gray-500">Period controls & summaries</p>
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
          onClick={callRecalc}
          disabled={busy}
          className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Recalc Statutories
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
                  <th className="border-b px-3 py-2 text-right">Total Earn</th>
                  <th className="border-b px-3 py-2 text-right">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">Manual Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Total Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net Pay</th>
                  <th className="border-b px-3 py-2 text-right">EPF (Er)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (Er)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (Er)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_email}>
                    <td className="border-b px-3 py-2">{r.staff_name ?? '—'}</td>
                    <td className="border-b px-3 py-2 text-right">{r.total_earn.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.epf_emp.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.socso_emp.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.eis_emp.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.manual_deduct.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.total_deduct.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right font-medium">{r.net_pay.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.epf_er.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.socso_er.toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{r.eis_er.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-4">
        <h2 className="mb-2 text-lg font-medium">Company totals</h2>
        {companyTotals ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Total Earn</div>
              <div className="text-lg font-semibold">RM {companyTotals.earn}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Total Deduct (Emp)</div>
              <div className="text-lg font-semibold">RM {companyTotals.deduct}</div>
              <div className="mt-1 text-xs text-gray-500">
                EPF {companyTotals.epf_emp} • SOCSO {companyTotals.socso_emp} • EIS {companyTotals.eis_emp}
              </div>
            </div>
            <div className="rounded border p-3">
              <div className="text-xs text-gray-500">Net Pay</div>
              <div className="text-lg font-semibold">RM {companyTotals.net}</div>
            </div>

            <div className="rounded border p-3 md:col-span-3">
              <div className="text-xs text-gray-500 mb-1">Employer portions (not in net pay)</div>
              <div className="text-sm">
                EPF {companyTotals.epf_er} • SOCSO {companyTotals.socso_er} • EIS {companyTotals.eis_er}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">—</div>
        )}
      </section>
    </main>
  );
}