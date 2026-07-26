'use client';
// Office → Daily: yesterday's payments grouped by method, with the individual invoices. The clerk
// ticks each transfer/QR/card line once she confirms it's in the bank (cash is verified via the
// cash count instead). Checks persist in cash_entry_checked (survives the nightly re-scrape).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, Gate, rm, CashCountCard, ZeroCogsCard, UnpaidCard, type Home } from '@/components/office/shared';

type Entry = { ekey: string; method: string; descp: string | null; amount: number | string; checked: boolean; checked_by: string | null; checked_at: string | null };
type DayCash = {
  error?: string;
  day: string;
  totals: { cash_in?: number | string; cash_out?: number | string; qr_in?: number | string; card_in?: number | string; transfer_in?: number | string };
  entries: Entry[];
  zero_cogs: { items: number; days: number };
  unpaid: { count: number; total: number | string; top: { inv: string; customer: string | null; balance: number | string }[] };
  pi_pending: number;
};

const METHODS = [
  { key: 'transfer', label: 'Bank transfer', totalKey: 'transfer_in', icon: '🏦', checkable: true },
  { key: 'qr', label: 'QR (DuitNow)', totalKey: 'qr_in', icon: '📱', checkable: true },
  { key: 'card', label: 'Card', totalKey: 'card_in', icon: '💳', checkable: true },
  { key: 'cash', label: 'Cash', totalKey: 'cash_in', icon: '💵', checkable: false },
] as const;

const num = (x: unknown) => Number(x || 0);
const klYesterday = () => new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export default function DailyPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [day, setDay] = useState(klYesterday());
  const [d, setD] = useState<DayCash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('clerk_cash_entries', { p_day: day });
    setD((data ?? null) as DayCash);
    setLoading(false);
  }, [day]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const setChecked = useCallback(async (ekey: string, checked: boolean) => {
    setD((prev) => (prev ? { ...prev, entries: prev.entries.map((e) => (e.ekey === ekey ? { ...e, checked } : e)) } : prev));
    const { error } = await supabase.rpc('clerk_set_entry_checked', { p_ekey: ekey, p_checked: checked });
    if (error) load();
  }, [load]);

  return (
    <Gate allowed={allowed} loading={loading} d={(d ?? null) as unknown as Home}>
      <OfficeShell title="📅 Daily" back onRefresh={load}>
        {/* Purchase invoices */}
        {d && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🧾</span>
              <h2 className="text-sm font-semibold text-gray-800">Purchase invoices</h2>
              <Link href="/niagawan/purchase" className="ml-auto text-xs font-medium text-blue-600 hover:underline">Open page →</Link>
            </div>
            <p className="mt-1 text-sm text-gray-600">Check in every purchase invoice and make sure the RM amount matches the paper invoice.</p>
            {d.pi_pending > 0
              ? <p className="mt-1 text-xs font-medium text-amber-700">{d.pi_pending} invoice{d.pi_pending === 1 ? '' : 's'} waiting to be checked in</p>
              : <p className="mt-1 text-xs text-emerald-700">None waiting ✓</p>}
          </div>
        )}

        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Payments</div>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-gray-500">Payments for</span>
          <input type="date" value={day} max={klToday()} onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <p className="mb-4 text-sm text-gray-500">Tick each transfer / QR / card payment once you confirm it&rsquo;s in the bank, then count the cash.</p>

        {d && (() => {
          const checkable = d.entries.filter((e) => e.method !== 'cash'); // transfer/QR/card need bank-checking
          const checkedN = checkable.filter((e) => e.checked).length;
          const left = checkable.length - checkedN;
          return (
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Total in by method</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {METHODS.map((m) => (
                  <div key={m.key}>
                    <div className="text-xs text-gray-500">{m.icon} {m.label}</div>
                    <div className="text-base font-semibold text-gray-900">{rm(num(d.totals?.[m.totalKey as keyof typeof d.totals]))}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                <span>Total money in</span>
                <span>{rm(METHODS.reduce((s, m) => s + num(d.totals?.[m.totalKey as keyof typeof d.totals]), 0))}</span>
              </div>
              {checkable.length > 0 && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-gray-600">Payments checked</span>
                  <span className={left > 0 ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>
                    {checkedN}/{checkable.length}{left > 0 ? ` · ${left} to check` : ' · all done ✓'}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        <div className="space-y-3">
          {d && METHODS.map((m) => {
            const es = d.entries.filter((e) => e.method === m.key);
            const total = num(d.totals?.[m.totalKey as keyof typeof d.totals]);
            const lineSum = es.reduce((s, e) => s + num(e.amount), 0);
            const mismatch = es.length > 0 && Math.abs(lineSum - total) > 0.01;
            const checkedCount = es.filter((e) => e.checked).length;
            const allChecked = m.checkable && es.length > 0 && checkedCount === es.length;
            return (
              <div key={m.key} className={`rounded-xl border p-4 ${allChecked ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{m.icon}</span>
                  <h2 className="text-sm font-semibold text-gray-800">{m.label}</h2>
                  {m.checkable && es.length > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${allChecked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{checkedCount}/{es.length} checked</span>
                  )}
                  <span className="ml-auto text-sm font-semibold text-gray-900">{rm(total)}</span>
                </div>
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
          <CashCountCard />
          {d && <ZeroCogsCard zero_cogs={d.zero_cogs} />}
        </div>
      </OfficeShell>
    </Gate>
  );
}
