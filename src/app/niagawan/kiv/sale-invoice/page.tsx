// src/app/niagawan/kiv/sale-invoice/page.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Moved = {
  id: number;
  sale_inv_no: string;
  customer: string | null;
  amount: number | string | null;
  original_date: string | null;
  new_date: string | null;
  moved_at: string;
};

const rm = (x: number | string | null | undefined) => {
  const n = Number(x);
  return Number.isFinite(n) ? `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};
const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return dd && m && y ? `${dd}/${m}/${y}` : d;
};
const fmtWhen = (s: string) => {
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? s : dt.toLocaleString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

type RunState = 'idle' | 'running' | 'done' | 'error';

export default function KivSaleInvoicePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Moved[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>('idle');
  const [runMsg, setRunMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // KL date
  const [fromDate, setFromDate] = useState(todayISO);
  const [toDate, setToDate] = useState(todayISO);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('niagawan_moved_sale')
      .select('*')
      .order('moved_at', { ascending: false })
      .limit(300);
    if (error) setErr(error.message);
    setRows((data ?? []) as Moved[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // Manual trigger: queue a live KIV move on the NAS (same engine as the 19:45 schedule),
  // for the chosen date range. All unpaid invoices found move to the next working day.
  const moveNow = useCallback(async () => {
    if (run === 'running') return;
    if (!fromDate || !toDate) { setRun('error'); setRunMsg('Pick both dates.'); return; }
    if (fromDate > toDate) { setRun('error'); setRunMsg('"From" must be on or before "To".'); return; }
    const fmt = (d: string) => d.split('-').reverse().join('/');
    if (!window.confirm(
      `Move UNPAID sale invoices dated ${fmt(fromDate)} – ${fmt(toDate)} to the next working day?\n\n` +
      'Each one is first marked delivered (dated the day the car came in), then its invoice date is moved. ' +
      'This changes real invoices in Niagawan — normally the 19:45 schedule does this automatically for today.'
    )) return;
    setRun('running');
    setRunMsg('Starting…');
    const { data, error } = await supabase
      .from('sync_requests')
      .insert({ which: 'kiv', source: 'website', from_date: fromDate, to_date: toDate })
      .select('id')
      .single();
    if (error || !data) {
      setRun('error');
      setRunMsg('Could not start: ' + (error?.message ?? 'unknown error'));
      return;
    }
    const id = data.id as number;
    setRunMsg('Moving unpaid invoices… this usually takes under a minute.');
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      const { data: row } = await supabase.from('sync_requests').select('status,result').eq('id', id).single();
      const status = row?.status;
      if (status === 'done' || status === 'error') {
        if (pollRef.current) clearInterval(pollRef.current);
        await load();
        const moved = (row?.result || '').match(/(\d+) unpaid invoice/);
        setRun(status === 'done' ? 'done' : 'error');
        setRunMsg(status === 'done'
          ? `Done ✓${moved ? ` — ${moved[1]} unpaid invoice(s) processed` : ''} — details emailed & listed below.`
          : 'The run reported an error — check the email / NAS log.');
        setTimeout(() => { setRun('idle'); setRunMsg(''); }, 8000);
      } else if (Date.now() - startedAt > 5 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setRun('idle');
        setRunMsg('Still running in the background — refresh in a moment.');
      }
    }, 4000);
  }, [run, load, fromDate, toDate]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div className="space-y-4">
      {/* Card: Moved sale invoices */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Moved sale invoices</h2>
            <p className="mt-0.5 text-xs text-gray-400">Unpaid invoices carried forward to the next day (so each day&apos;s sales/COGS reflects only completed, paid sales).</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-gray-500">
              From
              <input type="date" value={fromDate} max={todayISO} onChange={(e) => setFromDate(e.target.value)}
                className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-xs" />
            </label>
            <label className="text-[11px] text-gray-500">
              To
              <input type="date" value={toDate} max={todayISO} onChange={(e) => setToDate(e.target.value)}
                className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-xs" />
            </label>
            <button
              onClick={moveNow}
              disabled={run === 'running'}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {run === 'running' ? 'Moving…' : 'Move unpaid invoices'}
            </button>
            <button onClick={load} disabled={loading} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">{loading ? '…' : 'Refresh'}</button>
          </div>
        </div>

        {runMsg && (
          <div className={`mx-3 mt-3 rounded-md border p-2 text-sm ${run === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : run === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {runMsg}
          </div>
        )}
        {err && <div className="m-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium text-gray-600">Invoice</th>
                <th className="px-3 py-2 font-medium text-gray-600">Customer</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Amount</th>
                <th className="px-3 py-2 font-medium text-gray-600">From</th>
                <th className="px-3 py-2 font-medium text-gray-600">Moved to</th>
                <th className="px-3 py-2 font-medium text-gray-600">Moved at</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No moved invoices yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-gray-800">{r.sale_inv_no}</td>
                  <td className="px-3 py-2 text-gray-700">{r.customer ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rm(r.amount)}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtDate(r.original_date)}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{fmtDate(r.new_date)}</td>
                  <td className="px-3 py-2 text-gray-500">{fmtWhen(r.moved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* More cards (e.g. Partial invoices) will go here later. */}
    </div>
  );
}
