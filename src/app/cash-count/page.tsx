// src/app/cash-count/page.tsx — end-of-day cash count (Tunai Harian).
// The supervisor counts the notes; the app asks one denomination at a time, totals it,
// then compares against today's CASH receipts in Niagawan and shows the variance.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const DENOMS = [100, 50, 20, 10, 5, 1] as const;
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rmc = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-MY'); // compact (no RM, no sen) for the narrow recent-counts table
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

type HistRow = { day: string; counted: number; cashIn: number | null; cashOut: number; by: string };

export default function CashCountPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [step, setStep] = useState(0); // 0..DENOMS.length-1 = denominations; DENOMS.length = summary
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [cashIn, setCashIn] = useState<number | null>(null);
  const [cashOut, setCashOut] = useState<number | null>(null);
  const [qrIn, setQrIn] = useState<number | null>(null);
  const [cardIn, setCardIn] = useState<number | null>(null);
  const [transferIn, setTransferIn] = useState<number | null>(null);
  const [cardActual, setCardActual] = useState<number | null>(null);
  const [qrActual, setQrActual] = useState<number | null>(null);
  const [transferActual, setTransferActual] = useState<number | null>(null);
  const [cashSyncing, setCashSyncing] = useState(true);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [onHand, setOnHand] = useState<number | null>(null);
  const [lastCollectedOn, setLastCollectedOn] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const today = klToday();

  // load today's CASH-in figure; trigger a fresh sync since counting happens after hours
  const loadCashIn = useCallback(async () => {
    const { data } = await supabase.from('niagawan_cash_daily').select('cash_in,cash_out,qr_in,card_in,transfer_in,updated_at').eq('day', today).maybeSingle();
    if (data) {
      // load every figure that's present — card/QR/transfer must not depend on cash being there
      setCashIn(data.cash_in == null ? null : Number(data.cash_in));
      setCashOut(data.cash_out == null ? 0 : Number(data.cash_out));
      setQrIn(data.qr_in == null ? null : Number(data.qr_in));
      setCardIn(data.card_in == null ? null : Number(data.card_in));
      setTransferIn(data.transfer_in == null ? null : Number(data.transfer_in));
      if (data.cash_in != null) setCashSyncing(false); // stop the cash spinner only once cash itself is in
    }
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

  // cash accumulated in the safe not yet banked = sum of daily counts since the last "taken to bank"
  const loadStatus = useCallback(async () => {
    const { data } = await supabase.rpc('cash_on_hand');
    const row = Array.isArray(data) ? data[0] : data;
    if (row) { setOnHand(row.on_hand == null ? 0 : Number(row.on_hand)); setLastCollectedOn(row.last_collected_on ?? null); }
  }, []);

  // (re)trigger a fresh Niagawan cash-book scrape, then poll for the result
  const syncCash = useCallback(async () => {
    setCashSyncing(true);
    await supabase.rpc('request_cash_sync');
    await loadCashIn();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(loadCashIn, 5000);
    setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } setCashSyncing(false); }, 45000);
  }, [loadCashIn]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (!data.session) { setAllowed(false); return; }
      const { data: ok } = await supabase.rpc('can_access', { p_feature: 'workshop' });
      setAllowed(ok === true);
      if (ok !== true) return;
      const { data: adm } = await supabase.rpc('is_admin');
      setIsAdmin(adm === true);
      // fresh start for this day — also clears yesterday's numbers if the day rolled over while the page was left open
      setSaved(false); setStep(0);
      setCounts({}); setCardActual(null); setQrActual(null); setTransferActual(null);
      setCashIn(null); setCashOut(null); setQrIn(null); setCardIn(null); setTransferIn(null);
      // load any existing count for today
      const { data: existing } = await supabase.from('niagawan_cash_count').select('*').eq('day', today).maybeSingle();
      if (existing) {
        setCounts({ 100: existing.n100, 50: existing.n50, 20: existing.n20, 10: existing.n10, 5: existing.n5, 1: existing.n1 });
        setCardActual(existing.card_counted == null ? null : Number(existing.card_counted));
        setQrActual(existing.qr_counted == null ? null : Number(existing.qr_counted));
        setTransferActual(existing.transfer_counted == null ? null : Number(existing.transfer_counted));
      }
      await loadHistory();
      await loadStatus();
      // ask the NAS to refresh today's cash book, then poll for it
      await syncCash();
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [today, loadHistory, loadStatus, syncCash]);

  const setCount = (denom: number, v: number) => setCounts((c) => ({ ...c, [denom]: Math.max(0, v) }));
  const total = DENOMS.reduce((s, d) => s + (counts[d] || 0) * d, 0);

  const save = useCallback(async () => {
    setErr(null);
    const { error } = await supabase.rpc('save_cash_count', {
      p_day: today, p_100: counts[100] || 0, p_50: counts[50] || 0, p_20: counts[20] || 0,
      p_10: counts[10] || 0, p_5: counts[5] || 0, p_1: counts[1] || 0,
      p_card: cardActual, p_qr: qrActual, p_transfer: transferActual,
    });
    if (error) { setErr(error.message); return; }
    setSaved(true);
    loadHistory();
    loadStatus();
  }, [counts, today, loadHistory, loadStatus, cardActual, qrActual, transferActual]);

  // Record "cash taken to the bank" — resets the cash-to-bank running total from today onward.
  const markCollected = useCallback(async () => {
    if (!window.confirm(`Reset the cash-to-bank total? This marks all cash counted so far${onHand ? ` (${rm(onHand)})` : ''} as taken to the bank.`)) return;
    setCollecting(true);
    const { error } = await supabase.rpc('mark_cash_collected');
    setCollecting(false);
    if (error) { setErr(error.message); return; }
    await loadStatus();
    await loadHistory();
  }, [onHand, loadStatus, loadHistory]);

  if (authed === null || (authed && allowed === null)) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in first.</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for supervisors only.</div>;

  const net = cashIn == null ? null : cashIn - (cashOut ?? 0);
  const variance = net == null ? null : total - net;
  const cardVar = cardActual == null || cardIn == null ? null : cardActual - cardIn;
  const qrVar = qrActual == null || qrIn == null ? null : qrActual - qrIn;
  const transferVar = transferActual == null || transferIn == null ? null : transferActual - transferIn;
  const computedVars = [variance, cardVar, qrVar, transferVar].filter((v): v is number => v != null);
  const anyMismatch = computedVars.some((v) => Math.abs(v) >= 0.01);
  // something was counted/entered but had no Niagawan figure to compare against
  const anyUnreconciled =
    (total > 0 && net == null) ||
    (cardActual != null && cardIn == null) ||
    (qrActual != null && qrIn == null) ||
    (transferActual != null && transferIn == null);
  const savedEmoji = anyMismatch || anyUnreconciled ? '⚠️' : computedVars.length > 0 ? '✅' : '💾';
  const isSummary = step >= DENOMS.length;

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <a href="/workshop" className="text-sm text-gray-400 hover:text-gray-600">← Back</a>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">💵 Cash Book</h1>
      <p className="mt-1 text-sm text-gray-500">{new Date(today).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>

      {!saved && !isSummary && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Niagawan so far today</span>
            <button onClick={syncCash} disabled={cashSyncing} className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 disabled:opacity-50">{cashSyncing ? 'Refreshing…' : '🔄 Refresh'}</button>
          </div>
          {cashIn == null ? (
            <div className="mt-2 text-sm text-gray-400">{cashSyncing ? 'fetching…' : 'not available'}</div>
          ) : (
            <div className="mt-2 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-gray-600">Cash <span className="text-gray-400">(in − out)</span></span><span className="font-semibold text-gray-900">{rm(net as number)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">QR</span><span className="font-semibold text-gray-900">{qrIn == null ? '—' : rm(qrIn)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Card</span><span className="font-semibold text-gray-900">{cardIn == null ? '—' : rm(cardIn)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-600">Transfer</span><span className="font-semibold text-gray-900">{transferIn == null ? '—' : rm(transferIn)}</span></div>
            </div>
          )}
        </div>
      )}

      {saved ? (
        <div className="mt-8 text-center">
          <div className="text-6xl">{savedEmoji}</div>
          <h2 className="mt-3 text-xl font-bold text-gray-900">Saved</h2>
          {anyUnreconciled && <p className="mt-1 text-xs text-amber-600">Some figures had no Niagawan total to compare yet.</p>}
          <div className="mt-4 space-y-1 rounded-xl border border-gray-200 bg-white p-4 text-left text-sm">
            <Row label="Counted cash" value={rm(total)} bold />
            <Row label="Niagawan cash (in − out)" value={net == null ? '—' : rm(net)} />
            {cashIn != null && <div className="text-right text-xs text-gray-400">in {rm(cashIn)} − out {rm(cashOut ?? 0)}</div>}
            <div className="mt-1 border-t border-gray-100 pt-2">
              <VarianceRow variance={variance} />
            </div>
            {(cardActual != null || qrActual != null || transferActual != null) && (
              <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                {cardActual != null && <SavedMethodRow label="Card" actual={cardActual} niagawan={cardIn} variance={cardVar} />}
                {qrActual != null && <SavedMethodRow label="QR" actual={qrActual} niagawan={qrIn} variance={qrVar} />}
                {transferActual != null && <SavedMethodRow label="Transfer" actual={transferActual} niagawan={transferIn} variance={transferVar} />}
              </div>
            )}
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
                onChange={(e) => { const n = parseInt(e.target.value || '0', 10); setCount(DENOMS[step], Number.isFinite(n) ? n : 0); }}
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

          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Card / QR / Transfer — enter actual</div>
            <p className="mt-1 text-xs text-gray-400">From the card-machine settlement slip / app totals. Leave blank to skip.</p>
            <div className="mt-2 divide-y divide-gray-100">
              <MethodRow label="Card" hint="machine total" niagawan={cardIn} actual={cardActual} setActual={setCardActual} variance={cardVar} />
              <MethodRow label="QR" niagawan={qrIn} actual={qrActual} setActual={setQrActual} variance={qrVar} />
              <MethodRow label="Transfer" niagawan={transferIn} actual={transferActual} setActual={setTransferActual} variance={transferVar} />
            </div>
          </div>

          {err && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

          <div className="mt-5 flex gap-3">
            <button onClick={() => setStep(DENOMS.length - 1)} className="flex-1 rounded-xl border border-gray-300 px-4 py-3.5 text-base font-semibold text-gray-700">Back</button>
            <button onClick={save} className="flex-[2] rounded-xl bg-emerald-600 px-4 py-3.5 text-base font-bold text-white hover:bg-emerald-700">Save count</button>
          </div>
        </div>
      )}

      {history.length > 0 && <RecentCounts rows={history} today={today} onHand={onHand} lastCollectedOn={lastCollectedOn} onCollect={markCollected} collecting={collecting} isAdmin={isAdmin} />}
    </div>
  );
}

