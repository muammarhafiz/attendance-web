// src/app/niagawan/sales/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Daily = {
  day: string;
  invoices: number;
  sales: number | string;
  cogs: number | string;
  profit: number | string;
  updated_at: string | null;
};

const n = (x: number | string | null | undefined) =>
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

export default function NiagawanSalesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Daily[]>([]);
  const [err, setErr] = useState<string | null>(null);

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

  // data (only for admins; RLS would block others anyway)
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase
        .from('niagawan_daily')
        .select('day,invoices,sales,cogs,profit,updated_at')
        .order('day', { ascending: false })
        .limit(60);
      if (error) setErr(error.message);
      else setRows((data ?? []) as Daily[]);
      setLoading(false);
    })();
  }, [isAdmin]);

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
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          {latest ? `Latest day · ${fmtDay(latest.day)}` : 'Latest day'}
        </h2>
        <span className="text-xs text-gray-400">Last synced: {lastSynced}</span>
      </div>

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
                return (
                  <tr key={r.day}>
                    <td className="px-3 py-2 text-gray-900">{fmtDay(r.day)}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{r.invoices ?? 0}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{rm(sales)}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{rm(cogs)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${profit < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
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
