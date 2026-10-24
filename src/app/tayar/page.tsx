'use client';
// PUBLIC customer tyre page (no login) — reached by a shareable link / tayar.zordaq.com. Browse by
// size/brand, pick a tyre + qty + Sedan/SUV, see the ALL-IN price, submit name + phone → staff inbox.
// Styled to match the ZORDAQ STORE brand (dark navy #0D1628 + gold #E9A93A, Inter, "ZORDAQ" wordmark)
// so shop.zordaq.com and tayar.zordaq.com feel like one shop. Deliberately a single dark theme (not the
// staff app's light tokens) — this is a customer-facing branded page. Data is anon + retail-only; the
// quote is recomputed server-side on submit, so customers never see cost/supplier/margin.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Tyre = { id: number; brand: string; pattern: string | null; origin: string | null; size: string; rim: number | null; load_speed: string | null; retail: number };
type Config = { valve_rate: number; balancing_rate: number; alignment_sedan: number; alignment_suv: number };

const QUICK_SIZES = ['185/55R15', '185/60R15', '195/55R15', '205/55R16', '215/55R17', '225/55R19'];
const roundNice = (n: number) => Math.ceil(n / 10) * 10;
const rm = (n: number) => `RM${Math.round(n).toLocaleString('en-MY')}`;
const tyreLabel = (t: Tyre) => [t.brand, t.pattern].filter(Boolean).join(' ');

