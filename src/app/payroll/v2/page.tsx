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
  status: 'OPEN' | 'LOCKED' | 'FINALIZED' | null;
  locked_at: string | null;
  finalized_at?: string | null;
  pdf_summary_path?: string | null;
  pdf_payslips_prefix?: string | null;
};

type DebugEntry = {
  id: string;
  when: string;
  kind: 'TABLE' | 'VIEW' | 'RPC' | 'HTTP';
  label: string;              // human-friendly name e.g. "RPC absent_days_from_report"
  profile?: string;           // postgrest profile/schema used by the client
  endpoint?: string;          // /rest/v1/rpc/..., /rest/v1/...
  params?: Record<string, any>;
  httpStatus?: number;
  errorCode?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  raw?: any;                  // original error obj (safe to stringify)
};

export default function PayrollV2Page() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // KL default period
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

  // ui feedback + debug
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debug, setDebug] = useState<DebugEntry[]>([]);

  const addDebug = (entry: Omit<DebugEntry, 'id' | 'when'>) => {
    const e: DebugEntry = {
      id: crypto.randomUUID(),
      when: new Date().toISOString(),
      ...entry,
    };
    setDebug((prev) => [e, ...prev].slice(0, 50)); // keep last 50
  };

  // auth + admin
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
      // 1) period (TABLE) — profile: pay_v2
      {
        const profile = 'pay_v2';
        const { data: periods, error } = await supabase
          .schema(profile)
          .from('periods')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .limit(1);
        if (error) {
          setPeriod(null);
          addDebug({
            kind: 'TABLE',
            label: 'TABLE pay_v2.periods',
            profile,
            endpoint: '/rest/v1/periods',
            params: { year, month },
            errorCode: (error as any)?.code ?? null,
            message: error.message ?? null,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            raw: error,
          });
        } else {
          setPeriod(periods?.[0] ?? null);
        }
      }

      // 2) summary (VIEW) — profile: pay_v2
      {
        const profile = 'pay_v2';
        const { data: rows, error } = await supabase
          .schema(profile)
          .from('v_payslip_admin_summary')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .order('staff_name', { ascending: true });
        if (error) {
          setSummary([]);
          addDebug({
            kind: 'VIEW',
            label: 'VIEW pay_v2.v_payslip_admin_summary',
            profile,
            endpoint: '/rest/v1/v_payslip_admin_summary',
            params: { year, month },
            errorCode: (error as any)?.code ?? null,
            message: error.message ?? null,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            raw: error,
          });
        } else {
          setSummary(rows ?? []);
        }
      }

      // 3) absent days (RPC) — profile: public (default for rpc unless overridden)
      {
        const profile = 'public';
        const fn = 'absent_days_from_report';
        const { data: absRows, error } = await supabase.rpc(fn, {
          p_year: year,
          p_month: month,
        });
        if (error) {
          setAbsent({});
          addDebug({
            kind: 'RPC',
            label: `RPC ${fn}`,
            profile,
            endpoint: `/rest/v1/rpc/${fn}`,
            params: { p_year: year, p_month: month },
            errorCode: (error as any)?.code ?? null,
            message: error.message ?? null,
            details: (error as any)?.details ?? null,
            hint: (error as any)?.hint ?? null,
            raw: error,
          });
          // show short banner once
          setErr(error.message ?? 'RPC failed');
        } else {
          const map: Record<string, number> = {};
          (absRows ?? []).forEach(
            (r: { staff_email: string; days_absent: number }) => {
              map[r.staff_email] = r.days_absent;
            }
          );
          setAbsent(map);
        }
      }
    } catch (e: any) {
      // fallback catch
      setErr(e?.message ?? 'Failed to load data');
      addDebug({
        kind: 'HTTP',
        label: 'loadData unknown error',
        message: e?.message ?? String(e),
        raw: e,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, year, month]);

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
      addDebug({
        kind: 'HTTP',
        label,
        message: e?.message ?? String(e),
        raw: e,
      });
    }
  };

  // actions
  const build = () =>
    withMsg('Build period', async () => {
      const { error } = await supabase.rpc('build_period', {
        p_year: year,
        p_month: month,
      });
      if (error) {
        addDebug({
          kind: 'RPC',
          label: 'RPC build_period',
          profile: 'public',
          endpoint: '/rest/v1/rpc/build_period',
          params: { p_year: year, p_month: month },
          errorCode: (error as any)?.code ?? null,
          message: error.message ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: error,
        });
        throw error;
      }
    });

  const syncBase = () =>
    withMsg('Sync base items', async () => {
      const { error } = await supabase.rpc('sync_base_items', {
        p_year: year,
        p_month: month,
      });
      if (error) {
        addDebug({
          kind: 'RPC',
          label: 'RPC sync_base_items',
          profile: 'public',
          endpoint: '/rest/v1/rpc/sync_base_items',
          params: { p_year: year, p_month: month },
          errorCode: (error as any)?.code ?? null,
          message: error.message ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: error,
        });
        throw error;
      }
    });

  const syncAbsent = () =>
    withMsg('Sync absent deductions', async () => {
      const { error } = await supabase.rpc('sync_absent_deductions', {
        p_year: year,
        p_month: month,
      });
      if (error) {
        addDebug({
          kind: 'RPC',
          label: 'RPC sync_absent_deductions',
          profile: 'public',
          endpoint: '/rest/v1/rpc/sync_absent_deductions',
          params: { p_year: year, p_month: month },
          errorCode: (error as any)?.code ?? null,
          message: error.message ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: error,
        });
        throw error;
      }
    });

  const recalc = () =>
    withMsg('Recalculate statutories', async () => {
      const { error } = await supabase.rpc('recalc_statutories', {
        p_year: year,
        p_month: month,
      });
      if (error) {
        addDebug({
          kind: 'RPC',
          label: 'RPC recalc_statutories',
          profile: 'public',
          endpoint: '/rest/v1/rpc/recalc_statutories',
          params: { p_year: year, p_month: month },
          errorCode: (error as any)?.code ?? null,
          message: error.message ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: error,
        });
        throw error;
      }
    });

  const lock = () =>
    withMsg('Lock period', async () => {
      const { error } = await supabase.rpc('lock_period', {
        p_year: year,
        p_month: month,
      });
      if (error) {
        addDebug({
          kind: 'RPC',
          label: 'RPC lock_period',
          profile: 'public',
          endpoint: '/rest/v1/rpc/lock_period',
          params: { p_year: year, p_month: month },
          errorCode: (error as any)?.code ?? null,
          message: error.message ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: error,
        });
        throw error;
      }
    });

  const unlock = () =>
    withMsg('Unlock period', async () => {
      const { error } = await supabase.rpc('unlock_period', {
        p_year: year,
        p_month: month,
      });
      if (error) {
        addDebug({
          kind: 'RPC',
          label: 'RPC unlock_period',
          profile: 'public',
          endpoint: '/rest/v1/rpc/unlock_period',
          params: { p_year: year, p_month: month },
          errorCode: (error as any)?.code ?? null,
          message: error.message ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: error,
        });
        throw error;
      }
    });

  const finalize = () =>
    withMsg('Finalize (generate PDFs)', async () => {
      const res = await fetch('/api/payroll/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        addDebug({
          kind: 'HTTP',
          label: 'POST /api/payroll/finalize',
          httpStatus: res.status,
          message: t || `HTTP ${res.status}`,
        });
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

      {/* short banner + toggle */}
      {(msg || err) && (
        <div className={`mb-2 rounded-md p-3 text-sm ${err ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {err || msg}{' '}
          {err && (
            <button
              onClick={() => setDebugOpen((v) => !v)}
              className="ml-2 underline underline-offset-2"
            >
              {debugOpen ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
      )}

      {/* debug panel */}
      {debugOpen && debug.length > 0 && (
        <div className="mb-4 rounded-md border bg-white p-3 text-xs">
          <div className="mb-2 font-semibold text-gray-800">Debug details</div>
          <ul className="space-y-2">
            {debug.map((d) => (
              <li key={d.id} className="rounded border bg-gray-50 p-2">
                <div className="mb-1 font-medium text-gray-800">
                  [{d.kind}] {d.label} — {new Date(d.when).toLocaleString()}
                </div>
                <div className="grid grid-cols-2 gap-2 text-gray-700 sm:grid-cols-3">
                  <div><span className="font-semibold">Profile:</span> {d.profile ?? '—'}</div>
                  <div><span className="font-semibold">Endpoint:</span> {d.endpoint ?? '—'}</div>
                  <div><span className="font-semibold">HTTP:</span> {d.httpStatus ?? '—'}</div>
                  <div><span className="font-semibold">Code:</span> {d.errorCode ?? '—'}</div>
                  <div className="col-span-2"><span className="font-semibold">Message:</span> {d.message ?? '—'}</div>
                  {d.details && <div className="col-span-2"><span className="font-semibold">Details:</span> {d.details}</div>}
                  {d.hint && <div className="col-span-2"><span className="font-semibold">Hint:</span> {d.hint}</div>}
                </div>
                {d.params && (
                  <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-[11px] leading-snug text-gray-700">
                    {JSON.stringify(d.params, null, 2)}
                  </pre>
                )}
                {d.raw && (
                  <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-[11px] leading-snug text-gray-700">
                    {JSON.stringify(d.raw, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
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
