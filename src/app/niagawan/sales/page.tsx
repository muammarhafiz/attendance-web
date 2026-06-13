// src/app/niagawan/sales/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Daily = {
  day: string;
  invoices: number;
  sales: number | string;
  cogs: number | string;
  profit: number | string;
  unpaid_count: number | null;
  updated_at: string | null;
};

type ZeroCount = { audit_date: string; n: number };

const n =(x: number | string | null | undefined) =>
  Number.isFinite(typeof x === 'string' ? Number(x) : (x ?? 0)) ? Number(x) : 0;

const rm = (x: number) =>
  `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pctTxt = (sales: number, profit: number) =>
  sales > 0 ? `${((profit / sales) * 100).toFixed(0)}%` : '—';

function fmtDay(d: string) {
  // d is 'YYYY-MM-DD' (text) -> dd/MM/yyyy
  const [y, m, dd] = d.split('-');
  return dd && m && y ? `${dd}/${m}/${y}` : d;
}

type SyncState = 'idle' | 'running' | 'done' | 'error';

export default function NiagawanSalesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Daily[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [sync, setSync] = useState<SyncState>('idle');
  const [syncMsg, setSyncMsg] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-day real zero-cost count, computed server-side (no 1000-row client cap).
  const [zeroByDay, setZeroByDay] = useState<Record<string, number>>({});

  // auth + role
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else {
        setIsAdmin(false);
      }
    })();
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [{ data, error }, { data: zc }] = await Promise.all([
      supabase
        .from('niagawan_daily')
        .select('day,invoices,sales,cogs,profit,unpaid_count,updated_at')
        .order('day', { ascending: false })
        .limit(60),
      supabase.rpc('cogs_zero_day_counts'),
    ]);
    if (error) setErr(error.message);
    else setRows((data ?? []) as Daily[]);
    const map: Record<string, number> = {};
    for (const row of (zc ?? []) as ZeroCount[]) map[row.audit_date] = Number(row.n) || 0;
    setZeroByDay(map);
    setLoading(false);
  }, []);

  // A day is only FINAL when it has no real zero-cost items (server-side count, ignore rules
  // applied) AND no unpaid invoices left (they get carried forward at 8pm).
  const dayStatus = useCallback((r: Daily) => {
    const zc = zeroByDay[r.day] ?? 0;
    const up = r.unpaid_count;
    if (up == null) return { kind: 'unknown' as const, zc, up: 0 };
    if (up === 0 && zc === 0) return { kind: 'final' as const, zc, up };
    return { kind: 'pending' as const, zc, up };
  }, [zeroByDay]);

  // data (only for admins; RLS would block others anyway)
  useEffect(() => {
    if (!isAdmin) return;
    loadRows();
  }, [isAdmin, loadRows]);

  // clean up any running poll on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const syncNow = useCallback(async () => {
    if (sync === 'running') return;
    setSync('running');
    setSyncMsg('Starting…');
    const { data, error } = await supabase
      .from('sync_requests')
      .insert({ source: 'website' })
      .select('id')
      .single();
    if (error || !data) {
      setSync('error');
      setSyncMsg('Could not start sync: ' + (error?.message ?? 'unknown error'));
      return;
    }
    const id = data.id as number;
    setSyncMsg('Syncing from Niagawan… this usually takes 1–2 minutes.');
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      const { data: row } = await supabase
        .from('sync_requests')
        .select('status')
        .eq('id', id)
        .single();
      const status = row?.status;
      if (status === 'done' || status === 'error') {
        if (pollRef.current) clearInterval(pollRef.current);
        await loadRows();
        setSync(status === 'done' ? 'done' : 'error');
        setSyncMsg(status === 'done' ? 'Synced ✓' : 'Sync ran but reported an error — check the NAS log.');
        setTimeout(() => { setSync('idle'); setSyncMsg(''); }, 5000);
      } else if (Date.now() - startedAt > 5 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setSync('idle');
        setSyncMsg('Still running in the background — refresh in a moment.');
      }
    }, 4000);
  }, [sync, loadRows]);

  const latest = rows[0];
  const lastSynced = useMemo(() => {
    const t = rows.find((r) => r.updated_at)?.updated_at;
    return t ? new Date(t).toLocaleString('en-MY') : '—';
  }, [rows]);

  if (authed === null || isAdmin === null) {
    return <div className="text-sm text-gray-500">Checking session…</div>;
  }
  if (authed === false) {
    return <div className="text-sm text-gray-600">Please sign in to view this page.</div>;
  }
  if (!isAdmin) {
    return <div className="text-sm text-gray-600">This page is for admins only.</div>;
  }

  const kpis = latest
    ? [
        { label: 'Sales', value: rm(n(latest.sales)) },
        { label: 'COGS', value: rm(n(latest.cogs)) },
        { label: 'Profit', value: rm(n(latest.profit)) },
        { label: 'Margin', value: pctTxt(n(latest.sales), n(latest.profit)) },
        { label: 'Invoices', value: String(latest.invoices ?? 0) },
      ]
    : [];

  return (
    <div>
      {/* KPI row — latest day */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {latest ? `Latest day · ${fmtDay(latest.day)}` : 'Latest day'}
          {latest && (() => {
            const s = dayStatus(latest);
            if (s.kind === 'final') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ final</span>;
            if (s.kind === 'pending') return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⏳ not final</span>;
            return null;
          })()}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Last synced: {lastSynced}</span>
          <button
            onClick={syncNow}
            disabled={sync === 'running'}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              sync === 'running'
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {sync === 'running' ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
                Syncing…
              </>
            ) : (
              'Sync now'
            )}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div
          className={`mb-3 rounded border p-2 text-xs ${
            sync === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : sync === 'done'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
        >
          {syncMsg}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="text-xs font-medium text-gray-500">{k.label}</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{k.value}</div>
          </div>
        ))}
        {kpis.length === 0 && (
          <div className="col-span-2 text-sm text-gray-500 sm:col-span-5">No data yet.</div>
        )}
      </div>

      {/* Daily table */}
      {err && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500">
          No sales data yet. It will appear here after the nightly sync (or a manual run).
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-gray-700">Date</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Status</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Invoices</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Sales</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">COGS</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Profit</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((r) => {
                const sales = n(r.sales);
                const cogs = n(r.cogs);
                const profit = n(r.profit);
                const s = dayStatus(r);
                const pending = s.kind === 'pending';
                // Pending = the numbers WILL still change: zero-cost items mean COGS/profit are
                // incomplete; unpaid invoices will be carried out of this day at 8pm.
                const reason = pending
                  ? [s.zc > 0 ? `${s.zc} item${s.zc === 1 ? '' : 's'} no cost` : '', s.up > 0 ? `${s.up} unpaid` : ''].filter(Boolean).join(' · ')
                  : '';
                const dim = pending ? 'text-gray-400' : 'text-gray-900';
                return (
                  <tr key={r.day} className={pending ? 'bg-amber-50/40' : ''}>
                    <td className="px-3 py-2 text-gray-900">{fmtDay(r.day)}</td>
                    <td className="px-3 py-2">
                      {s.kind === 'final' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ final</span>}
                      {s.kind === 'pending' && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700" title="These numbers will still change — the clerk hasn't finished entering costs and/or unpaid invoices will be carried forward at 8pm.">
                          ⏳ {reason}
                        </span>
                      )}
                      {s.kind === 'unknown' && <span className="text-xs text-gray-300" title="Will be checked on the next sync.">—</span>}
                    </td>
                    <td className={`px-3 py-2 text-right ${dim}`}>{r.invoices ?? 0}</td>
                    <td className={`px-3 py-2 text-right ${dim}`}>{rm(sales)}</td>
                    <td className={`px-3 py-2 text-right ${dim}`}>{rm(cogs)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${profit < 0 ? 'text-rose-600' : dim}`}>
                      {rm(profit)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{pctTxt(sales, profit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
