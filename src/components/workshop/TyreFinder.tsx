'use client';
// Staff tyre lookup + all-in quote builder. A customer WhatsApps "berapa harga tyre 225/55R19?" —
// staff type the size, get every brand carried (cheapest first, with OUR retail), tap one, and get a
// ready-to-send out-the-door quote: tyre + upah pasang (included) + valve + balancing + alignment,
// rounded, in the owner's WhatsApp format. Prices come from tyre_search(); rates from tyre_config_get().
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Tyre = {
  brand: string; pattern: string | null; origin: string | null; size: string;
  rim: number | null; load_speed: string | null; retail: number; dealer: string;
};
type Config = { valve_rate: number; balancing_rate: number; alignment_sedan: number; alignment_suv: number };

// Popular Malaysian sizes — one tap instead of typing (Myvi, Saga, City, Civic, X50/X70…).
const QUICK_SIZES = ['185/55R15', '185/60R15', '195/55R15', '205/55R16', '215/55R17', '225/55R19'];

// Round an all-in price UP to the next RM10 so the quote is always a clean, never-undercharged number.
// (Owner's benchmark: Kumho HP71 225/55R19 set = 1974 → RM1,980.)
const roundNice = (n: number) => Math.ceil(n / 10) * 10;
const rm = (n: number) => `RM${Math.round(n).toLocaleString('en-MY')}`;
const tyreLabel = (t: Tyre) => [t.brand, t.pattern].filter(Boolean).join(' ');

