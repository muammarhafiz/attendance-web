// src/app/workshop/needs-mechanic/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  inv: string;
  day: string;
  car: string | null;
  amount: number | string;
  days_waiting: number;
};

const rm = (x: number) =>
  `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtD(iso: string) {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${Number(d)} ${MON[Number(m)] ?? m}` : iso;
}

// Aging pill styling: fresh → muted, a few days → amber, old → red.
function ageStyle(days: number) {
  if (days >= 4) return 'bg-bad-soft text-bad';
  if (days >= 2) return 'bg-warn-soft text-warn';
  return 'bg-ink/5 text-ink-3';
}
function ageLabel(days: number) {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function NeedsMechanicPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: acc } = await supabase.rpc('my_access');
        const a = (acc as { owner?: boolean; workshop?: boolean } | null) ?? {};
        setAllowed(!!(a.owner || a.workshop));
      } else {
        setAllowed(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc('sales_needs_mechanic');
    if (error) setErr(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

  if (authed === null || allowed === null) {
    return <div className="text-sm text-ink-3">Checking session…</div>;
  }
  if (authed === false) return <div className="text-sm text-ink-2">Please sign in to view this page.</div>;
  if (!allowed) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-ink">Needs mechanic</h1>
          <p className="text-xs text-ink-3">Sales over RM50 with no mechanic name yet</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-ink/5 disabled:opacity-40"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mb-3 rounded-xl border border-line bg-card p-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-2xl font-semibold text-ink tabular-nums">{rows.length}</div>
            <div className="text-xs text-ink-3">to name</div>
          </div>
          <div className="h-8 w-px bg-line" />
          <div>
            <div className="text-2xl font-semibold text-ink tabular-nums">{rm(total)}</div>
            <div className="text-xs text-ink-3">unattributed value</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Open each one in Niagawan and set the mechanic (salesperson). It drops off this list automatically once the
          name is saved and the next data sync runs (it won&rsquo;t disappear the instant you fix it).
        </p>
      </div>

      {err && <div className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{err}</div>}

      {!loading && rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-card p-6 text-center">
          <div className="text-sm font-medium text-good">All clear 🎉</div>
          <div className="mt-1 text-xs text-ink-3">Every sale over RM50 has a mechanic name.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-3 py-2 font-medium">Car / customer</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-3">Loading…</td></tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={r.inv} className="border-b border-line/60">
                  <td className="px-3 py-2 text-ink">{r.car ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">{r.inv}</td>
                  <td className="px-3 py-2 text-ink-2">{fmtD(r.day)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">{rm(Number(r.amount) || 0)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ageStyle(r.days_waiting)}`}>
                      {ageLabel(r.days_waiting)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