// ZORDAQ STORE brand tokens (from shop.zordaq.com's live theme).
const GOLD = '#E9A93A';
const NAVY = '#0D1628';

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

  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm font-semibold transition ${on ? 'bg-[#E9A93A] text-[#0D1628]' : 'bg-white/5 text-slate-300 ring-1 ring-white/10 hover:bg-white/10'}`}>{children}</button>
  );

  const inputCls = 'rounded-lg border border-white/10 bg-[#0b1324] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-[#E9A93A]/60 focus:outline-none';

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: NAVY, colorScheme: 'dark' }}>
      <div className="mx-auto max-w-xl px-4 py-6" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'calc(1.25rem + env(safe-area-inset-top))' }}>
        <header className="mb-5 text-center">
          <div className="mb-3 inline-flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg text-lg font-black text-[#0D1628]" style={{ background: GOLD }}>z</span>
            <span className="text-left leading-none">
              <span className="block text-[15px] font-bold tracking-[0.2em] text-white">ZORDAQ</span>
              <span className="block text-[10px] font-semibold tracking-[0.3em] text-[#F0BB53]">TYRE</span>
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Tyre price — all-in</h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">Pilih tayar anda, dapatkan harga termasuk upah pasang, valve, balancing &amp; alignment. Kami WhatsApp anda untuk sahkan stok.</p>
        </header>

        {done ? (
          <div className="rounded-xl border border-white/10 bg-[#17213b] p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full text-3xl" style={{ background: 'rgba(233,169,58,0.15)' }}>✅</div>
            <h2 className="mt-3 text-lg font-semibold text-white">Thank you, {done.name}!</h2>
            <p className="mt-1 text-sm text-slate-400">Your tyre request is in. We&apos;ll WhatsApp you shortly to confirm stock and arrange fitting.</p>
            <div className="mx-auto mt-4 w-fit rounded-xl px-6 py-3 ring-1" style={{ background: 'rgba(233,169,58,0.1)', borderColor: 'rgba(233,169,58,0.25)' }}>
              <div className="text-xs font-medium uppercase tracking-wide text-[#F0BB53]">Your all-in price</div>
              <div className="text-3xl font-bold" style={{ color: GOLD }}>{rm(done.total)}</div>
            </div>
            <button onClick={() => { setDone(null); setSel(null); setName(''); setPhone(''); setPlate(''); setQ(''); setBrand(''); setResults(null); }} className="mt-5 text-sm text-[#F0BB53] hover:underline">Request another tyre</button>
          </div>
        ) : (
          <>
            {/* qty + vehicle */}
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/10 bg-[#17213b] p-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">How many</span>
                <Chip on={qty === 4} onClick={() => setQty(4)}>Set of 4</Chip>
                <Chip on={qty === 2} onClick={() => setQty(2)}>2</Chip>
                <Chip on={qty === 1} onClick={() => setQty(1)}>1</Chip>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Car</span>
                <Chip on={!suv} onClick={() => setSuv(false)}>Sedan</Chip>
                <Chip on={suv} onClick={() => setSuv(true)}>SUV</Chip>
              </div>
            </div>

            <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Search your tyre size — e.g. 185/55R15"
              className={`mb-2 w-full ${inputCls}`} inputMode="text" />
            <div className="mb-3 flex flex-wrap gap-1.5">
              {QUICK_SIZES.map((s) => (
                <button key={s} type="button" onClick={() => { setQ(s); setSel(null); }} className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-white/10">{s}</button>
              ))}
            </div>
            {brands.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <Chip on={brand === ''} onClick={() => { setBrand(''); setSel(null); }}>All brands</Chip>
                {brands.map((b) => <Chip key={b} on={brand === b} onClick={() => { setBrand((c) => (c === b ? '' : b)); setSel(null); }}>{b}</Chip>)}
              </div>
            )}

            {q.trim().length < 2 && !brand && (
              <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-8 text-center text-sm text-slate-400">Type your tyre size (on the tyre wall, e.g. 185/55R15) or pick a brand to see prices.</div>
            )}
            {loading && <div className="py-6 text-center text-sm text-slate-400">Searching…</div>}
            {cfgErr && <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">Couldn&apos;t load prices right now — please WhatsApp us directly.</div>}
            {!loading && results !== null && !cfg && !cfgErr && <div className="py-6 text-center text-sm text-slate-400">Getting prices…</div>}

            {!loading && results !== null && cfg && (
              <div className="space-y-2">
                {results.length === 0 && <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-6 text-center text-sm text-slate-400">No match — try just the numbers, e.g. 205 55 16.</div>}
                {results.map((t) => {
                  const open = sel === t.id;
                  return (
                    <div key={t.id} className={`rounded-xl border bg-[#17213b] ${open ? 'border-[#E9A93A]/60' : 'border-white/10'}`}>
                      <button type="button" onClick={() => { setSel(open ? null : t.id); setErr(''); }} className="flex w-full items-center justify-between gap-3 p-3 text-left">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">{tyreLabel(t)}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded bg-white/5 px-1.5 py-0.5 font-medium text-slate-300">{t.size}</span>
                            {t.origin && <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400">{t.origin}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-bold" style={{ color: GOLD }}>{rm(quote(t))}</div>
                          <div className="text-[11px] text-slate-500">all-in · {qty === 4 ? 'set of 4' : `${qty} pc${qty > 1 ? 's' : ''}`}</div>
                        </div>
                      </button>

                      {open && (
                        <div className="border-t border-white/10 p-3">
                          <div className="mb-3 rounded-lg px-3 py-2 text-xs ring-1" style={{ background: 'rgba(233,169,58,0.08)', borderColor: 'rgba(233,169,58,0.2)', color: '#F0BB53' }}>
                            <div className="font-semibold">Included in {rm(quote(t))}:</div>
                            <div className="mt-0.5">✅ {qty === 4 ? '4 tyres' : qty === 2 ? '2 tyres' : '1 tyre'} &nbsp; ✅ Upah pasang &nbsp; ✅ Valve &nbsp; ✅ Balancing &nbsp; ✅ Alignment</div>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name *" className={inputCls} />
                            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (WhatsApp) *" inputMode="tel" className={inputCls} />
                            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Car plate (optional)" className={`${inputCls} font-mono uppercase sm:col-span-2`} />
                          </div>
                          {err && <div className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-300">{err}</div>}
                          <button onClick={submit} disabled={submitting} className="mt-3 w-full rounded-lg px-3 py-2.5 text-sm font-semibold text-[#0D1628] transition hover:brightness-105 disabled:opacity-50" style={{ background: GOLD }}>
                            {submitting ? 'Sending…' : `Request this price (${rm(quote(t))})`}
                          </button>
                          <p className="mt-2 text-[11px] text-slate-500">We&apos;ll WhatsApp you to confirm stock &amp; fitting time. No payment now.</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <p className="mt-6 text-center text-[11px] text-slate-500">ZORDAQ Auto Services · Putrajaya · prices include fitting, valve, balancing &amp; alignment</p>
      </div>
    </div>
  );
}
