// src/app/payroll/v2/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string;
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  total_deduct: number | string;
  net_pay: number | string;
};

type PeriodRow = {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'LOCKED' | 'FINALIZED' | null; // keep narrow (no arbitrary string)
  locked_at: string | null;
  // optional fields if you add them later
  finalized_at?: string | null;
  pdf_summary_path?: string | null;
  pdf_payslips_prefix?: string | null;
};

export default function PayrollV2Page() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // default Year/Month in KL
  const nowKL = useMemo(() => {
    const d = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
    );
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);
  const [year, setYear] = useState<number>(nowKL.y);
  const [month, setMonth] = useState<number>(nowKL.m);

  // data
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [absent, setAbsent] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState<PeriodRow | null>(null);

  // ui feedback
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // auth + admin check
  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;

    const init = async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.email ?? null;
      setEmail(me);

      if (me) {
        const { data: isAdm, error } = await supabase.rpc('is_admin');
        setIsAdmin(Boolean(isAdm) && !error);
      } else {
        setIsAdmin(false);
      }
    };

    init();

    const sub = supabase.auth.onAuthStateChange((_e, session) => {
      const me = session?.user?.email ?? null;
      setEmail(me);
      if (me) {
        supabase.rpc('is_admin').then(({ data, error }) => {
          setIsAdmin(Boolean(data) && !error);
        });
      } else {
        setIsAdmin(false);
      }
    });
    unsub = sub.data?.subscription ?? null;

    return () => unsub?.unsubscribe();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setErr(null);
    try {
      // 1) period meta
      const { data: periods, error: perr } = await supabase
  .schema('pay_v2')
  .from('periods')
  .select('*')
  .eq('year', year)
  .eq('month', month)
  .limit(1);
      if (perr) throw perr;
      setPeriod(periods?.[0] ?? null);

      // 2) summary rows
      const { data: rows, error: sErr } = await supabase
  .schema('pay_v2')
  .from('v_payslip_admin_summary')
  .select('*')
  .eq('year', year)
  .eq('month', month)
  .order('staff_name', { ascending: true });

      if (sErr) throw sErr;
      setSummary(rows ?? []);

      // 3) absent days per staff (from Report via RPC)
      const { data: absRows, error: aErr } = await supabase.rpc(
  'absent_days_from_report',
  { p_year: year, p_month: month }
);

      if (aErr) throw aErr;
      const map: Record<string, number> = {};
      (absRows ?? []).forEach(
        (r: { staff_email: string; days_absent: number }) => {
          map[r.staff_email] = r.days_absent;
        }
      );
      setAbsent(map);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, year, month]);

  // strictly boolean for React disabled=
  const disabledWrites: boolean = period?.status ? period.status !== 'OPEN' : false;

  const withMsg = async (label: string, fn: () => Promise<void>) => {
    setMsg(`${label}…`);
    setErr(null);
    try {
      await fn();
      setMsg(`${label} done.`);
      await loadData();
    } catch (e: any) {
      setErr(`${label} failed: ${e?.message ?? e}`);
    }
  };

  // actions (reuse your existing RPCs)
  const build = () =>
    withMsg('Build period', async () => {
      const { error } = await supabase.rpc('build_period', {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
    });

  const syncBase = () =>
    withMsg('Sync base items', async () => {
      const { error } = await supabase.rpc('sync_base_items', {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
    });

  const syncAbsent = () =>
    withMsg('Sync absent deductions', async () => {
      const { error } = await supabase.rpc('sync_absent_deductions', {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
    });

  const recalc = () =>
    withMsg('Recalculate statutories', async () => {
      const { error } = await supabase.rpc('recalc_statutories', {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
    });

  const lock = () =>
    withMsg('Lock period', async () => {
      const { error } = await supabase.rpc('lock_period', {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
    });

  const unlock = () =>
    withMsg('Unlock period', async () => {
      const { error } = await supabase.rpc('unlock_period', {
        p_year: year,
        p_month: month,
      });
      if (error) throw error;
    });

  const finalize = () =>
    withMsg('Finalize (generate PDFs)', async () => {
      // Your existing API should generate PDFs and update DB
      const res = await fetch('/api/payroll/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(t || `HTTP ${res.status}`);
      }
    });

  if (!email) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-xl font-semibold">Payroll v2</h1>
        <p className="mt-3 text-sm text-gray-600">
          Please <Link href="/login" className="underline">sign in</Link>.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-xl font-semibold">Payroll v2</h1>
        <p className="mt-3 text-sm text-gray-600">Admins only.</p>
      </div>
    );
  }

  const monthStr = String(month).padStart(2, '0');
  const fmt = (v: any) =>
    typeof v === 'number' ? v.toFixed(2) : Number(v ?? 0).toFixed(2);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payroll v2</h1>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value || '0', 10))}
              className="w-24 rounded-md border px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Month</label>
            <input
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={(e) => {
                const v = parseInt(e.target.value || '0', 10);
                setMonth(Math.min(12, Math.max(1, isNaN(v) ? month : v)));
              }}
              className="w-20 rounded-md border px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={loadData}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* status + actions */}
      <div className="mb-4 flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            Period: <span className="font-semibold">{year}-{monthStr}</span>
          </span>
          <span className="text-sm">
            Status:{' '}
            <span
              className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                period?.status === 'OPEN'
                  ? 'bg-emerald-100 text-emerald-800'
                  : period?.status === 'LOCKED'
                  ? 'bg-amber-100 text-amber-800'
                  : period?.status === 'FINALIZED'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {period?.status ?? '—'}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={build}
            disabled={disabledWrites}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              disabledWrites
                ? 'bg-gray-100 text-gray-400'
                : 'bg-white border hover:bg-gray-50'
            }`}
          >
            Build
          </button>
          <button
            onClick={syncBase}
            disabled={disabledWrites}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              disabledWrites
                ? 'bg-gray-100 text-gray-400'
                : 'bg-white border hover:bg-gray-50'
            }`}
          >
            Sync Base
          </button>
          <button
            onClick={syncAbsent}
            disabled={disabledWrites}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              disabledWrites
                ? 'bg-gray-100 text-gray-400'
                : 'bg-white border hover:bg-gray-50'
            }`}
          >
            Sync Absent
          </button>
          <button
            onClick={recalc}
            disabled={disabledWrites}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              disabledWrites
                ? 'bg-gray-100 text-gray-400'
                : 'bg-white border hover:bg-gray-50'
            }`}
          >
            Recalc Statutories
          </button>
          <span className="mx-1 h-5 w-px bg-gray-300" />
          <button
            onClick={lock}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Lock
          </button>
          <button
            onClick={unlock}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Unlock
          </button>
          <button
            onClick={finalize}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Finalize &amp; Generate PDFs
          </button>
        </div>
      </div>

      {(msg || err) && (
        <div
          className={`mb-4 rounded-md p-3 text-sm ${
            err ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          {err || msg}
        </div>
      )}

      {/* summary table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-gray-700">Staff</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Base</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Earn</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Manual Deduct</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">EPF (Emp)</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">SOCSO (Emp)</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">EIS (Emp)</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Total Deduct</th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Net</th>
              <th className="px-3 py-2 text-center font-semibold text-gray-700">Absent (days)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {summary.map((r) => {
              const a = absent[r.staff_email] ?? 0;
              return (
                <tr key={r.staff_email}>
                  <td className="px-3 py-2">{r.staff_name ?? r.staff_email}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.base_wage)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.total_earn)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.manual_deduct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.epf_emp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.socso_emp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.eis_emp)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.total_deduct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.net_pay)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{a}</td>
                </tr>
              );
            })}

            {summary.length === 0 && !loading && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={10}>
                  No data for {year}-{monthStr}. Try Build/Sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Finalize uses your existing <code>/api/payroll/finalize</code> endpoint to generate and upload PDFs to
        your Supabase Storage bucket.
      </p>
    </div>
  );
}
