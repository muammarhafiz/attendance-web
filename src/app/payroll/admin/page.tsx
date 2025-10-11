'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

type SummaryRow = {
  staff_name: string | null;
  staff_email: string; // not shown, but useful for keys
  total_earn: string | number;
  manual_deduct: string | number;
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  epf_er: string | number;
  socso_er: string | number;
  eis_er: string | number;
  total_deduct: string | number;
  net_pay: string | number;
};

type Period = { id: string; year: number; month: number; status: 'OPEN' | 'LOCKED' };

export default function AdminPayrollDashboard() {
  // Require sign in (like Manager page: just check a session exists)
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Default to current year/month
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1); // 1..12

  const [status, setStatus] = useState<'OPEN' | 'LOCKED' | 'N/A'>('N/A');
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Scope calls to pay_v2 schema
  const pg = useMemo(() => supabase.schema('pay_v2'), []);

  const yyyymm = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // Session check
  useEffect(() => {
    let unsub: { data: { subscription: { unsubscribe: () => void } } } | undefined;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      unsub = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s.session));
    })();
    return () => unsub?.data.subscription.unsubscribe();
  }, []);

  const num = (v: string | number | null | undefined) => Number(v ?? 0).toFixed(2);

  // Load period + summary
  const loadData = async () => {
    setLoading(true);
    setMsg(null);

    // Period status (may be null if not created yet)
    const { data: period, error: pErr } = await pg
      .from('periods')
      .select('id, year, month, status')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle<Period>();

    if (pErr) {
      setMsg(`Failed to read period: ${pErr.message}`);
      setStatus('N/A');
      setRows([]);
      setLoading(false);
      return;
    }
    setStatus((period?.status as 'OPEN' | 'LOCKED') ?? 'N/A');

    // Admin summary
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
      setLoading(false);
      return;
    }

    setRows((list ?? []) as SummaryRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (authed === null) return; // wait for session check
    if (!authed) return; // not signed in, don't fetch
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, authed]);

  // --- Actions (admin-only RPCs; server enforces) ---
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

  const callRecalc = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await pg.rpc('recalc_statutories', { p_year: year, p_month: month });
    if (error) setMsg(`Recalculate failed: ${error.message}`);
    else setMsg(`Recalculated EPF/SOCSO/EIS for ${yyyymm}`);
    setBusy(false);
    await loadData();
  };

  // Gate like Manager page
  if (authed === false) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-2 text-xl font-semibold">Payroll</h1>
        <p className="text-sm text-gray-600">Please sign in to access Payroll.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payroll — Admin</h1>
          <p className="text-sm text-gray-500">Period controls & statutory breakdown</p>
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
          Recalculate {yyyymm}
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
        <h2 className="mb-2 text-lg font-medium">Per-staff breakdown ({yyyymm})</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Staff</th>
                  <th className="border-b px-3 py-2 text-right">Total Earn</th>
                  <th className="border-b px-3 py-2 text-right">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right">Manual Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Total Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net Pay</th>
                  <th className="border-b px-3 py-2 text-right">EPF (ER)</th>
                  <th className="border-b px-3 py-2 text-right">SOCSO (ER)</th>
                  <th className="border-b px-3 py-2 text-right">EIS (ER)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_email}>
                    <td className="border-b px-3 py-2">{r.staff_name ?? '—'}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.total_earn)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.epf_emp)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.socso_emp)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.eis_emp)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.manual_deduct)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.total_deduct)}</td>
                    <td className="border-b px-3 py-2 text-right font-medium">{num(r.net_pay)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.epf_er)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.socso_er)}</td>
                    <td className="border-b px-3 py-2 text-right">{num(r.eis_er)}</td>
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