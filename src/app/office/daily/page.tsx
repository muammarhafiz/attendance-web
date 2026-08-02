'use client';
// Office → Daily: yesterday's payments grouped by method, with the individual invoices. The clerk
// ticks each transfer/QR/card line once she confirms it's in the bank (cash is verified via the
// cash count instead). Checks persist in cash_entry_checked (survives the nightly re-scrape).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, Gate, rm, fmtDay, ZeroCogsCard, UnpaidCard, type Home, type ZeroLine } from '@/components/office/shared';
import { Icon } from '@/components/icons';

type Entry = { ekey: string; method: string; label?: string | null; descp: string | null; amount: number | string; checked: boolean; kiv: boolean; note: string | null; checked_by: string | null; checked_at: string | null };
type Method = { key: string; label: string; total: number | string; count: number; checked: number; kiv: number; checkable: boolean };
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

type BnplOutItem = { provider: string; display_name: string; invoice_no: string; vehicle: string | null; day: string; gross: number | string; est_net: number | string };
type BnplOut = { providers: { slug: string; display_name: string }[]; total: { count: number; gross: number | string; est_net: number | string }; items: BnplOutItem[] };

const num = (x: unknown) => Number(x || 0);
const klYesterday = () => new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export default function DailyPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [day, setDay] = useState(klYesterday());
  const [d, setD] = useState<DayCash | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashInput, setCashInput] = useState(''); // what the clerk keys in as counted cash
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({}); // per-line KIV note being typed
  const [bnpl, setBnpl] = useState<BnplOut | null>(null); // outstanding BNPL sales — not day-scoped, carries forward until settled

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

  const loadBnpl = useCallback(async () => {
    const { data } = await supabase.rpc('bnpl_outstanding', { p_provider: null });
    setBnpl((data ?? null) as BnplOut);
  }, []);
  useEffect(() => { if (allowed) loadBnpl(); }, [allowed, loadBnpl]);

  const bnplSlugs = new Set((bnpl?.providers ?? []).map((p) => p.slug));

  const shiftDay = (delta: number) => {
    const [y, m, dd] = day.split('-').map(Number);
    setDay(new Date(Date.UTC(y, m - 1, dd + delta)).toISOString().slice(0, 10));
  };

  const setChecked = useCallback(async (ekey: string, checked: boolean) => {
    setD((prev) => (prev ? { ...prev, entries: prev.entries.map((e) => (e.ekey === ekey ? { ...e, checked } : e)) } : prev));
    const { error } = await supabase.rpc('clerk_set_entry_checked', { p_ekey: ekey, p_checked: checked });
    if (error) load();
  }, [load]);

  // Mark a payment line KIV ("keep in view") while the supervisor checks it, with an optional note.
  const setKiv = useCallback(async (ekey: string, kiv: boolean, note: string | null) => {
    setD((prev) => (prev ? { ...prev, entries: prev.entries.map((e) => (e.ekey === ekey ? { ...e, kiv, note: kiv ? note : null } : e)) } : prev));
    const { error } = await supabase.rpc('clerk_set_entry_kiv', { p_ekey: ekey, p_kiv: kiv, p_note: kiv ? note : null });
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
      <OfficeShell title="Daily" back onRefresh={() => { load(); loadBnpl(); }}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Payments</div>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-ink-2">Payments for</span>
          <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="rounded-md border border-line px-2.5 py-1 hover:bg-ink/5">◀</button>
          <input type="date" value={day} max={klToday()} onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-line px-2 py-1 text-sm" />
          <button onClick={() => shiftDay(1)} disabled={day >= klToday()} aria-label="Next day" className="rounded-md border border-line px-2.5 py-1 hover:bg-ink/5 disabled:opacity-40">▶</button>
        </div>
        <p className="mb-4 text-sm text-ink-2">Tick each transfer / QR / card payment once it&rsquo;s in the bank, then count the cash. If one looks wrong, tap <span className="font-semibold text-warn">KIV</span> and note it — the supervisor will check it.</p>

        {d && (() => {
          const vmethods = d.methods.filter((m) => !bnplSlugs.has(m.key)); // BNPL is tracked separately below, not bank-checked same-day
          const checkableM = vmethods.filter((m) => m.checkable);
          const checkedN = checkableM.reduce((s, m) => s + m.checked, 0);
          const kivN = checkableM.reduce((s, m) => s + (m.kiv || 0), 0);
          const totalN = checkableM.reduce((s, m) => s + m.count, 0);
          const left = totalN - checkedN - kivN;
          const grandTotal = vmethods.reduce((s, m) => s + num(m.total), 0);
          return (
            <div className="mb-4 rounded-card bg-card shadow-card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Total in by method</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {vmethods.map((m) => (
                  <div key={m.key}>
                    <div className="text-xs text-ink-2">{m.label}</div>
                    <div className="text-base font-semibold text-ink">{rm(num(m.total))}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between border-t border-line pt-2 text-sm font-semibold">
                <span>Total money in</span>
                <span>{rm(grandTotal)}</span>
              </div>
              {totalN > 0 && (
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-ink-2">Payments checked</span>
                  <span className={`font-semibold ${left > 0 || kivN > 0 ? 'text-warn' : 'text-good'}`}>
                    {checkedN}/{totalN}{kivN > 0 ? ` · ${kivN} KIV` : ''}{left > 0 ? ` · ${left} to check` : kivN > 0 ? '' : ' · all done ✓'}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        <div className="space-y-3">
          {d && d.methods.filter((m) => !bnplSlugs.has(m.key)).map((m) => {
            const es = d.entries.filter((e) => e.method === m.key);
            const total = num(m.total);
            const lineSum = es.reduce((s, e) => s + num(e.amount), 0);
            const mismatch = es.length > 0 && Math.abs(lineSum - total) > 0.01;
            const checkedCount = es.filter((e) => e.checked).length;
            const kivCount = es.filter((e) => e.kiv && !e.checked).length;
            const backlog = m.checkable ? es.length - checkedCount - kivCount : 0; // unchecked & not KIV
            const allChecked = m.checkable && es.length > 0 && checkedCount === es.length;
            const parked = m.checkable && es.length > 0 && backlog === 0 && kivCount > 0; // all resolved, some waiting on KIV
            const cashDone = m.key === 'cash' && d.cash_counted != null && Math.abs(Number(d.cash_counted) - total) < 0.01;
            const border = m.key === 'cash'
              ? (cashDone ? 'bg-good-soft' : 'bg-card')
              : allChecked ? 'bg-good-soft'
              : parked ? 'bg-warn-soft'
              : 'bg-card';
            return (
              <div key={m.key} className={`rounded-card shadow-card p-4 ${border}`}>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink-2">{m.label}</h2>
                  {m.checkable && es.length > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${allChecked ? 'bg-good-soft text-good' : parked ? 'bg-warn-soft text-warn' : 'bg-ink/5 text-ink-2'}`}>{checkedCount}/{es.length} checked{kivCount > 0 ? ` · ${kivCount} KIV` : ''}</span>
                  )}
                  <span className="ml-auto text-right">
                    {m.key === 'card' && <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Settlement</span>}
                    <span className="text-sm font-semibold text-ink">{rm(total)}</span>
                  </span>
                </div>
                {m.key === 'card' && <p className="mt-1 text-[11px] text-ink-3">Match this against the card machine&rsquo;s daily settlement slip.</p>}
                {m.key === 'cash' && (() => {
                  const counted = cashInput.trim() === '' ? null : Number(cashInput);
                  const valid = counted != null && Number.isFinite(counted) && counted >= 0;
                  const matches = valid && Math.abs((counted as number) - total) < 0.01;
                  const diff = valid ? (counted as number) - total : 0;
                  return (
                    <div className={`mt-2 rounded-lg border p-3 ${matches ? 'border-emerald-300 bg-good-soft' : valid ? 'border-rose-200 bg-bad-soft' : 'border-line'}`}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-ink-2">Counted RM</span>
                        <input type="number" inputMode="decimal" step="0.01" min="0" value={cashInput}
                          onChange={(e) => setCashInput(e.target.value)} onBlur={() => saveCashCount(cashInput, total)}
                          placeholder="0.00" className="w-28 rounded border border-line px-2 py-1 text-sm" />
                        {matches && <span className="font-semibold text-good">✓ matches</span>}
                      </div>
                      {valid && !matches && <p className="mt-1 text-xs font-semibold text-bad">{diff > 0 ? `Over by ${rm(diff)}` : `Short by ${rm(-diff)}`} · system says {rm(total)}</p>}
                      {!valid && <p className="mt-1 text-[11px] text-ink-3">Key in the cash you counted — it turns green when it matches {rm(total)}.</p>}
                    </div>
                  );
                })()}
                {es.length > 0 ? (
                  <div className="mt-2 divide-y divide-line">
                    {es.map((e) => (
                      <div key={e.ekey} className={`py-1.5 text-sm ${e.kiv && !e.checked ? 'rounded-md bg-warn-soft px-2' : ''}`}>
                        <div className="flex items-start gap-2">
                          {m.checkable && (
                            <button onClick={() => setChecked(e.ekey, !e.checked)} aria-label={`Mark ${e.checked ? 'not ' : ''}checked in bank`}
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-[10px] font-bold transition ${e.checked ? 'border-good bg-good text-white' : 'border-line text-transparent hover:border-good'}`}>✓</button>
                          )}
                          <span className={`min-w-0 flex-1 ${e.checked ? 'text-ink-3 line-through' : e.kiv ? 'text-warn' : 'text-ink-2'}`}>{e.descp || '(no reference)'}</span>
                          <span className={`shrink-0 font-medium ${e.checked ? 'text-ink-3' : 'text-ink-2'}`}>{rm(e.amount)}</span>
                          {m.checkable && !e.checked && (
                            <button onClick={() => setKiv(e.ekey, !e.kiv, e.note ?? '')} title="KIV — mark for the supervisor to check"
                              className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition ${e.kiv ? 'border-amber-400 bg-warn-soft text-warn' : 'border-line text-ink-3 hover:border-amber-400 hover:text-warn'}`}>KIV</button>
                          )}
                        </div>
                        {e.kiv && !e.checked && (
                          <div className="mt-1 pl-7">
                            <input value={noteDraft[e.ekey] ?? e.note ?? ''}
                              onChange={(ev) => setNoteDraft((p) => ({ ...p, [e.ekey]: ev.target.value }))}
                              onBlur={() => setKiv(e.ekey, true, noteDraft[e.ekey] ?? e.note ?? '')}
                              placeholder="note — what's being checked?"
                              className="w-full rounded border border-amber-200 bg-card px-2 py-0.5 text-xs" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : total > 0 ? (
                  <p className="mt-2 text-xs text-ink-3">No line detail for this day yet — it fills in after the cash-book sync.</p>
                ) : (
                  <p className="mt-2 text-xs text-ink-3">None.</p>
                )}
                {mismatch && (
                  <p className="mt-2 text-[11px] font-medium text-warn">⚠ Lines add up to {rm(lineSum)} but the day total is {rm(total)} — check.</p>
                )}
              </div>
            );
          })}

          {bnpl && <BnplOutstandingCard bnpl={bnpl} />}
          {d && <UnpaidCard unpaid={d.unpaid} />}
          {d && <ZeroCogsCard zero_cogs={d.zero_cogs} lines={d.zero_cogs_lines} day={day} onRecheck={load} />}
        </div>
      </OfficeShell>
    </Gate>
  );
}

// Outstanding BNPL sales (ATOME etc.) — money owed to the shop that hasn't been paid out yet. Not
// day-scoped: it carries forward until the payout lands and clears it (confirmed on the BNPL page).
function BnplOutstandingCard({ bnpl }: { bnpl: BnplOut }) {
  const items = bnpl.items ?? [];
  const groups: { name: string; items: BnplOutItem[] }[] = [];
  for (const it of items) {
    const name = it.display_name || it.provider;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(it);
    else groups.push({ name, items: [it] });
  }
  return (
    <div className="rounded-card bg-card shadow-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ink-2"><Icon name="wallet" size={16} /></span>
        <h2 className="text-sm font-semibold text-ink-2">BNPL — awaiting payout</h2>
        <Link href="/office/bnpl" className="ml-auto text-xs font-medium text-accent hover:underline">Open →</Link>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-good">All BNPL sales settled ✓</div>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-ink-3">Sales paid via a BNPL service that haven&rsquo;t been paid out yet. They carry forward until the payout lands — confirm each deposit on the BNPL page.</p>
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.name}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g.name}</div>
                <div className="divide-y divide-line rounded-lg border border-line">
                  {g.items.map((it) => (
                    <div key={it.invoice_no} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="truncate text-ink-2">{it.vehicle || '—'}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                          <span className="font-mono">{it.invoice_no}</span>
                          <span>·</span>
                          <span>{fmtDay(it.day)}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold text-ink-2">{rm(it.est_net)}</div>
                        <div className="text-[10px] text-ink-3">of {rm(it.gross)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm">
            <span className="text-ink-2">Awaiting payout</span>
            <span className="font-semibold text-warn">{rm(bnpl.total.est_net)} · {bnpl.total.count} sale{bnpl.total.count === 1 ? '' : 's'}</span>
          </div>
        </>
      )}
    </div>
  );
}