function RecentCounts({ rows, today, onHand, lastCollectedOn, onCollect, collecting, isAdmin }: {
  rows: HistRow[]; today: string; onHand: number | null; lastCollectedOn: string | null;
  onCollect: () => void; collecting: boolean; isAdmin: boolean;
}) {
  return (
    <div className="mt-8">
      {/* Cash to bank = counted cash accumulated in the safe since the last reset */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Cash to bank</div>
      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-700">cash in safe</span>
          <span className="whitespace-nowrap text-2xl font-extrabold text-gray-900">{onHand == null ? '…' : rm(onHand)}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {lastCollectedOn
            ? <>start count {new Date(lastCollectedOn).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</>
            : <>all counted cash — not reset yet</>}
        </p>
        {isAdmin && (
          <button onClick={onCollect} disabled={collecting || !onHand}
            className="mt-3 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
            {collecting ? 'Saving…' : 'RESET CASH COUNT'}
          </button>
        )}
      </div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Recent counts</span>
        <span className="text-xs text-gray-400">{rows.length} day{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-right font-medium">Counted</th>
                <th className="px-2 py-2 text-right font-medium">Niagawan</th>
                <th className="px-2 py-2 text-right font-medium">+/−</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const net = r.cashIn == null ? null : r.cashIn - r.cashOut;
                const v = net == null ? null : r.counted - net;
                const banked = lastCollectedOn != null && r.day <= lastCollectedOn;
                return (
                  <tr key={r.day} className={banked ? 'opacity-45' : undefined}>
                    <td className="whitespace-nowrap px-2 py-2 text-left text-gray-700">
                      {new Date(r.day).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                      {r.day === today && <span className="ml-1 text-[10px] font-semibold text-emerald-600">today</span>}
                      {banked && <span className="ml-1 text-[10px] font-semibold text-gray-400">banked</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-gray-900">{rmc(r.counted)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-gray-500">{net == null ? '—' : rmc(net)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{varCell(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// compact variance for the table rows
function varCell(v: number | null) {
  if (v == null) return <span className="text-gray-300">—</span>;
  if (Math.abs(v) < 0.01) return <span className="font-semibold text-emerald-600">✅</span>;
  const short = v < 0;
  return <span className={`font-semibold ${short ? 'text-rose-600' : 'text-amber-600'}`}>{short ? '−' : '+'}{rmc(Math.abs(v))}</span>;
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

// One non-cash method on the summary step: shows the Niagawan figure, an input for the
// supervisor's actual (card-machine slip / app total), and the live variance.
function MethodRow({ label, hint, niagawan, actual, setActual, variance }: {
  label: string; hint?: string; niagawan: number | null;
  actual: number | null; setActual: (v: number | null) => void; variance: number | null;
}) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-700">{label}{hint && <span className="ml-1 text-xs font-normal text-gray-400">({hint})</span>}</span>
        <span className="text-xs text-gray-400">Niagawan {niagawan == null ? '—' : rm(niagawan)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="actual total"
          value={actual ?? ''}
          onChange={(e) => { const n = parseFloat(e.target.value); setActual(e.target.value === '' || !Number.isFinite(n) ? null : Math.max(0, n)); }}
          onFocus={(e) => e.target.select()}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-right text-base font-semibold" />
        <div className="w-24 shrink-0 text-right text-sm">{varCell(variance)}</div>
      </div>
    </div>
  );
}

// Compact one-line non-cash result on the saved screen.
function SavedMethodRow({ label, actual, niagawan, variance }: {
  label: string; actual: number; niagawan: number | null; variance: number | null;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label} <span className="text-xs text-gray-400">({rm(actual)} vs {niagawan == null ? '—' : rm(niagawan)})</span></span>
      <span>{varCell(variance)}</span>
    </div>
  );
}
