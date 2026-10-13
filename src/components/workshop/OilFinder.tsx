'use client';
// Staff oil lookup — answer a customer's WhatsApp ("got 5W-30 4L?") by viscosity + capacity + type
// and see what's in stock, what's an order item, and the price. Reads live Niagawan stock/price via
// oil_list(). Viscosity + type are normalized/heuristic; staff can correct type + size inline.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Oil = { sku: string; name: string; oil_type: string; capacity: string | null; viscosity: string | null; price: number; stock: number; tracked: boolean };
const TYPES = [
  { key: 'mineral', label: 'Mineral' },
  { key: 'semi', label: 'Semi' },
  { key: 'fully', label: 'Fully' },
  { key: 'diesel', label: 'Diesel' },
  { key: 'other', label: 'Other' },
];
const TYPE_LABEL: Record<string, string> = { mineral: 'Mineral', semi: 'Semi', fully: 'Fully', diesel: 'Diesel', other: 'Other' };
const TYPE_CLASS: Record<string, string> = {
  mineral: 'bg-warn-soft text-warn', semi: 'bg-accent-weak text-accent',
  fully: 'bg-good-soft text-good', diesel: 'bg-ink/5 text-ink-2', other: 'bg-ink/5 text-ink-2',
};
const CAP_ORDER = ['1L', '3L', '3.5L', '4L', '5L', '7L', '20L'];

// Sort viscosities like 0W-20, 5W-30, 10W-40, 20W-50 numerically (first grade, then second).
const viscKey = (v: string): number => { const m = v.match(/^(\d+)W-?(\d+)$/i); return m ? Number(m[1]) * 100 + Number(m[2]) : 9999; };
// Hyphen/space/case-insensitive so a staff typing "5w30" matches a catalogue "5W-30" and vice versa.
const norm = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-1 text-sm font-medium transition ${on ? 'bg-btn text-btn-ink' : 'bg-card text-ink-2 ring-1 ring-line hover:bg-ink/5'}`}
  >
    {children}
  </button>
);

export default function OilFinder() {
  const [oils, setOils] = useState<Oil[] | null>(null);
  const [visc, setVisc] = useState('');
  const [type, setType] = useState('');
  const [cap, setCap] = useState('');
  const [q, setQ] = useState('');
  const [hideOut, setHideOut] = useState(true); // hide only sold-out tracked oils; in-stock + order items always show
  const [edit, setEdit] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('oil_list');
    setOils((data ?? []).map((o: Oil) => ({ ...o, price: Number(o.price), stock: Number(o.stock), tracked: !!o.tracked })) as Oil[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const viscs = useMemo(() => {
    const s = new Set((oils ?? []).map((o) => o.viscosity).filter(Boolean) as string[]);
    return [...s].sort((a, b) => viscKey(a) - viscKey(b));
  }, [oils]);

  const caps = useMemo(() => {
    const s = new Set((oils ?? []).map((o) => o.capacity).filter(Boolean) as string[]);
    return CAP_ORDER.filter((c) => s.has(c)).concat([...s].filter((c) => !CAP_ORDER.includes(c)));
  }, [oils]);

  const filtered = useMemo(() => (oils ?? []).filter((o) =>
    (!visc || o.viscosity === visc) &&
    (!type || o.oil_type === type) &&
    (!cap || o.capacity === cap) &&
    (!hideOut || !o.tracked || o.stock > 0) &&
    (!q || norm(o.name).includes(norm(q)))
  ), [oils, visc, type, cap, hideOut, q]);

  const nInStock = useMemo(() => filtered.filter((o) => o.tracked && o.stock > 0).length, [filtered]);
  const nOrder = useMemo(() => filtered.filter((o) => !o.tracked).length, [filtered]);

  const changeType = useCallback(async (sku: string, newType: string) => {
    setOils((prev) => prev?.map((o) => (o.sku === sku ? { ...o, oil_type: newType } : o)) ?? null);
    await supabase.rpc('set_oil_type', { p_sku: sku, p_type: newType }); // capacity omitted -> preserved
  }, []);
  const changeCap = useCallback(async (sku: string, newCap: string, curType: string) => {
    if (!newCap) return;
    setOils((prev) => prev?.map((o) => (o.sku === sku ? { ...o, capacity: newCap } : o)) ?? null);
    await supabase.rpc('set_oil_type', { p_sku: sku, p_type: curType, p_capacity: newCap });
  }, []);

  if (oils === null) return <div className="py-6 text-sm text-ink-3">Loading oils…</div>;

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search — brand, viscosity (e.g. Gulf, 5W30)…"
        className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
      />

      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Viscosity</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={visc === ''} onClick={() => setVisc('')}>Any</Chip>
        {viscs.map((v) => <Chip key={v} on={visc === v} onClick={() => setVisc(v)}>{v}</Chip>)}
      </div>

      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Capacity</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={cap === ''} onClick={() => setCap('')}>Any</Chip>
        {caps.map((c) => <Chip key={c} on={cap === c} onClick={() => setCap(c)}>{c}</Chip>)}
      </div>

      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Type</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={type === ''} onClick={() => setType('')}>Any</Chip>
        {TYPES.map((t) => <Chip key={t.key} on={type === t.key} onClick={() => setType(t.key)}>{t.label}</Chip>)}
      </div>

      <div className="mb-3 flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          Hide sold-out
        </label>
        <button onClick={() => setEdit((v) => !v)} className="text-xs text-ink-3 hover:text-ink-2">{edit ? 'Done fixing' : 'Fix type / size ✎'}</button>
      </div>

      <div className="mb-2 text-xs text-ink-3">{filtered.length} oil{filtered.length !== 1 ? 's' : ''} · {nInStock} in stock{nOrder ? ` · ${nOrder} order item${nOrder !== 1 ? 's' : ''}` : ''}</div>

      <div className="divide-y divide-line rounded-xl border border-line bg-card">
        {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-ink-3">No oils match — try widening the filters.</div>}
        {filtered.map((o) => (
          <div key={o.sku} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink-2" title={o.name}>{o.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                {o.viscosity && <span className="rounded bg-ink/5 px-1.5 py-0.5 font-medium text-ink-2">{o.viscosity}</span>}
                <span className={`rounded px-1.5 py-0.5 font-medium ${TYPE_CLASS[o.oil_type] ?? TYPE_CLASS.other}`}>{TYPE_LABEL[o.oil_type] ?? o.oil_type}</span>
                {o.capacity && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-2">{o.capacity}</span>}
                {!o.tracked
                  ? <span className="rounded bg-accent-weak px-1.5 py-0.5 font-medium text-accent" title="We carry it — stock isn't counted in Niagawan; order from the supplier">order item</span>
                  : o.stock > 0
                    ? <span className="text-good">{o.stock} in stock</span>
                    : <span className="text-ink-3">sold out</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-ink">RM {o.price.toLocaleString('en-MY')}</div>
              {edit && (
                <div className="mt-1 flex items-center justify-end gap-1">
                  <select value={o.oil_type} onChange={(e) => changeType(o.sku, e.target.value)} className="rounded border border-line px-1 py-0.5 text-xs">
                    {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <select value={CAP_ORDER.includes(o.capacity ?? '') ? (o.capacity ?? '') : ''} onChange={(e) => changeCap(o.sku, e.target.value, o.oil_type)} title="Set size" className="rounded border border-line px-1 py-0.5 text-xs">
                    <option value="">size?</option>
                    {CAP_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
