'use client';
// PUBLIC customer tyre page (no login) — tayar.zordaq.com. Browse by size/brand, pick a tyre + qty +
// Sedan/SUV, see the ALL-IN price, submit name + phone → staff "Tyre enquiries" inbox.
// Styled to MATCH the ZORDAQ STORE (system.zordaq.com/shop): white header + light trust strip, a
// dark-navy hero (#0D1628) with a gold heading + white search, and a white content area of product-
// style cards with gold CTAs. Single, deliberate brand theme (not the staff app's tokens).
// Data is anon + retail-only; the quote is recomputed server-side on submit — customers never see
// cost/supplier/margin.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Tyre = { id: number; brand: string; pattern: string | null; origin: string | null; size: string; rim: number | null; load_speed: string | null; retail: number };
type Config = { valve_rate: number; balancing_rate: number; alignment_sedan: number; alignment_suv: number };

const QUICK_SIZES = ['185/55R15', '185/60R15', '195/55R15', '205/55R16', '215/55R17', '225/55R19'];
const roundNice = (n: number) => Math.ceil(n / 10) * 10;
const rm = (n: number) => `RM${Math.round(n).toLocaleString('en-MY')}`;
const tyreLabel = (t: Tyre) => [t.brand, t.pattern].filter(Boolean).join(' ');

// ZORDAQ STORE brand tokens (from system.zordaq.com/shop's live theme).
const GOLD = '#E9A93A';
const NAVY = '#0D1628';
const DARK = '#223440'; // text on gold / dark slate ink

