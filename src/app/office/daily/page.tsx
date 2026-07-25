'use client';
// Office → Daily: yesterday's payments, grouped by method (transfer/QR/card/cash) with the
// individual invoices so the clerk can tick each against the bank. Plus a link to cash count.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, Gate, rm, CashCountCard, type Home } from '@/components/office/shared';

type Entry = { method: string; descp: string | null; amount: number | string };
type DayCash = {
  error?: string;
  day: string;
  totals: { cash_in?: number | string; cash_out?: number | string; qr_in?: number | string; card_in?: number | string; transfer_in?: number | string };
  entries: Entry[];
};

const METHODS = [
  { key: 'transfer', label: 'Bank transfer', totalKey: 'transfer_in', icon: '🏦' },
  { key: 'qr', label: 'QR (DuitNow)', totalKey: 'qr_in', icon: '📱' },
  { key: 'card', label: 'Card', totalKey: 'card_in', icon: '💳' },
  { key: 'cash', label: 'Cash', totalKey: 'cash_in', icon: '💵' },
] as const;

const num = (x: unknown) => Number(x || 0);
// KL-yesterday (UTC+8), as YYYY-MM-DD
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

  return (
    <Gate allowed={allowed} loading={loading} d={(d ?? null) as unknown as Home}>
      <OfficeShell title="📅 Daily" back onRefresh={load}>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-gray-500">Day</span>
          <input type="date" value={day} max={klToday()} onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <p className="mb-4 text-sm text-gray-500">Check each transfer / QR / card payment against what landed in the bank, then count the cash.</p>

        <div className="space-y-3">
          {d && METHODS.map((m) => {
            const es = d.entries.filter((e) => e.method === m.key);
            const total = num(d.totals?.[m.totalKey as keyof typeof d.totals]);
            const lineSum = es.reduce((s, e) => s + num(e.amount), 0);
            const mismatch = Math.abs(lineSum - total) > 0.01;
            return (
              <div key={m.key} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{m.icon}</span>
                  <h2 className="text-sm font-semibold text-gray-800">{m.label}</h2>
                  <span className="ml-auto text-sm font-semibold text-gray-900">{rm(total)}</span>
                </div>
                {es.length > 0 ? (
                  <div className="mt-2 divide-y divide-gray-50">
                    {es.map((e, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 text-gray-600">{e.descp || '(no reference)'}</span>
                        <span className="shrink-0 font-medium text-gray-800">{rm(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : total > 0 ? (
                  <p className="mt-2 text-xs text-gray-400">No line detail for this day yet — it fills in after the cash-book sync.</p>
                ) : (
                  <p className="mt-2 text-xs text-gray-400">None.</p>
                )}
                {es.length > 0 && mismatch && (
                  <p className="mt-2 text-[11px] font-medium text-amber-700">⚠ Lines add up to {rm(lineSum)} but the day total is {rm(total)} — check.</p>
                )}
              </div>
            );
          })}

          <CashCountCard />
        </div>
      </OfficeShell>
    </Gate>
  );
}
