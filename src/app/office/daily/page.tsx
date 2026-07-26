'use client';
// Office → Daily: yesterday's payments grouped by method, with the individual invoices. The clerk
// ticks each transfer/QR/card line once she confirms it's in the bank (cash is verified via the
// cash count instead). Checks persist in cash_entry_checked (survives the nightly re-scrape).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, Gate, rm, ZeroCogsCard, UnpaidCard, type Home, type ZeroLine } from '@/components/office/shared';

type Entry = { ekey: string; method: string; label?: string | null; descp: string | null; amount: number | string; checked: boolean; checked_by: string | null; checked_at: string | null };
type Method = { key: string; label: string; total: number | string; count: number; checked: number; checkable: boolean };
type DayCash = {
  error?: string;
  day: string;
  totals: { cash_in?: number | string; cash_out?: number | string; qr_in?: number | string; card_in?: number | string; transfer_in?: number | string };
  methods: Method[];
  entries: Entry[];
  zero_cogs: { items: number; days: number };
  zero_cogs_lines: ZeroLine[];
  unpaid: { count: number; total: number | string; top: { inv: string; customer: string | null; balance: number | string; status?: string | null; age_days?: number | null }[] };
  pi_pending: number;
  cash_counted: number | null;
};

// icon per method — canonical keys get a fixed glyph, anything else (atome/shopee_pay/…) gets a generic one
const METHOD_ICONS: Record<string, string> = { transfer: '🏦', qr: '📱', card: '💳', cash: '💵' };
const methodIcon = (key: string) => METHOD_ICONS[key] ?? '💰';

