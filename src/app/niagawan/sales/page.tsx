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

// Match the guard to the returned value: undefined must fall to 0, not NaN.
const n = (x: number | string | null | undefined) => {
  const v = typeof x === 'string' ? Number(x) : Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
};

const rm = (x: number) =>
  `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pctTxt = (sales: number, profit: number) =>
  sales > 0 ? `${((profit / sales) * 100).toFixed(0)}%` : '—';

function fmtDay(d: string) {
  // d is 'YYYY-MM-DD' (text) -> dd/MM/yyyy
  const [y, m, dd] = d.split('-');
  return dd && m && y ? `${dd}/${m}/${y}` : d;
}

// Today's KL date as YYYY-MM-DD (en-CA renders ISO order) — used to tell "today" from settled days.
function klToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

type SyncState = 'idle' | 'running' | 'done' | 'error';
type Status = { kind: 'final' | 'pending' | 'unknown'; zc: number; up: number; pc: number };

export default function NiagawanSalesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Daily[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [sync, setSync] = useState<SyncState>('idle');
  const [syncMsg, setSyncMsg] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-day real zero-cost count (server-side, no client cap) + per-day part-paid count.
  const [zeroByDay, setZeroByDay] = useState<Record<string, number>>({});
  const [zcError, setZcError] = useState(false);
  const [partialByDay, setPartialByDay] = useState<Record<string, number>>({});

  // auth + role
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('can_access', { p_feature: 'niagawan' });
        setIsAdmin(ok === true);
      } else {
        setIsAdmin(false);
      }
    })();
  }, []);

  const loadRows = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setErr(null);
    // Part-paid invoices are counted from the per-invoice mirror (only a few per day, well under
    // any row cap). We need them because niagawan_daily.unpaid_count only ever counts fully-UNPAID
    // invoices — a PARTIAL invoice never raises it, yet it's carried forward at 8pm and counted at
    // full value until then, so a day holding partials is NOT final.
    const bound = new Date();
    bound.setDate(bound.getDate() - 120);
    const boundISO = bound.toISOString().slice(0, 10);
    const [{ data, error }, { data: zc, error: zcErr }, { data: parts, error: partErr }] = await Promise.all([
      supabase
        .from('niagawan_daily')
        .select('day,invoices,sales,cogs,profit,unpaid_count,updated_at')
        .order('day', { ascending: false })
        .limit(60),
      supabase.rpc('cogs_zero_day_counts'),
      supabase.from('niagawan_sale_inv').select('day').eq('status', 'partial').gte('day', boundISO),
    ]);
    if (error) setErr(error.message);
    else setRows((data ?? []) as Daily[]);
    // If the cost-count RPC fails, do NOT silently treat every day as fully-costed — surface it and
    // fall back to "not verified" finality (handled in dayStatus via zcError).
    if (zcErr) {
      setZcError(true);
      setErr((prev) => prev ?? `Couldn't load cost-completeness data (${zcErr.message}) — day status can't be verified.`);
    } else {
      setZcError(false);
      const map: Record<string, number> = {};
      for (const row of (zc ?? []) as ZeroCount[]) map[row.audit_date] = Number(row.n) || 0;
      setZeroByDay(map);
    }
    const pmap: Record<string, number> = {};
    if (!partErr) for (const row of (parts ?? []) as { day: string }[]) pmap[row.day] = (pmap[row.day] ?? 0) + 1;
    setPartialByDay(pmap);
    setLoading(false);
  }, []);

  // A day is FINAL only when it has NO fully-unpaid invoices, NO part-paid invoices (both get
  // carried to the next working day at the 8pm carry-forward, and are counted at full value until
  // then), and NO un-priced parts (COGS/profit still incomplete). Missing/unverifiable paid or
  // cost data => 'unknown', never 'final'.
  const dayStatus = useCallback((r: Daily): Status => {
    const zc = zeroByDay[r.day] ?? 0;
    const pc = partialByDay[r.day] ?? 0;
    const up = r.unpaid_count;
    if (up == null || zcError) return { kind: 'unknown', zc, up: up ?? 0, pc };
    if (up === 0 && pc === 0 && zc === 0) return { kind: 'final', zc, up, pc };
    return { kind: 'pending', zc, up, pc };
  }, [zeroByDay, partialByDay, zcError]);

  // data (only for admins; RLS would block others anyway)
  useEffect(() => {
    if (!isAdmin) return;
    loadRows();
  }, [isAdmin, loadRows]);

  // clean up any running poll/timer on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

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
      const { data: row } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      const status = row?.status;
      if (status === 'done' || status === 'error') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        await loadRows({ quiet: true });
        setSync(status === 'done' ? 'done' : 'error');
        setSyncMsg(status === 'done' ? 'Synced ✓' : 'Sync ran but reported an error — check the NAS log.');
        doneTimer.current = setTimeout(() => { setSync('idle'); setSyncMsg(''); }, 5000);
      } else if (Date.now() - startedAt > 5 * 60 * 1000) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setSync('idle');
        setSyncMsg('Still running in the background — reloading the latest figures…');
        loadRows({ quiet: true });
      }
    }, 4000);
  }, [sync, loadRows]);

  const latest = rows[0];
  const latestIsToday = latest?.day === klToday();
  const latestStatus = useMemo<Status | null>(() => (latest ? dayStatus(latest) : null), [latest, dayStatus]);
  const latestPending = latestStatus ? latestStatus.kind !== 'final' : false;
  const lastSettled = useMemo(() => rows.find((r) => dayStatus(r).kind === 'final'), [rows, dayStatus]);
  const lastSynced = useMemo(() => {
    const ts = rows.map((r) => r.updated_at).filter(Boolean) as string[];
    if (!ts.length) return '—';
    const max = ts.reduce((a, b) => (a > b ? a : b)); // ISO strings compare correctly
    return new Date(max).toLocaleString('en-MY');
  }, [rows]);

  const reasonFor = (s: Status) =>
    [
      s.zc > 0 ? `${s.zc} item${s.zc === 1 ? '' : 's'} no cost` : '',
      s.up > 0 ? `${s.up} unpaid` : '',
      s.pc > 0 ? `${s.pc} part-paid` : '',
    ].filter(Boolean).join(' · ');

  const badge = (s: Status) => {
    if (s.kind === 'final') return <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">✓ final</span>;
    if (s.kind === 'pending') return <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">⏳ {reasonFor(s) || 'not final'}</span>;
    return <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-3">not verified</span>;
  };

  if (authed === null || isAdmin === null) return <div className="text-sm text-ink-3">Checking session…</div>;
  if (authed === false) return <div className="text-sm text-ink-2">Please sign in to view this page.</div>;
  if (!isAdmin) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  const kpis: { label: string; value: string; soft?: boolean }[] = latest
    ? [
        { label: 'Sales (invoiced)', value: rm(n(latest.sales)), soft: latestPending },
        { label: 'COGS', value: rm(n(latest.cogs)), soft: latestPending },
        { label: 'Profit', value: rm(n(latest.profit)), soft: latestPending },
        { label: 'Margin', value: latestPending ? '—' : pctTxt(n(latest.sales), n(latest.profit)) },
        { label: 'Invoices', value: String(latest.invoices ?? 0) },
      ]
    : [];

  const caveat = [
    '“Sales (invoiced)” is the full invoice value incl. part-paid and unpaid work — not cash collected.',
    latestPending ? 'Today’s figures are provisional: unpaid and part-paid invoices leave at the 8pm carry-forward, and costs may not be fully entered yet.' : '',
    lastSettled && latest && lastSettled.day !== latest.day
      ? `Last fully-settled day: ${fmtDay(lastSettled.day)} · ${rm(n(lastSettled.sales))}.`
      : '',
  ].filter(Boolean).join(' ');

  return (
    <div>
      {/* KPI header — latest day */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-2">
          {latest ? `${latestIsToday ? 'Today' : 'Latest day'} · ${fmtDay(latest.day)}` : 'Latest day'}
          {latestStatus && badge(latestStatus)}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-3">Last synced: {lastSynced}</span>
          <button
            onClick={syncNow}
            disabled={sync === 'running'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              sync === 'running' ? 'cursor-not-allowed bg-ink/5 text-ink-3' : 'bg-accent text-white hover:opacity-90'
            }`}
          >
            {sync === 'running' ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-ink-3" />
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
          className={`mb-3 rounded-lg border p-2 text-xs ${
            sync === 'error'
              ? 'border-rose-200 bg-bad-soft text-bad'
              : sync === 'done'
              ? 'border-emerald-200 bg-good-soft text-good'
              : 'border-accent/40 bg-accent-weak text-accent'
          }`}
        >
          {syncMsg}
        </div>
      )}

      {/* KPI row */}
      {loading ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-card bg-card p-4 shadow-card">
              <div className="h-3 w-16 rounded bg-ink/5" />
              <div className="mt-2 h-5 w-24 rounded bg-ink/5" />
            </div>
          ))}
        </div>
      ) : kpis.length === 0 ? (
        <div className="mb-6 text-sm text-ink-2">
          No sales data yet. It will appear here after the nightly sync (or a manual run).
        </div>
      ) : (
        <>
          <div className="mb-1.5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-card bg-card p-4 shadow-card">
                <div className="text-xs font-medium text-ink-2">{k.label}</div>
                <div className={`mt-1 text-lg font-semibold ${k.soft ? 'text-ink-3' : 'text-ink'}`}>{k.value}</div>
              </div>
            ))}
          </div>
          <p className="mb-5 text-xs text-ink-3">{caveat}</p>
        </>
      )}

      {/* Errors */}
      {err && <div className="mb-4 rounded-lg border border-rose-200 bg-bad-soft p-3 text-sm text-bad">{err}</div>}

      {/* Legend */}
      {!loading && rows.length > 0 && (
        <p className="mb-2 text-xs text-ink-3">
          <span className="font-medium text-good">✓ final</span> = settled and fully paid ·{' '}
          <span className="font-medium text-warn">⏳</span> = still changing (costs not entered yet, or unpaid/part-paid invoices carried to the next working day at 8pm)
        </p>
      )}

      {/* Daily table */}
      {loading ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : rows.length === 0 ? null : (
        <div className="overflow-x-auto rounded-card bg-card shadow-card">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-ink/[0.03]">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-ink-2">Date</th>
                <th className="px-3 py-2 font-semibold text-ink-2">Status</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-2">Invoices</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-2">Sales (invoiced)</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-2">COGS</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-2">Profit</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-2">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-card">
              {rows.map((r) => {
                const sales = n(r.sales);
                const cogs = n(r.cogs);
                const profit = n(r.profit);
                const s = dayStatus(r);
                const pending = s.kind !== 'final';
                const dim = pending ? 'text-ink-3' : 'text-ink';
                return (
                  <tr key={r.day} className={s.kind === 'pending' ? 'bg-warn-soft/40' : ''}>
                    <td className="px-3 py-2 text-ink">{fmtDay(r.day)}</td>
                    <td className="px-3 py-2">{badge(s)}</td>
                    <td className={`px-3 py-2 text-right ${dim}`}>{r.invoices ?? 0}</td>
                    <td className={`px-3 py-2 text-right ${dim}`}>{rm(sales)}</td>
                    <td className={`px-3 py-2 text-right ${dim}`}>{rm(cogs)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${profit < 0 ? 'text-bad' : dim}`}>{rm(profit)}</td>
                    <td className={`px-3 py-2 text-right ${pending ? 'text-ink-3' : 'text-ink-2'}`}>
                      {pending ? '—' : pctTxt(sales, profit)}
                    </td>
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
