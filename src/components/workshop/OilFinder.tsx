'use client';
// Staff oil lookup — pick capacity + type (for a customer's WhatsApp) and see what's in stock + price.
// Reads live Niagawan stock/price via oil_list(); types are a heuristic that staff can correct inline.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Oil = { sku: string; name: string; oil_type: string; capacity: string | null; price: number; stock: number };
const TYPES = [
  { key: 'mineral', label: 'Mineral' },
  { key: 'semi', label: 'Semi' },
  { key: 'fully', label: 'Fully' },
  { key: 'diesel', label: 'Diesel' },
  { key: 'other', label: 'Other' },
];
const TYPE_LABEL: Record<string, string> = { mineral: 'Mineral', semi: 'Semi', fully: 'Fully', diesel: 'Diesel', other: 'Other' };
const TYPE_CLASS: Record<string, string> = {
  mineral: 'bg-amber-50 text-amber-700', semi: 'bg-blue-50 text-blue-700',
  fully: 'bg-emerald-50 text-emerald-700', diesel: 'bg-slate-100 text-slate-600', other: 'bg-gray-100 text-gray-500',
};
const CAP_ORDER = ['1L', '3L', '3.5L', '4L', '5L', '7L', '20L'];

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-1 text-sm font-medium transition ${on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
  >
    {children}
  </button>
);

export default function OilFinder() {
  const [oils, setOils] = useState<Oil[] | null>(null);
  const [type, setType] = useState('');
  const [cap, setCap] = useState('');
  const [q, setQ] = useState('');
  const [inStock, setInStock] = useState(true);
  const [edit, setEdit] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('oil_list');
    setOils((data ?? []).map((o: Oil) => ({ ...o, price: Number(o.price), stock: Number(o.stock) })) as Oil[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const caps = useMemo(() => {
    const s = new Set((oils ?? []).map((o) => o.capacity).filter(Boolean) as string[]);
    return CAP_ORDER.filter((c) => s.has(c)).concat([...s].filter((c) => !CAP_ORDER.includes(c)));
  }, [oils]);

  const filtered = useMemo(() => (oils ?? []).filter((o) =>
    (!type || o.oil_type === type) &&
    (!cap || o.capacity === cap) &&
    (!inStock || o.stock > 0) &&
    (!q || o.name.toLowerCase().includes(q.toLowerCase()))
  ), [oils, type, cap, inStock, q]);

  const changeType = useCallback(async (sku: string, newType: string) => {
    setOils((prev) => prev?.map((o) => (o.sku === sku ? { ...o, oil_type: newType } : o)) ?? null);
    await supabase.rpc('set_oil_type', { p_sku: sku, p_type: newType });
  }, []);

  if (oils === null) return <div className="py-6 text-sm text-slate-400">Loading oils…</div>;

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search — brand, viscosity (e.g. Gulf, 5W-30)…"
        className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Capacity</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={cap === ''} onClick={() => setCap('')}>Any</Chip>
        {caps.map((c) => <Chip key={c} on={cap === c} onClick={() => setCap(c)}>{c}</Chip>)}
      </div>

      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Type</div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip on={type === ''} onClick={() => setType('')}>Any</Chip>
        {TYPES.map((t) => <Chip key={t.key} on={type === t.key} onClick={() => setType(t.key)}>{t.label}</Chip>)}
      </div>

      <div className="mb-3 flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
          In stock only
        </label>
        <button onClick={() => setEdit((v) => !v)} className="text-xs text-slate-400 hover:text-slate-700">{edit ? 'Done fixing types' : 'Fix a type ✎'}</button>
      </div>

      <div className="mb-2 text-xs text-slate-400">{filtered.length} oil{filtered.length !== 1 ? 's' : ''}</div>

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">No oils match — try widening the filters.</div>}
        {filtered.map((o) => (
          <div key={o.sku} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800" title={o.name}>{o.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-medium ${TYPE_CLASS[o.oil_type] ?? TYPE_CLASS.other}`}>{TYPE_LABEL[o.oil_type] ?? o.oil_type}</span>
                {o.capacity && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{o.capacity}</span>}
                <span className={o.stock > 0 ? 'text-emerald-600' : 'text-slate-400'}>{o.stock > 0 ? `${o.stock} in stock` : 'out of stock'}</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-slate-900">RM {o.price.toLocaleString('en-MY')}</div>
              {edit && (
                <select value={o.oil_type} onChange={(e) => changeType(o.sku, e.target.value)} className="mt-1 rounded border border-slate-300 px-1 py-0.5 text-xs">
                  {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
