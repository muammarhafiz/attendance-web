'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'LOCKED';
};

type PayslipRow = {
  staff_email: string;
  staff_name: string | null;
  total_earn: string | number;
  total_deduct: string | number;
  net_pay: string | number;
};

export default function PayrollPage() {
  // --- auth state (to show a friendly message if logged out) ---
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- period selection (default current y/m) ---
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  const yyyymm = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // --- data state ---
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [status, setStatus] = useState<'OPEN' | 'LOCKED' | 'N/A'>('N/A');

  const [rows, setRows] = useState<PayslipRow[]>([]);
  const [companyTotals, setCompanyTotals] = useState<{ earn: string; deduct: string; net: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // IMPORTANT: scope all queries/RPCs to the pay_v2 schema
  const pg = useMemo(() => supabase.schema('pay_v2'), []);

  // --- load list + selected period summary ---
  async function loadAll() {
    setLoading(true);
    setMsg(null);

    // if not logged in, don't hammer PostgREST (it will 401 due to RLS)
    if (!email) {
      setPeriods([]);
      setStatus('N/A');
      setRows([]);
      setCompanyTotals(null);
      setLoading(false);
      return;
    }

    // 1) periods list (simple overview)
    const { data: periodList, error: listErr } = await pg
      .from('periods')
      .select('id, year, month, status')
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    if (listErr) {
      setMsg(`Failed to load periods: ${listErr.message}`);
      setLoading(false);
      return;
    }
    setPeriods((periodList ?? []) as PeriodRow[]);

    // 2) status of selected period
    const { data: one, error: oneErr } = await pg
      .from('periods')
      .select('id, status')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (oneErr) {
      setMsg(`Failed to read selected period: ${oneErr.message}`);
      setLoading(false);
      return;
    }
    setStatus((one?.status as 'OPEN' | 'LOCKED') ?? 'N/A');

    // 3) per-staff summary for selected Y/M
    const { data: list, error: lErr } = await pg
      .from('v_payslip_with_names')
      .select('staff_email, staff_name, total_earn, total_deduct, net_pay')
      .eq('year', year)
      .eq('month', month)
      .order('staff_email', { ascending: true });

    if (lErr) {
      setMsg(`Failed to load summary: ${lErr.message}`);
      setRows([]);
      setCompanyTotals(null);
      setLoading(false);
      return;
    }
    setRows((list ?? []) as PayslipRow[]);

    // 4) company totals (sum client-side from same view)
    const sum = (arr: PayslipRow[], key: 'total_earn' | 'total_deduct' | 'net_pay') =>
      (arr ?? []).reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

    setCompanyTotals({
      earn: sum(list ?? [], 'total_earn').toFixed(2),
      deduct: sum(list ?? [], 'total_deduct').toFixed(2),
      net: sum(list ?? [], 'net_pay').toFixed(2),
    });

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, year, month]);

  // --- admin actions (RLS will enforce admin; non-admin just gets an error message) ---
  const callBuild = async () => {
    if (!email) return setMsg('Please sign in first.');
    setBusy(true);
    setMsg(null);
    const { data, error } = await pg.rpc('build_period', { p_year: year, p_month: month });
    if (error) setMsg(`Build failed: ${error.message}`);
    else setMsg(`Build complete for ${yyyymm} (${Array.isArray(data) ? data.length : 0} rows affected)`);
    setBusy(false);
    await loadAll();
  };

  const callLock = async () => {
    if (!email) return setMsg('Please sign in first.');
    setBusy(true);
    setMsg(null);
    const { data, error } = await pg.rpc('lock_period', { p_year: year, p_month: month });
    if (error) setMsg(`Lock failed: ${error.message}`);
    else setMsg(`Locked ${yyyymm} (id=${data})`);
    setBusy(false);
    await loadAll();
  };

  const callUnlock = async () => {
    if (!email) return setMsg('Please sign in first.');
    setBusy(true);
    setMsg(null);
    const { data, error } = await pg.rpc('unlock_period', { p_year: year, p_month: month });
    if (error) setMsg(`Unlock failed: ${error.message}`);
    else setMsg(`Unlocked ${yyyymm} (id=${data})`);
    setBusy(false);
    await loadAll();
  };

  // --- UI ---
  return (
    <main className="mx-auto max-w-5xl p-5">
      <h1 className="mb-2 text-xl font-semibold">Admin Payroll Dashboard</h1>
      <p className="mb-4 text-sm text-gray-500">Build / lock / unlock, view summaries, and totals.</p>

      {/* Signed-out banner (like Manager page behavior) */}
      {!email && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You are not signed in. Tap “Sign in” (top right), then return to this page.
        </div>
      )}

      {/* Controls */}
      <section className="mb-5 flex flex-wrap items-end gap-3">
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
          <div className={`text-sm font-semibold ${status === 'LOCKED' ? 'text-red-600' : 'text-green-700'}`}>{status}</div>
        </div>

        <div className="ml-auto flex gap-2">
          <button
            onClick={callBuild}
            disabled={busy || !email}
            className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Build {yyyymm}
          </button>
          <button
            onClick={callLock}
            disabled={busy || !email || status === 'LOCKED'}
            className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Lock {yyyymm}
          </button>
          <button
            onClick={callUnlock}
            disabled={busy || !email || status === 'OPEN'}
            className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Unlock {yyyymm}
          </button>
          <button
            onClick={loadAll}
            disabled={busy}
            className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </section>

      {msg && (
        <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{msg}</div>
      )}

      {/* Periods list (top) */}
      <section className="mb-8">
        <h2 className="mb-2 font-medium">Payroll Periods</h2>
        {periods.length === 0 ? (
          <div className="text-sm text-gray-500">No periods (or not signed in).</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Year</th>
                  <th className="border-b px-3 py-2">Month</th>
                  <th className="border-b px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="border-b px-3 py-2">{p.year}</td>
                    <td className="border-b px-3 py-2">{p.month}</td>
                    <td className="border-b px-3 py-2">{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-staff summary */}
      <section className="mb-6">
        <h2 className="mb-2 font-medium">Per-staff summary ({yyyymm})</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Staff Name</th>
                  <th className="border-b px-3 py-2">Email</th>
                  <th className="border-b px-3 py-2 text-right">Total Earn</th>
                  <th className="border-b px-3 py-2 text-right">Total Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_email}>
                    <td className="border-b px-3 py-2">{r.staff_name ?? '—'}</td>
                    <td className="border-b px-3 py-2">{r.staff_email}</td>
                    <td className="border-b px-3 py-2 text-right">{Number(r.total_earn).toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right">{Number(r.total_deduct).toFixed(2)}</td>
                    <td className="border-b px-3 py-2 text-right font-medium">{Number(r.net_pay).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Company totals */}
      <section className="mt-4">
        <h2 className="mb-2 font-medium">Company total</h2>
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
    </main>
  );
}