const num = (x: unknown) => Number(x || 0);
const klYesterday = () => new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export default function DailyPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [day, setDay] = useState(klYesterday());
  const [d, setD] = useState<DayCash | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashInput, setCashInput] = useState(''); // what the clerk keys in as counted cash

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  // keep the cash input in sync with the saved counted value when the day/data changes
  useEffect(() => { setCashInput(d?.cash_counted != null ? String(d.cash_counted) : ''); }, [d?.cash_counted]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('clerk_cash_entries', { p_day: day });
    setD((data ?? null) as DayCash);
    setLoading(false);
  }, [day]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const shiftDay = (delta: number) => {
    const [y, m, dd] = day.split('-').map(Number);
    setDay(new Date(Date.UTC(y, m - 1, dd + delta)).toISOString().slice(0, 10));
  };

  const setChecked = useCallback(async (ekey: string, checked: boolean) => {
    setD((prev) => (prev ? { ...prev, entries: prev.entries.map((e) => (e.ekey === ekey ? { ...e, checked } : e)) } : prev));
    const { error } = await supabase.rpc('clerk_set_entry_checked', { p_ekey: ekey, p_checked: checked });
    if (error) load();
  }, [load]);

  const saveCashCount = useCallback(async (raw: string, total: number) => {
    const v = raw.trim() === '' ? null : Number(raw);
    const valid = v != null && Number.isFinite(v) && v >= 0;
    const matches = valid && Math.abs((v as number) - total) < 0.01;
    setD((prev) => (prev ? { ...prev, cash_counted: valid ? (v as number) : null } : prev));
    const { error } = await supabase.rpc('office_set_daily_task', { p_day: day, p_task: 'cash_counted', p_done: matches, p_value: valid ? v : null });
    if (error) load();
  }, [day, load]);

  return (
    <Gate allowed={allowed} loading={loading} d={(d ?? null) as unknown as Home}>
      <OfficeShell title="📅 Daily" back onRefresh={load}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Payments</div>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-gray-500">Payments for</span>
          <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50">◀</button>
          <input type="date" value={day} max={klToday()} onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          <button onClick={() => shiftDay(1)} disabled={day >= klToday()} aria-label="Next day" className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40">▶</button>
        </div>
        <p className="mb-4 text-sm text-gray-500">Tick each transfer / QR / card payment once you confirm it&rsquo;s in the bank, then count the cash.</p>

        {d && (() => {
          const checkableM = d.methods.filter((m) => m.checkable); // transfer/QR/card/atome/… need bank-checking; cash is counted
          const checkedN = checkableM.reduce((s, m) => s + m.checked, 0);
          const totalN = checkableM.reduce((s, m) => s + m.count, 0);
          const left = totalN - checkedN;
          const grandTotal = d.methods.reduce((s, m) => s + num(m.total), 0);
          return (
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Total in by method</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {d.methods.map((m) => (
                  <div key={m.key}>
                    <div className="text-xs text-gray-500">{methodIcon(m.key)} {m.label}</div>
                    <div className="text-base font-semibold text-gray-900">{rm(num(m.total))}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                <span>Total money in</span>
                <span>{rm(grandTotal)}</span>
              </div>
              {totalN > 0 && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-gray-600">Payments checked</span>
                  <span className={left > 0 ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>
                    {checkedN}/{totalN}{left > 0 ? ` · ${left} to check` : ' · all done ✓'}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        <div className="space-y-3">
          {d && d.methods.map((m) => {
            const es = d.entries.filter((e) => e.method === m.key);
            const total = num(m.total);
            const lineSum = es.reduce((s, e) => s + num(e.amount), 0);
            const mismatch = es.length > 0 && Math.abs(lineSum - total) > 0.01;
            const checkedCount = es.filter((e) => e.checked).length;
            const allChecked = m.checkable && es.length > 0 && checkedCount === es.length;
            const cardDone = m.key === 'cash' ? (d.cash_counted != null && Math.abs(Number(d.cash_counted) - total) < 0.01) : allChecked;
            return (
              <div key={m.key} className={`rounded-xl border p-4 ${cardDone ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{methodIcon(m.key)}</span>
                  <h2 className="text-sm font-semibold text-gray-800">{m.label}</h2>
                  {m.checkable && es.length > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${allChecked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{checkedCount}/{es.length} checked</span>
                  )}
                  <span className="ml-auto text-right">
                    {m.key === 'card' && <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Settlement</span>}
                    <span className="text-sm font-semibold text-gray-900">{rm(total)}</span>
                  </span>
                </div>
                {m.key === 'card' && <p className="mt-1 text-[11px] text-gray-400">Match this against the card machine&rsquo;s daily settlement slip.</p>}
                {m.key === 'cash' && (() => {
                  const counted = cashInput.trim() === '' ? null : Number(cashInput);
                  const valid = counted != null && Number.isFinite(counted) && counted >= 0;
                  const matches = valid && Math.abs((counted as number) - total) < 0.01;
                  const diff = valid ? (counted as number) - total : 0;
                  return (
                    <div className={`mt-2 rounded-lg border p-3 ${matches ? 'border-emerald-300 bg-emerald-50' : valid ? 'border-rose-200 bg-rose-50' : 'border-gray-200'}`}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-600">Counted RM</span>
                        <input type="number" inputMode="decimal" step="0.01" min="0" value={cashInput}
                          onChange={(e) => setCashInput(e.target.value)} onBlur={() => saveCashCount(cashInput, total)}
                          placeholder="0.00" className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
                        {matches && <span className="font-semibold text-emerald-700">✓ matches</span>}
                      </div>
                      {valid && !matches && <p className="mt-1 text-xs font-semibold text-rose-600">{diff > 0 ? `Over by ${rm(diff)}` : `Short by ${rm(-diff)}`} · system says {rm(total)}</p>}
                      {!valid && <p className="mt-1 text-[11px] text-gray-400">Key in the cash you counted — it turns green when it matches {rm(total)}.</p>}
                    </div>
                  );
                })()}
                {es.length > 0 ? (
                  <div className="mt-2 divide-y divide-gray-50">
                    {es.map((e) => (
                      <div key={e.ekey} className="flex items-start gap-2 py-1.5 text-sm">
                        {m.checkable && (
                          <button onClick={() => setChecked(e.ekey, !e.checked)} aria-label={`Mark ${e.checked ? 'not ' : ''}checked in bank`}
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[10px] font-bold transition ${e.checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-transparent hover:border-emerald-400'}`}>✓</button>
                        )}
                        <span className={`min-w-0 flex-1 ${e.checked ? 'text-gray-400 line-through' : 'text-gray-600'}`}>{e.descp || '(no reference)'}</span>
                        <span className={`shrink-0 font-medium ${e.checked ? 'text-gray-400' : 'text-gray-800'}`}>{rm(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : total > 0 ? (
                  <p className="mt-2 text-xs text-gray-400">No line detail for this day yet — it fills in after the cash-book sync.</p>
                ) : (
                  <p className="mt-2 text-xs text-gray-400">None.</p>
                )}
                {mismatch && (
                  <p className="mt-2 text-[11px] font-medium text-amber-700">⚠ Lines add up to {rm(lineSum)} but the day total is {rm(total)} — check.</p>
                )}
              </div>
            );
          })}

          {d && <UnpaidCard unpaid={d.unpaid} />}
          {d && <ZeroCogsCard zero_cogs={d.zero_cogs} lines={d.zero_cogs_lines} day={day} onRecheck={load} />}
        </div>
      </OfficeShell>
    </Gate>
  );
}
