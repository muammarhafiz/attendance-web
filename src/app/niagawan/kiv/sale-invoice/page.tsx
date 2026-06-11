// src/app/niagawan/kiv/sale-invoice/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type Partial = {
  id: number;
  sale_inv_no: string;
  customer: string | null;
  total: number | string | null;
  paid: number | string | null;
  balance: number | string | null;
  sale_date: string | null;
  scanned_at: string;
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
  const [partials, setPartials] = useState<Partial[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scan, setScan] = useState<RunState>('idle');
  const [scanMsg, setScanMsg] = useState('');
  const [yearFilter, setYearFilter] = useState<string>(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 4)); // default: current year (KL)
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [run, setRun] = useState<RunState>('idle');
  const [runMsg, setRunMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const todayISO = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // KL date
  // Default source = previous working day (Sunday closed: Monday looks back to Saturday).
  // ⚠ Niagawan REJECTS future invoice dates (and reverts the invoice to its original date), so
  // the target is capped at today — carry-forward runs in the morning: yesterday -> today.
  const lastWorking = (() => {
    const d = new Date(Date.now() + 8 * 3600 * 1000 - 86400 * 1000);
    if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const [fromDate, setFromDate] = useState(lastWorking); // source: the day whose unpaid invoices to move
  const [toDate, setToDate] = useState(todayISO);        // target: the date to move them TO (max today)

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

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (scanPollRef.current) clearInterval(scanPollRef.current);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const [{ data, error }, { data: pData, error: pErr }] = await Promise.all([
      supabase.from('niagawan_moved_sale').select('*').order('moved_at', { ascending: false }).limit(300),
      supabase.from('niagawan_partial_sale').select('*').order('sale_date', { ascending: false }).limit(300),
    ]);
    if (error || pErr) setErr(error?.message || pErr?.message || null);
    setRows((data ?? []) as Moved[]);
    setPartials((pData ?? []) as Partial[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // Manual trigger: queue a live KIV move on the NAS (same engine as the 19:45 schedule),
  // for the chosen date range. All unpaid invoices found move to the next working day.
  const moveNow = useCallback(async () => {
    if (run === 'running') return;
    if (!fromDate || !toDate) { setRun('error'); setRunMsg('Pick both dates.'); return; }
    if (fromDate === toDate) { setRun('error'); setRunMsg('The two dates must be different.'); return; }
    if (toDate > todayISO) { setRun('error'); setRunMsg('Niagawan does not accept future invoice dates — "Move to" can be today at the latest.'); return; }
    const fmt = (d: string) => d.split('-').reverse().join('/');
    const sunday = new Date(toDate + 'T00:00:00Z').getUTCDay() === 0;
    if (!window.confirm(
      `Move UNPAID sale invoices dated ${fmt(fromDate)} to ${fmt(toDate)}?\n\n` +
      (sunday ? '⚠ Note: the target date is a SUNDAY (workshop closed).\n\n' : '') +
      'Each one is first marked delivered (dated the day the car came in), then its invoice date is changed. ' +
      'This changes real invoices in Niagawan — normally the morning schedule does this automatically (yesterday → today).'
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

  // Manual trigger: refresh the partial-invoice snapshot now (read-only scan of the year).
  const scanNow = useCallback(async () => {
    if (scan === 'running') return;
    setScan('running'); setScanMsg('Scanning Niagawan for partially-paid invoices… (~1 min)');
    const { data, error } = await supabase.from('sync_requests').insert({ which: 'kiv-partial', source: 'website' }).select('id').single();
    if (error || !data) { setScan('error'); setScanMsg('Could not start: ' + (error?.message ?? 'unknown error')); return; }
    const id = data.id as number;
    const startedAt = Date.now();
    scanPollRef.current = setInterval(async () => {
      const { data: row } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      const status = row?.status;
      if (status === 'done' || status === 'error') {
        if (scanPollRef.current) clearInterval(scanPollRef.current);
        await load();
        setScan(status === 'done' ? 'done' : 'error');
        setScanMsg(status === 'done' ? 'Scan complete ✓' : 'Scan reported an error — check the email / NAS log.');
        setTimeout(() => { setScan('idle'); setScanMsg(''); }, 6000);
      } else if (Date.now() - startedAt > 5 * 60 * 1000) {
        if (scanPollRef.current) clearInterval(scanPollRef.current);
        setScan('idle'); setScanMsg('Still running — refresh in a moment.');
      }
    }, 4000);
  }, [scan, load]);

  // Year dropdown options: the years present in the data plus the current year; the card
  // always shows ONE selected year (default: current year).
  const partialYears = useMemo(() => {
    const ys = new Set<string>([new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 4)]);
    partials.forEach((p) => { if (p.sale_date) ys.add(p.sale_date.slice(0, 4)); });
    return Array.from(ys).sort().reverse();
  }, [partials]);
  const shownPartials = useMemo(
    () => partials.filter((p) => (p.sale_date || '').startsWith(yearFilter)),
    [partials, yearFilter]
  );
  const shownOwed = useMemo(() => shownPartials.reduce((s, p) => s + (Number(p.balance) || 0), 0), [shownPartials]);

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
              Invoices dated
              <input type="date" value={fromDate} max={todayISO} onChange={(e) => setFromDate(e.target.value)}
                className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-xs" />
            </label>
            <span className="pb-1.5 text-gray-400">→</span>
            <label className="text-[11px] text-gray-500">
              Move to
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

      {/* Card: Partial invoices */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Partial invoices</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Sale invoices where the customer paid a deposit but still owes a balance (all years). Refreshed daily at the scheduled time
              {partials[0]?.scanned_at ? <> · last scanned {fmtWhen(partials[0].scanned_at)}</> : null}.
            </p>
            <p className="mt-1 text-xs font-medium text-gray-600">
              {shownPartials.length} invoice{shownPartials.length === 1 ? '' : 's'} in {yearFilter} · <span className="text-rose-700">{rm(shownOwed)} owed</span>
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-[11px] text-gray-500">
              Year
              <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
                className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-xs">
                {partialYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <button
              onClick={scanNow}
              disabled={scan === 'running'}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {scan === 'running' ? 'Scanning…' : '↻ Scan now'}
            </button>
          </div>
        </div>

        {scanMsg && (
          <div className={`mx-3 mt-3 rounded-md border p-2 text-sm ${scan === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : scan === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {scanMsg}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium text-gray-600">Invoice</th>
                <th className="px-3 py-2 font-medium text-gray-600">Customer</th>
                <th className="px-3 py-2 font-medium text-gray-600">Date</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Total</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Paid</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Balance owed</th>
              </tr>
            </thead>
            <tbody>
              {shownPartials.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">{partials.length === 0 ? 'No partial invoices found — press “Scan now” for the first scan.' : 'No partial invoices in ' + yearFilter + '.'}</td></tr>
              ) : shownPartials.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-gray-800">{r.sale_inv_no}</td>
                  <td className="px-3 py-2 text-gray-700">{r.customer ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtDate(r.sale_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rm(r.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{rm(r.paid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-700">{rm(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