export default function PublicTyrePage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cfgErr, setCfgErr] = useState(false);
  const [brands, setBrands] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [results, setResults] = useState<Tyre[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [qty, setQty] = useState(4);
  const [suv, setSuv] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ total: number; name: string } | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    (async () => {
      const [{ data: c, error: ce }, { data: b }] = await Promise.all([
        supabase.rpc('tyre_public_config'),
        supabase.rpc('tyre_public_brands'),
      ]);
      if (c) setCfg(c as Config); else setCfgErr(true);
      if (ce) setCfgErr(true);
      if (Array.isArray(b)) setBrands(b as string[]);
    })();
  }, []);

  const runSearch = useCallback(async (query: string, brandSel: string) => {
    const effective = [query.trim(), brandSel].filter(Boolean).join(' ');
    if (effective.length < 2) { ++reqId.current; setResults(null); setLoading(false); return; }
    const id = ++reqId.current;
    setLoading(true);
    const { data } = await supabase.rpc('tyre_public_search', { q: effective });
    if (id !== reqId.current) return;
    let rows = ((data ?? []) as Tyre[]).map((t) => ({ ...t, retail: Number(t.retail) }));
    if (brandSel) rows = rows.filter((t) => t.brand === brandSel);
    setResults(rows);
    setLoading(false);
  }, []);
  useEffect(() => {
    const h = setTimeout(() => runSearch(q, brand), 250);
    return () => clearTimeout(h);
  }, [q, brand, runSearch]);

  const quote = useCallback((t: Tyre) => {
    const align = suv ? (cfg?.alignment_suv ?? 0) : (cfg?.alignment_sedan ?? 0);
    const subtotal = t.retail * qty + ((cfg?.valve_rate ?? 0) + (cfg?.balancing_rate ?? 0)) * qty + align;
    return roundNice(subtotal);
  }, [qty, suv, cfg]);

  const selected = useMemo(() => results?.find((t) => t.id === sel) ?? null, [results, sel]);

  const submit = useCallback(async () => {
    if (!selected) return;
    if (name.trim().length < 2) { setErr('Please enter your name.'); return; }
    if (phone.replace(/\D/g, '').length < 8) { setErr('Please enter a valid phone number.'); return; }
    setSubmitting(true); setErr('');
    const { data, error } = await supabase.rpc('tyre_enquiry_submit', {
      p_name: name.trim(), p_phone: phone.trim(), p_tyre_id: selected.id, p_qty: qty, p_vehicle: suv ? 'suv' : 'sedan', p_car_plate: plate.trim() || null,
    });
    setSubmitting(false);
    if (error) { setErr(error.message || 'Could not send — please try again.'); return; }
    const total = (data as { quote_total?: number } | null)?.quote_total ?? quote(selected);
    setDone({ total, name: name.trim() });
  }, [selected, name, phone, plate, qty, suv, quote]);

  // Gold pill (active) vs light pill — matches the store's filter chips.
  const Pill = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-semibold transition ${on ? 'text-[#223440]' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
      style={on ? { background: GOLD } : undefined}>{children}</button>
  );
  // Same but on the dark hero (translucent when inactive).
  const PillDark = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-semibold transition ${on ? 'text-[#223440]' : 'bg-white/10 text-slate-200 ring-1 ring-white/15 hover:bg-white/20'}`}
      style={on ? { background: GOLD } : undefined}>{children}</button>
  );

  const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E9A93A] focus:outline-none focus:ring-2 focus:ring-[#E9A93A]/30';

  const Wordmark = () => (
    <div className="inline-flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg text-base font-black" style={{ background: GOLD, color: DARK }}>z</span>
      <span className="leading-none">
        <span className="block text-sm font-bold tracking-[0.2em] text-slate-900">ZORDAQ</span>
        <span className="block text-[9px] font-semibold tracking-[0.3em] text-[#C48A1E]">TYRE</span>
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#F5F6F8]" style={{ colorScheme: 'light' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Wordmark />
          <span className="text-xs font-medium text-slate-500">📍 Putrajaya workshop</span>
        </div>
      </header>

      {/* Trust strip */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-2 text-[11px] font-medium text-slate-500">
          <span>✅ Genuine tyres</span><span>🔧 Workshop fitting</span><span>📍 Pickup in Putrajaya</span>
        </div>
      </div>

      {/* Hero (dark navy) */}
      <section style={{ background: NAVY }}>
        <div className="mx-auto max-w-3xl px-4 py-7">
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: GOLD }}>Tyres</h1>
          <p className="mt-1 text-sm text-slate-300">All-in price — <span className="text-white">upah pasang, valve, balancing &amp; alignment included</span>. We WhatsApp you to confirm stock.</p>

          <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="🔍  Search your tyre size — e.g. 185/55R15"
            className="mt-4 w-full rounded-full border-0 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#E9A93A]" inputMode="text" />

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Qty</span>
              <PillDark on={qty === 4} onClick={() => setQty(4)}>Set of 4</PillDark>
              <PillDark on={qty === 2} onClick={() => setQty(2)}>2</PillDark>
              <PillDark on={qty === 1} onClick={() => setQty(1)}>1</PillDark>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Car</span>
              <PillDark on={!suv} onClick={() => setSuv(false)}>Sedan</PillDark>
              <PillDark on={suv} onClick={() => setSuv(true)}>SUV</PillDark>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-5" style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}>
        {done ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full text-3xl" style={{ background: 'rgba(233,169,58,0.15)' }}>✅</div>
            <h2 className="mt-3 text-lg font-bold text-slate-900">Thank you, {done.name}!</h2>
            <p className="mt-1 text-sm text-slate-500">Your tyre request is in. We&apos;ll WhatsApp you shortly to confirm stock and arrange fitting.</p>
            <div className="mx-auto mt-4 w-fit rounded-xl px-6 py-3 ring-1" style={{ background: 'rgba(233,169,58,0.1)', borderColor: 'rgba(233,169,58,0.3)' }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#C48A1E]">Your all-in price</div>
              <div className="text-3xl font-extrabold" style={{ color: DARK }}>{rm(done.total)}</div>
            </div>
            <button onClick={() => { setDone(null); setSel(null); setName(''); setPhone(''); setPlate(''); setQ(''); setBrand(''); setResults(null); }} className="mt-5 text-sm font-semibold text-[#C48A1E] hover:underline">Request another tyre</button>
          </div>
        ) : (
          <>
            {QUICK_SIZES.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {QUICK_SIZES.map((s) => (
                  <button key={s} type="button" onClick={() => { setQ(s); setSel(null); }} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">{s}</button>
                ))}
              </div>
            )}
            {brands.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                <Pill on={brand === ''} onClick={() => { setBrand(''); setSel(null); }}>All brands</Pill>
                {brands.map((b) => <Pill key={b} on={brand === b} onClick={() => { setBrand((c) => (c === b ? '' : b)); setSel(null); }}>{b}</Pill>)}
              </div>
            )}

            {q.trim().length < 2 && !brand && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-10 text-center text-sm text-slate-500">Type your tyre size (on the tyre wall, e.g. 185/55R15) or pick a brand to see prices.</div>
            )}
            {loading && <div className="py-6 text-center text-sm text-slate-500">Searching…</div>}
            {cfgErr && <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Couldn&apos;t load prices right now — please WhatsApp us directly.</div>}
            {!loading && results !== null && !cfg && !cfgErr && <div className="py-6 text-center text-sm text-slate-500">Getting prices…</div>}

            {!loading && results !== null && cfg && (
              <>
                {results.length > 0 && <div className="mb-2 text-xs text-slate-500">{results.length} tyre{results.length !== 1 ? 's' : ''} · cheapest first · all-in for {qty === 4 ? 'a set of 4' : `${qty} pc${qty > 1 ? 's' : ''}`}</div>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {results.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">No match — try just the numbers, e.g. 205 55 16.</div>}
                  {results.map((t) => {
                    const open = sel === t.id;
                    return (
                      <div key={t.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${open ? 'border-[#E9A93A] sm:col-span-2' : 'border-slate-200'}`}>
                        <div className="flex items-start gap-3 p-3">
                          {/* tyre glyph (echoes the store's product image) */}
                          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-50">
                            <svg viewBox="0 0 48 48" className="h-11 w-11 text-slate-300"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="4" /><circle cx="24" cy="24" r="7.5" fill="none" stroke="currentColor" strokeWidth="4" /></svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t.brand}</div>
                            <div className="truncate text-sm font-bold text-slate-900">{tyreLabel(t)}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{t.size}{t.origin ? ` · ${t.origin}` : ''}</div>
                            <div className="mt-1.5 flex items-baseline justify-between">
                              <span className="text-lg font-extrabold" style={{ color: DARK }}>{rm(quote(t))}</span>
                              <span className="text-[11px] text-slate-400">all-in</span>
                            </div>
                          </div>
                        </div>
                        {!open ? (
                          <button type="button" onClick={() => { setSel(t.id); setErr(''); }} className="block w-full px-3 pb-3">
                            <span className="block rounded-lg py-2 text-center text-sm font-bold text-[#223440]" style={{ background: GOLD }}>Request this price</span>
                          </button>
                        ) : (
                          <div className="border-t border-slate-100 p-3">
                            <div className="mb-3 rounded-lg px-3 py-2 text-xs ring-1" style={{ background: 'rgba(233,169,58,0.08)', borderColor: 'rgba(233,169,58,0.25)', color: '#8a6212' }}>
                              <span className="font-semibold">Included:</span> ✅ {qty === 4 ? '4 tyres' : qty === 2 ? '2 tyres' : '1 tyre'} · ✅ Upah pasang · ✅ Valve · ✅ Balancing · ✅ Alignment
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name *" className={field} />
                              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (WhatsApp) *" inputMode="tel" className={field} />
                              <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Car plate (optional)" className={`${field} font-mono uppercase sm:col-span-2`} />
                            </div>
                            {err && <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{err}</div>}
                            <div className="mt-3 flex gap-2">
                              <button onClick={submit} disabled={submitting} className="flex-1 rounded-lg py-2.5 text-sm font-bold text-[#223440] transition hover:brightness-105 disabled:opacity-50" style={{ background: GOLD }}>
                                {submitting ? 'Sending…' : `Send request · ${rm(quote(t))}`}
                              </button>
                              <button type="button" onClick={() => { setSel(null); setErr(''); }} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Back</button>
                            </div>
                            <p className="mt-2 text-[11px] text-slate-400">We&apos;ll WhatsApp you to confirm stock &amp; fitting time. No payment now.</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        <p className="mt-8 text-center text-[11px] text-slate-400">ZORDAQ Auto Services · Putrajaya · prices include fitting, valve, balancing &amp; alignment</p>
      </main>
    </div>
  );
}
