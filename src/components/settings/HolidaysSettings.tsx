'use client';
// Settings → Holidays. Owner manages the yearly public-holiday list (Putrajaya / Federal Territory).
// Attendance auto-marks these days as PH for tracked staff (paid, no leave spent).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Holiday = { id: string; holiday_date: string; name: string; is_substitute: boolean; is_compulsory: boolean; handling: string; swap_to_date: string | null };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Parse 'YYYY-MM-DD' as a local date (avoid UTC shift) and format "Mon 31 Aug".
function parseD(iso: string) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtD(iso: string) { const dt = parseD(iso); return `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`; }

export default function HolidaysSettings() {
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [newCompulsory, setNewCompulsory] = useState(false);
  const [swapId, setSwapId] = useState<string | null>(null); // row currently choosing a swap-to date

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('public_holidays')
      .select('id,holiday_date,name,is_substitute,is_compulsory,handling,swap_to_date')
      .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
      .order('holiday_date', { ascending: true }).order('name', { ascending: true });
    setRows((data ?? []) as Holiday[]);
    setLoading(false);
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    if (error) setMsg({ kind: 'err', text: error.message });
    else { setMsg({ kind: 'ok', text: ok }); await load(); }
    setBusy(false);
  };

  const add = () => {
    if (!newDate || !newName.trim()) { setMsg({ kind: 'err', text: 'Enter a date and a name.' }); return; }
    run(() => supabase.rpc('add_holiday', { p_date: newDate, p_name: newName.trim(), p_compulsory: newCompulsory }), 'Holiday added ✓')
      .then(() => { setNewDate(''); setNewName(''); setNewCompulsory(false); });
  };
  const remove = (h: Holiday) => {
    if (!window.confirm(`Remove "${h.name}" on ${fmtD(h.holiday_date)}?`)) return;
    run(() => supabase.rpc('remove_holiday', { p_id: h.id }), 'Removed ✓');
  };
  const prefill = () => run(() => supabase.rpc('prefill_fixed_holidays', { p_year: year }), 'Fixed dates added ✓');
  const substitutes = () => run(() => supabase.rpc('add_sunday_substitutes', { p_year: year }), 'Substitute days regenerated ✓');
  const setHandling = (h: Holiday, handling: string, swap: string | null) =>
    run(() => supabase.rpc('set_holiday_handling', { p_id: h.id, p_handling: handling, p_swap_to: swap }),
      handling === 'open' ? 'Set to Open — staff who work it get extra pay ✓' : handling === 'swap' ? 'Holiday swapped ✓' : 'Set to Close ✓')
      .then(() => setSwapId(null));
  const onHandling = (h: Holiday, v: string) => { if (v === 'swap') { setSwapId(h.id); return; } setHandling(h, v, null); };

  return (
    <div className="max-w-2xl">
      <div className="mb-4 rounded-card bg-card shadow-card p-4">
        <div className="text-sm font-medium text-ink-2">How public holidays work</div>
        <p className="mt-1 text-xs text-ink-3">
          These dates are auto-marked as <b>PH</b> on the attendance record for every tracked staff member — a paid day,
          no leave spent. Fixed dates (New Year, FT Day, Labour Day, Merdeka, Malaysia Day, Christmas) repeat every year;
          the moving ones (Raya, CNY, Deepavali, Thaipusam, Wesak, Agong) are gazetted yearly and loaded once. If a holiday
          falls on a Sunday, a substitute weekday is added automatically. The 5 <b>★ Compulsory</b> holidays (Merdeka,
          Agong&rsquo;s Birthday, Federal Territory Day, Labour Day, Malaysia Day) cannot be swapped for another day.
          For each day pick <b>Close</b> (paid, no work), <b>Open</b> (staff who work it get the extra public-holiday pay,
          added automatically at payroll), or <b>Swap</b> it to another date.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setYear((y) => y - 1)} className="rounded-md border border-line px-2 py-1 text-sm text-ink-2 hover:bg-ink/5">‹</button>
        <span className="min-w-[64px] text-center text-sm font-semibold text-ink tabular-nums">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} className="rounded-md border border-line px-2 py-1 text-sm text-ink-2 hover:bg-ink/5">›</button>
        <span className="ml-2 text-xs text-ink-3">{rows.length} holiday{rows.length === 1 ? '' : 's'}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={prefill} disabled={busy} className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-ink/5 disabled:opacity-50">Prefill fixed dates</button>
          <button onClick={substitutes} disabled={busy} className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-ink/5 disabled:opacity-50">Regenerate substitutes</button>
        </div>
      </div>

      {msg && <div className={`mb-3 rounded-md border border-line p-2 text-sm ${msg.kind === 'ok' ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{msg.text}</div>}

      <div className="rounded-card bg-card shadow-card divide-y divide-line">
        {loading ? (
          <div className="p-4 text-sm text-ink-3">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-ink-3">No holidays for {year}. Use “Prefill fixed dates”, then add the gazetted moving dates.</div>
        ) : rows.map((h) => {
          const sunday = parseD(h.holiday_date).getDay() === 0;
          const showSwap = h.handling === 'swap' || swapId === h.id;
          return (
            <div key={h.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink">
                    <span className="tabular-nums text-ink-2">{fmtD(h.holiday_date)}</span>
                    <span className="mx-2 text-ink-3">·</span>
                    {h.name}
                    {h.is_compulsory && <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink">★ Compulsory</span>}
                    {h.is_substitute && <span className="ml-2 rounded-full bg-accent-weak px-2 py-0.5 text-[10px] font-medium text-accent">substitute</span>}
                    {sunday && !h.is_substitute && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-medium text-warn">Sunday → shifted</span>}
                  </div>
                </div>
                <button onClick={() => remove(h)} disabled={busy} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-50">Remove</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-3">On this day:</span>
                <select value={swapId === h.id ? 'swap' : h.handling} disabled={busy}
                  onChange={(e) => onHandling(h, e.target.value)}
                  className="rounded-md border border-line px-2 py-1 text-xs">
                  <option value="close">Close · paid, no work</option>
                  <option value="open">Open · pay extra</option>
                  <option value="swap" disabled={h.is_compulsory}>Swap to another day…{h.is_compulsory ? ' (not allowed)' : ''}</option>
                </select>
                {showSwap && (
                  <input type="date" defaultValue={h.swap_to_date ?? ''} disabled={busy}
                    onChange={(e) => { if (e.target.value) setHandling(h, 'swap', e.target.value); }}
                    className="rounded-md border border-line px-2 py-1 text-xs" />
                )}
                {h.handling === 'open' && swapId !== h.id && <span className="text-[11px] font-medium text-good">staff who work get extra pay</span>}
                {h.handling === 'swap' && h.swap_to_date && swapId !== h.id && <span className="text-[11px] font-medium text-accent">→ moved to {fmtD(h.swap_to_date)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-card bg-card shadow-card p-4">
        <div className="text-sm font-medium text-ink">Add a holiday</div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-2">Date
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-0.5 block rounded-md border border-line px-2 py-1.5 text-sm" />
          </label>
          <label className="min-w-[180px] flex-1 text-xs text-ink-2">Name
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Hari Raya Aidilfitri" className="mt-0.5 block w-full rounded-md border border-line px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-2" title="One of the 5 holidays that can't be swapped for another day">
            <input type="checkbox" checked={newCompulsory} onChange={(e) => setNewCompulsory(e.target.checked)} className="h-4 w-4 rounded border-line" />
            Compulsory
          </label>
          <button onClick={add} disabled={busy} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Add</button>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">Adding or removing a holiday re-marks that day on the attendance record automatically.</p>
      </div>
    </div>
  );
}
