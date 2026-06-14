// src/app/cash-count/page.tsx — end-of-day cash count (Tunai Harian).
// The supervisor counts the notes; the app asks one denomination at a time, totals it,
// then compares against today's CASH receipts in Niagawan and shows the variance.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const DENOMS = [100, 50, 20, 10, 5, 1] as const;
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

type HistRow = { day: string; counted: number; cashIn: number | null; cashOut: number; by: string };

export default function CashCountPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [step, setStep] = useState(0); // 0..DENOMS.length-1 = denominations; DENOMS.length = summary
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [cashIn, setCashIn] = useState<number | null>(null);
  const [cashOut, setCashOut] = useState<number | null>(null);
  const [cashSyncing, setCashSyncing] = useState(true);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<HistRow[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const today = klToday();

  // load today's CASH-in figure; trigger a fresh sync since counting happens after hours
  const loadCashIn = useCallback(async () => {
    const { data } = await supabase.from('niagawan_cash_daily').select('cash_in,cash_out,updated_at').eq('day', today).maybeSingle();
    if (data && data.cash_in != null) { setCashIn(Number(data.cash_in)); setCashOut(data.cash_out == null ? 0 : Number(data.cash_out)); setCashSyncing(false); }
  }, [today]);

  // load the last 30 days of saved counts, joined with that day's Niagawan cash for the variance
  const loadHistory = useCallback(async () => {
    const { data: rows } = await supabase
      .from('niagawan_cash_count')
      .select('day,counted_total,counted_by')
      .order('day', { ascending: false })
      .limit(30);
    if (!rows) return;
    const days = rows.map((r) => r.day as string);
    const { data: daily } = await supabase.from('niagawan_cash_daily').select('day,cash_in,cash_out').in('day', days);
    const dByDay = new Map((daily ?? []).map((d) => [d.day as string, { cin: d.cash_in == null ? null : Number(d.cash_in), cout: d.cash_out == null ? 0 : Number(d.cash_out) }]));
    setHistory(rows.map((r) => {
      const d = dByDay.get(r.day as string);
      return {
        day: r.day as string,
        counted: Number(r.counted_total),
        cashIn: d ? d.cin : null,
        cashOut: d ? d.cout : 0,
        by: (r.counted_by as string) ?? '',
      };
    }));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (!data.session) { setAllowed(false); return; }
      const { data: ok } = await supabase.rpc('can_access', { p_feature: 'workshop' });
      setAllowed(ok === true);
      if (ok !== true) return;
      // load any existing count for today
      const { data: existing } = await supabase.from('niagawan_cash_count').select('*').eq('day', today).maybeSingle();
      if (existing) setCounts({ 100: existing.n100, 50: existing.n50, 20: existing.n20, 10: existing.n10, 5: existing.n5, 1: existing.n1 });
      await loadHistory();
      // ask the NAS to refresh today's cash book, then poll for it
      await supabase.rpc('request_cash_sync');
      await loadCashIn();
      pollRef.current = setInterval(loadCashIn, 5000);
      setTimeout(() => { if (pollRef.current) clearInterval(pollRef.current); setCashSyncing(false); }, 45000);
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [today, loadCashIn, loadHistory]);

  const setCount = (denom: number, v: number) => setCounts((c) => ({ ...c, [denom]: Math.max(0, v) }));
  const total = DENOMS.reduce((s, d) => s + (counts[d] || 0) * d, 0);

  const save = useCallback(async () => {
    setErr(null);
    const { error } = await supabase.rpc('save_cash_count', {
      p_day: today, p_100: counts[100] || 0, p_50: counts[50] || 0, p_20: counts[20] || 0,
      p_10: counts[10] || 0, p_5: counts[5] || 0, p_1: counts[1] || 0,
    });
    if (error) { setErr(error.message); return; }
    setSaved(true);
    loadHistory();
  }, [counts, today, loadHistory]);

  if (authed === null || (authed && allowed === null)) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in first.</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for supervisors only.</div>;

  const net = cashIn == null ? null : cashIn - (cashOut ?? 0);
  const variance = net == null ? null : total - net;
  const isSummary = step >= DENOMS.length;

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <a href="/workshop" className="text-sm text-gray-400 hover:text-gray-600">← Back</a>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">💵 Cash Count</h1>
      <p className="mt-1 text-sm text-gray-500">{new Date(today).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>

      {saved ? (
        <div className="mt-8 text-center">
          <div className="text-6xl">{variance === 0 ? '✅' : '⚠️'}</div>
          <h2 className="mt-3 text-xl font-bold text-gray-900">Saved</h2>
          <div className="mt-4 space-y-1 rounded-xl border border-gray-200 bg-white p-4 text-left text-sm">
            <Row label="Counted cash" value={rm(total)} bold />
            <Row label="Niagawan cash (in − out)" value={net == null ? '—' : rm(net)} />
            {cashIn != null && <div className="text-right text-xs text-gray-400">in {rm(cashIn)} − out {rm(cashOut ?? 0)}</div>}
            <div className="mt-1 border-t border-gray-100 pt-2">
              <VarianceRow variance={variance} />
            </div>
          </div>
          <button onClick={() => { setSaved(false); setStep(0); }} className="mt-6 w-full rounded-xl bg-gray-100 px-6 py-3 text-base font-semibold text-gray-700">Recount</button>
        </div>
      ) : !isSummary ? (
        <div className="mt-6">
          <div className="text-center text-sm font-medium text-gray-400">Note {step + 1} of {DENOMS.length}</div>
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <div className="text-sm text-gray-500">How many</div>
            <div className="my-1 text-4xl font-extrabold text-emerald-700">RM{DENOMS[step]}</div>
            <div className="text-sm text-gray-500">notes?</div>
            <div className="mt-5 flex items-center justify-center gap-4">
              <button onClick={() => setCount(DENOMS[step], (counts[DENOMS[step]] || 0) - 1)} className="h-14 w-14 rounded-xl border border-gray-300 text-2xl font-bold text-gray-700">−</button>
              <input type="number" inputMode="numeric" value={counts[DENOMS[step]] ?? 0}
                onChange={(e) => setCount(DENOMS[step], parseInt(e.target.value || '0', 10))}
                onFocus={(e) => e.target.select()}
                className="w-28 rounded-xl border border-gray-300 px-2 py-3 text-center text-3xl font-bold" />
              <button onClick={() => setCount(DENOMS[step], (counts[DENOMS[step]] || 0) + 1)} className="h-14 w-14 rounded-xl border border-gray-300 text-2xl font-bold text-gray-700">+</button>
            </div>
            <div className="mt-3 text-sm text-gray-500">= {rm((counts[DENOMS[step]] || 0) * DENOMS[step])}</div>
          </div>

          <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-center text-sm text-gray-600">Running total: <span className="font-bold text-gray-900">{rm(total)}</span></div>

          <div className="mt-5 flex gap-3">
            {step > 0 && <button onClick={() => setStep(step - 1)} className="flex-1 rounded-xl border border-gray-300 px-4 py-3.5 text-base font-semibold text-gray-700">Back</button>}
            <button onClick={() => setStep(step + 1)} className="flex-[2] rounded-xl bg-blue-600 px-4 py-3.5 text-base font-bold text-white hover:bg-blue-700">
              {step === DENOMS.length - 1 ? 'See result' : 'Next'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Breakdown</div>
            {DENOMS.map((d) => (
              <div key={d} className="flex justify-between py-0.5 text-sm">
                <span className="text-gray-600">RM{d} × {counts[d] || 0}</span>
                <span className="text-gray-800">{rm((counts[d] || 0) * d)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-base font-bold"><span>Counted total</span><span>{rm(total)}</span></div>
          </div>

          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <Row label="Niagawan cash (in − out)" value={cashSyncing && cashIn == null ? 'fetching…' : cashIn == null ? 'not available' : rm(net as number)} />
            {cashIn != null && <div className="text-right text-xs text-gray-400">in {rm(cashIn)} − out {rm(cashOut ?? 0)}</div>}
            <div className="mt-2 border-t border-gray-100 pt-2"><VarianceRow variance={variance} /></div>
          </div>

          {err && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

          <div className="mt-5 flex gap-3">
            <button onClick={() => setStep(DENOMS.length - 1)} className="flex-1 rounded-xl border border-gray-300 px-4 py-3.5 text-base font-semibold text-gray-700">Back</button>
            <button onClick={save} className="flex-[2] rounded-xl bg-emerald-600 px-4 py-3.5 text-base font-bold text-white hover:bg-emerald-700">Save count</button>
          </div>
        </div>
      )}

      {history.length > 0 && <RecentCounts rows={history} today={today} />}
    </div>
  );
}

function RecentCounts({ rows, today }: { rows: HistRow[]; today: string }) {
  return (
    <div className="mt-8">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Recent counts</div>
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {rows.map((r) => {
          const net = r.cashIn == null ? null : r.cashIn - r.cashOut;
          const v = net == null ? null : r.counted - net;
          return (
            <div key={r.day} className="flex items-start justify-between px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {new Date(r.day).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {r.day === today && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">today</span>}
                </div>
                <div className="truncate text-xs text-gray-400">by {r.by.split('@')[0] || '—'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-gray-900">{rm(r.counted)}</div>
                <div className="text-xs text-gray-400">Niagawan net {net == null ? '—' : rm(net)}</div>
                {r.cashIn != null && <div className="text-[11px] text-gray-300">in {rm(r.cashIn)} − out {rm(r.cashOut)}</div>}
                <div className="text-xs">{histVariance(v)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function histVariance(v: number | null) {
  if (v == null) return <span className="text-gray-400">no Niagawan figure</span>;
  if (Math.abs(v) < 0.01) return <span className="font-semibold text-emerald-600">✅ match</span>;
  const short = v < 0;
  return <span className={`font-semibold ${short ? 'text-rose-600' : 'text-amber-600'}`}>{short ? '⚠️ short −' : '⚠️ over +'}{rm(Math.abs(v))}</span>;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className="flex justify-between"><span className="text-gray-600">{label}</span><span className={bold ? 'font-bold text-gray-900' : 'text-gray-800'}>{value}</span></div>;
}

function VarianceRow({ variance }: { variance: number | null }) {
  if (variance == null) return <div className="text-sm text-gray-400">Variance: waiting for Niagawan figure…</div>;
  if (Math.abs(variance) < 0.01) return <div className="flex justify-between text-sm font-semibold text-emerald-700"><span>✅ Match</span><span>balanced</span></div>;
  const short = variance < 0;
  return (
    <div className={`flex justify-between text-sm font-semibold ${short ? 'text-rose-700' : 'text-amber-700'}`}>
      <span>{short ? '⚠️ SHORT' : '⚠️ OVER'}</span>
      <span>{short ? '−' : '+'}{rm(Math.abs(variance)).replace('RM ', 'RM ')}</span>
    </div>
  );
}
