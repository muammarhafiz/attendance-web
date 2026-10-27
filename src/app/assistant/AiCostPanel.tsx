'use client';

// Owner-only AI cost tracker, shown at the top of the Assistant page. Reads per-call usage logged by
// the AI routes (ai_usage) and the prepaid-credit config (ai_credit) via admin-gated RPCs. Cost is an
// estimate (token counts x published model price); calibrated against AI Studio's real billed RM.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Feature = { feature: string; cost: number; calls: number; tokens: number };
type Summary = { total_cost: number; total_calls: number; total_tokens: number; by_feature: Feature[] };
type Credit = { amount: number; loaded_on: string | null };

const FEATURE_NAMES: Record<string, string> = {
  pinv: 'Invoice reader', assistant: 'Assistant', tyre: 'Tyre import', bank: 'Bank reconcile',
};
const rm = (v: unknown) => {
  const n = Number(v) || 0;
  return `RM${n.toFixed(n > 0 && n < 0.1 ? 4 : 2)}`;
};

export default function AiCostPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<Summary | null>(null);
  const [today, setToday] = useState<Summary | null>(null);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [usedSince, setUsedSince] = useState(0);
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setMsg('');
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const nowIso = now.toISOString();
    const [m, t, c] = await Promise.all([
      supabase.rpc('ai_usage_summary', { p_from: monthStart, p_to: nowIso }),
      supabase.rpc('ai_usage_summary', { p_from: todayStart, p_to: nowIso }),
      supabase.rpc('ai_credit_get'),
    ]);
    setMonth((m.data as Summary) ?? null);
    setToday((t.data as Summary) ?? null);
    const cr = (c.data as Credit) ?? null;
    setCredit(cr);
    if (cr?.loaded_on) {
      const s = await supabase.rpc('ai_usage_summary', { p_from: new Date(cr.loaded_on + 'T00:00:00').toISOString(), p_to: nowIso });
      setUsedSince(Number((s.data as Summary)?.total_cost) || 0);
    } else setUsedSince(0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCredit = async () => {
    const a = Number(String(amt).replace(/[^0-9.]/g, ''));
    const { error } = await supabase.rpc('ai_credit_set', { p_amount: Number.isFinite(a) ? a : 0, p_loaded_on: date || null });
    if (error) { setMsg(error.message); return; }
    setEditing(false); await load();
  };

  // Credit runway: remaining / average daily spend since the credit was loaded.
  const now = new Date();
  let left: number | null = null;
  let runOut: Date | null = null;
  if (credit && credit.amount > 0 && credit.loaded_on) {
    left = credit.amount - usedSince;
    const days = Math.max(1, (now.getTime() - new Date(credit.loaded_on + 'T00:00:00').getTime()) / 86400000);
    const avg = usedSince / days;
    if (avg > 0 && left > 0) runOut = new Date(now.getTime() + (left / avg) * 86400000);
  }
  const monthCost = month?.total_cost ?? 0;
  const leftStr = left != null ? rm(left) : '—';

  return (
    <div className="mb-3 rounded-xl border border-line bg-card/60 text-sm">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span aria-hidden>💡</span>
        <span className="font-medium text-ink">AI cost</span>
        <span className="text-xs text-ink-3">· this month {loading ? '…' : rm(monthCost)}{credit?.amount ? ` · credit left ${leftStr}` : ''}</span>
        <span className="ml-auto text-ink-3">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div><span className="text-ink-3">Today</span> <span className="font-semibold text-ink">{rm(today?.total_cost ?? 0)}</span> <span className="text-ink-3">({today?.total_calls ?? 0} call{(today?.total_calls ?? 0) === 1 ? '' : 's'})</span></div>
            <div><span className="text-ink-3">This month</span> <span className="font-semibold text-ink">{rm(monthCost)}</span> <span className="text-ink-3">({month?.total_calls ?? 0} call{(month?.total_calls ?? 0) === 1 ? '' : 's'})</span></div>
          </div>

          <div className="space-y-1">
            {(month?.by_feature ?? []).length === 0 && <div className="text-xs text-ink-3">No AI usage recorded this month yet.</div>}
            {(month?.by_feature ?? []).map((f) => (
              <div key={f.feature} className="flex items-center justify-between text-xs">
                <span className="text-ink-2">{FEATURE_NAMES[f.feature] ?? f.feature}</span>
                <span className="text-ink-3">{f.calls} call{f.calls === 1 ? '' : 's'} · <span className="font-medium text-ink">{rm(f.cost)}</span></span>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-ink/5 p-2 text-xs">
            {editing ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-ink-3">Credit loaded (RM) <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="50" className="ml-1 w-20 rounded border border-line bg-card px-1.5 py-0.5 text-ink" /></label>
                <label className="text-ink-3">on <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-1 rounded border border-line bg-card px-1.5 py-0.5 text-ink" /></label>
                <button onClick={saveCredit} className="rounded bg-accent px-2 py-0.5 font-medium text-white hover:opacity-90">Save</button>
                <button onClick={() => setEditing(false)} className="text-ink-3 hover:text-ink-2">Cancel</button>
              </div>
            ) : credit?.amount ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-ink-2">Credit <b className="text-ink">{rm(credit.amount)}</b> loaded {credit.loaded_on}</span>
                <span className="text-ink-3">· used <b className="text-ink">{rm(usedSince)}</b></span>
                <span className="text-ink-3">· left <b className={left != null && left < 5 ? 'text-bad' : 'text-good'}>{leftStr}</b></span>
                {runOut && <span className="text-ink-3">· ~runs out {runOut.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}</span>}
                <button onClick={() => { setAmt(String(credit.amount)); setDate(credit.loaded_on ?? ''); setEditing(true); }} className="ml-auto text-accent hover:underline">Edit</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-ink-3">Set your prepaid credit to track how much is left.</span>
                <button onClick={() => { setAmt(''); setDate(''); setEditing(true); }} className="text-accent hover:underline">Set credit</button>
              </div>
            )}
          </div>

          {msg && <div className="text-xs text-bad">{msg}</div>}
          <div className="flex items-center justify-between text-[11px] text-ink-3">
            <span>Estimated from token counts × model price (calibrated to AI Studio). Tracks from when logging began.</span>
            <button onClick={load} className="text-accent hover:underline">Refresh</button>
          </div>
        </div>
      )}
    </div>
  );
}