export default function TyreFinder() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Tyre[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<string | null>(null); // key of the expanded tyre

  // quote controls (shared across the currently-open tyre)
  const [qty, setQty] = useState(4);
  const [suv, setSuv] = useState(false);
  const [valve, setValve] = useState(true);
  const [balancing, setBalancing] = useState(true);
  const [alignment, setAlignment] = useState(true);
  const [copied, setCopied] = useState(false);

  const reqId = useRef(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('tyre_config_get');
      if (data) setCfg(data as Config);
    })();
  }, []);

  // Debounced search — the RPC matches size tokens on digits only (so "225/55R19", "225 55 19",
  // "225/55 r19" all hit) and brand/pattern/origin words, cheapest first.
  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults(null); setLoading(false); return; }
    const id = ++reqId.current;
    setLoading(true);
    const { data } = await supabase.rpc('tyre_search', { q: trimmed });
    if (id !== reqId.current) return; // a newer search superseded this one
    setResults(((data ?? []) as Tyre[]).map((t) => ({ ...t, retail: Number(t.retail) })));
    setLoading(false);
  }, []);
  useEffect(() => {
    const h = setTimeout(() => runSearch(q), 250);
    return () => clearTimeout(h);
  }, [q, runSearch]);

  const key = (t: Tyre, i: number) => `${t.brand}|${t.pattern}|${t.size}|${t.retail}|${i}`;

  const quote = useCallback((t: Tyre) => {
    const tyre = t.retail * qty;
    const valveAmt = valve ? (cfg?.valve_rate ?? 0) * qty : 0;
    const balAmt = balancing ? (cfg?.balancing_rate ?? 0) * qty : 0;
    const alignAmt = alignment ? (suv ? (cfg?.alignment_suv ?? 0) : (cfg?.alignment_sedan ?? 0)) : 0;
    const subtotal = tyre + valveAmt + balAmt + alignAmt;
    return { tyre, valveAmt, balAmt, alignAmt, subtotal, total: roundNice(subtotal) };
  }, [qty, suv, valve, balancing, alignment, cfg]);

  // The customer-facing WhatsApp quote — the owner's format: tyre + size, a checklist of what's
  // included, and one all-in price. Upah pasang (fitting) is always included in the tyre price.
  const buildMsg = useCallback((t: Tyre) => {
    const { total } = quote(t);
    const setWord = qty === 4 ? 'set of 4' : qty === 2 ? '2 pcs' : '1 pc';
    const head = `*${tyreLabel(t)}* (${setWord})`;
    const spec = [t.size, suv ? 'SUV' : null, t.origin].filter(Boolean).join(' · ');
    const items = ['✅ Upah pasang'];
    if (valve) items.push('✅ Valve');
    if (balancing) items.push('✅ Balancing');
    if (alignment) items.push('✅ Alignment');
    return `${head}\n${spec}\n\n${items.join('\n')}\n\nHarga all-in: *${rm(total)}*\n_ZORDAQ Auto Services_`;
  }, [quote, qty, suv, valve, balancing, alignment]);

  const sendWhatsApp = useCallback((t: Tyre) => {
    const msg = buildMsg(t);
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) nav.share({ text: msg }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }, [buildMsg]);

  const copyMsg = useCallback(async (t: Tyre) => {
    try { await navigator.clipboard.writeText(buildMsg(t)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }, [buildMsg]);

  const QtyBtn = ({ n, label }: { n: number; label: string }) => (
    <button type="button" onClick={() => setQty(n)}
      className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${qty === n ? 'bg-btn text-btn-ink' : 'bg-card text-ink-2 ring-1 ring-line hover:bg-ink/5'}`}>{label}</button>
  );
  const Toggle = ({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) => (
    <label className="flex items-center gap-1.5 text-sm text-ink-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-emerald-600" />{children}
    </label>
  );

  return (
    <div>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setSel(null); }}
        placeholder="Search tyre size — e.g. 225/55R19, 185/55 R15, Kumho…"
        inputMode="text"
        className="mb-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_SIZES.map((s) => (
          <button key={s} type="button" onClick={() => { setQ(s); setSel(null); }}
            className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-ink-2 ring-1 ring-line hover:bg-ink/5">{s}</button>
        ))}
      </div>

      {q.trim().length < 2 && (
        <div className="rounded-xl border border-dashed border-line bg-card px-3 py-8 text-center text-sm text-ink-3">
          Type a tyre size (or tap one above) to see every brand we carry, cheapest first — then tap one for an all-in quote.
        </div>
      )}

      {loading && <div className="py-6 text-sm text-ink-3">Searching…</div>}

      {!loading && results !== null && (
        <>
          <div className="mb-2 text-xs text-ink-3">{results.length} tyre{results.length !== 1 ? 's' : ''} — cheapest first · tap for an all-in quote</div>
          <div className="divide-y divide-line rounded-xl border border-line bg-card">
            {results.length === 0 && <div className="px-3 py-6 text-center text-sm text-ink-3">No tyre matches — try just the size digits (e.g. 205 55 16).</div>}
            {results.map((t, i) => {
              const k = key(t, i);
              const open = sel === k;
              const Q = quote(t);
              return (
                <div key={k}>
                  <button type="button" onClick={() => setSel(open ? null : k)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-ink/5">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-ink-2">{tyreLabel(t)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="rounded bg-ink/5 px-1.5 py-0.5 font-medium text-ink-2">{t.size}</span>
                        {t.origin && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-2">{t.origin}</span>}
                        {t.load_speed && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-2">{t.load_speed}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-ink">{rm(t.retail)}<span className="text-xs font-normal text-ink-3">/pc</span></div>
                      <div className="text-[11px] text-ink-3">set of 4 ≈ {rm(quote(t).total)}</div>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-line bg-ink/[0.02] px-3 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Qty</span>
                          <QtyBtn n={4} label="Set of 4" /><QtyBtn n={2} label="2" /><QtyBtn n={1} label="1" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Car</span>
                          <button type="button" onClick={() => setSuv(false)} className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${!suv ? 'bg-btn text-btn-ink' : 'bg-card text-ink-2 ring-1 ring-line hover:bg-ink/5'}`}>Sedan</button>
                          <button type="button" onClick={() => setSuv(true)} className={`rounded-lg px-3 py-1 text-sm font-semibold transition ${suv ? 'bg-btn text-btn-ink' : 'bg-card text-ink-2 ring-1 ring-line hover:bg-ink/5'}`}>SUV</button>
                        </div>
                      </div>
                      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                        <Toggle on={valve} set={setValve}>Valve</Toggle>
                        <Toggle on={balancing} set={setBalancing}>Balancing</Toggle>
                        <Toggle on={alignment} set={setAlignment}>Alignment</Toggle>
                      </div>

                      {/* breakdown so staff see how the number is built */}
                      <div className="mb-3 space-y-0.5 rounded-lg bg-card p-2.5 text-xs text-ink-2 ring-1 ring-line">
                        <div className="flex justify-between"><span>Tyre {rm(t.retail)} × {qty} <span className="text-ink-3">(upah pasang incl.)</span></span><span className="tabular-nums">{rm(Q.tyre)}</span></div>
                        {valve && <div className="flex justify-between"><span>Valve {rm(cfg?.valve_rate ?? 0)} × {qty}</span><span className="tabular-nums">{rm(Q.valveAmt)}</span></div>}
                        {balancing && <div className="flex justify-between"><span>Balancing {rm(cfg?.balancing_rate ?? 0)} × {qty}</span><span className="tabular-nums">{rm(Q.balAmt)}</span></div>}
                        {alignment && <div className="flex justify-between"><span>Alignment ({suv ? 'SUV' : 'sedan'})</span><span className="tabular-nums">{rm(Q.alignAmt)}</span></div>}
                        <div className="mt-1 flex justify-between border-t border-line pt-1 text-sm font-semibold text-ink"><span>All-in</span><span className="tabular-nums">{rm(Q.total)}</span></div>
                      </div>

                      <div className="flex gap-2">
                        <button type="button" onClick={() => sendWhatsApp(t)} className="flex-1 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">Send quote on WhatsApp</button>
                        <button type="button" onClick={() => copyMsg(t)} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-2 hover:bg-ink/5">{copied ? 'Copied ✓' : 'Copy'}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
