// src/app/niagawan/cogs/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Zero = {
  id: number;
  audit_date: string; // YYYY-MM-DD
  inv: string | null;
  inv_date: string | null;
  item: string | null;
  code: string | null;
  price: string | null;
  updated_at: string | null;
};

const rm = (x: number) =>
  `RM ${x.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (s: string | null | undefined) => {
  const v = Number(String(s ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

function fmtDay(d: string) {
  const [y, m, dd] = d.split('-');
  return dd && m && y ? `${dd}/${m}/${y}` : d;
}

export default function NiagawanCogsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Zero[]>([]);
  const [err, setErr] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('niagawan_cogs_zeros')
      .select('id,audit_date,inv,inv_date,item,code,price,updated_at')
      .order('audit_date', { ascending: false })
      .order('inv', { ascending: true })
      .limit(500);
    if (error) setErr(error.message);
    else setRows((data ?? []) as Zero[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin, load]);

  const stats = useMemo(() => {
    const invs = new Set<string>();
    const days = new Set<string>();
    let value = 0;
    for (const r of rows) {
      if (r.inv) invs.add(r.inv);
      if (r.audit_date) days.add(r.audit_date);
      value += num(r.price);
    }
    return { lines: rows.length, invoices: invs.size, days: days.size, value };
  }, [rows]);

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

  const kpis = [
    { label: 'Zero-cost lines', value: String(stats.lines) },
    { label: 'Invoices affected', value: String(stats.invoices) },
    { label: 'Days', value: String(stats.days) },
    { label: 'Sales value at risk', value: rm(stats.value) },
  ];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Zero-cost chase list</h2>
        <span className="text-xs text-gray-400">Last synced: {lastSynced}</span>
      </div>

      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        These are sold line items that have <strong>no cost (COGS) entered in Niagawan</strong>, so they show
        100% profit and inflate your real margin. Enter their cost in Niagawan, then re-sync — fixed items drop off
        this list automatically.
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="text-xs font-medium text-gray-500">{k.label}</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{k.value}</div>
          </div>
        ))}
      </div>

      {err && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{err}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          No zero-cost items found in the synced data yet — either everything has a cost entered (great!) or the
          COGS data hasn’t synced. Tap “Sync now” on the Sales tab to refresh.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold text-gray-700">Date</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Invoice</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Item</th>
                <th className="px-3 py-2 font-semibold text-gray-700">Code</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-900">
                    {r.inv_date || (r.audit_date ? fmtDay(r.audit_date) : '—')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{r.inv || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{r.item || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{r.code || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-gray-900">{rm(num(r.price))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
