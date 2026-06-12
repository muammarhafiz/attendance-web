// src/app/add-part/page.tsx — "part arrived" v2.
// Type a few letters of the code or name -> instant list from the synced product catalog ->
// tap the EXACT product -> it queues in the background and the form resets immediately.
// A status strip shows each queued item turning ✓ as the NAS lands it on the invoice.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type OpenInv = { inv: string; sale_id: string; customer: string | null };
type Product = { sku: string; code: string | null; descp: string | null; price: number | string | null };
type Queued = { id: number; label: string; status: 'pending' | 'done' | 'error'; result?: string };

const rm = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? `RM ${v.toFixed(2)}` : ''; };

export default function AddPartPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [cars, setCars] = useState<OpenInv[]>([]);
  const [picked, setPicked] = useState<OpenInv | null>(null);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [chosen, setChosen] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
    })();
  }, []);

  const loadCars = useCallback(async () => {
    const { data } = await supabase.rpc('open_invoices_today');
    setCars((data ?? []) as OpenInv[]);
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadCars();
    const t = setInterval(loadCars, 30000);
    return () => clearInterval(t);
  }, [authed, loadCars]);

  // Instant product search against the synced catalog (no Niagawan round-trip).
  const search = useCallback((text: string) => {
    setQ(text);
    setChosen(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = text.trim();
    if (term.length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, '')}%`;
      const { data } = await supabase
        .from('niagawan_products')
        .select('sku,code,descp,price')
        .or(`code.ilike.${like},descp.ilike.${like}`)
        .limit(12);
      setResults((data ?? []) as Product[]);
    }, 250);
  }, []);

  // Watch pending queue items until they finish.
  useEffect(() => {
    if (!queue.some((x) => x.status === 'pending')) return;
    const t = setInterval(async () => {
      const pending = queue.filter((x) => x.status === 'pending').map((x) => x.id);
      if (!pending.length) return;
      const { data } = await supabase.from('additem_requests').select('id,status,result').in('id', pending);
      if (!data) return;
      setQueue((prev) => prev.map((x) => {
        const row = data.find((d) => d.id === x.id);
        if (!row || row.status === 'pending' || row.status === 'processing') return x;
        return { ...x, status: row.status === 'done' ? 'done' : 'error', result: row.result ?? undefined };
      }));
    }, 4000);
    return () => clearInterval(t);
  }, [queue]);

  const add = useCallback(async () => {
    if (!picked) { setErrMsg('Sila pilih kereta dulu.'); return; }
    if (!chosen) { setErrMsg('Sila pilih item dari senarai.'); return; }
    setErrMsg(null);
    const { data: id, error } = await supabase.rpc('queue_add_item', {
      p_inv: picked.inv, p_sale_id: picked.sale_id, p_plate: picked.customer ?? '',
      p_code: chosen.code ?? '', p_qty: qty, p_sku: chosen.sku, p_descp: chosen.descp ?? '',
    });
    if (error || !id) { setErrMsg(error?.message ?? 'failed'); return; }
    const label = `${chosen.descp ?? chosen.code} ×${qty} → ${picked.customer ?? picked.inv}`;
    setQueue((prev) => [{ id: id as number, label, status: 'pending' as const }, ...prev].slice(0, 8));
    // fire-and-forget: reset the item immediately, keep the same car selected
    setQ(''); setResults([]); setChosen(null); setQty(1);
  }, [picked, chosen, qty]);

  if (authed === null) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in first.</div>;

  const shown = cars.filter((c) => !filter.trim() || String(c.customer ?? c.inv).toUpperCase().includes(filter.trim().toUpperCase()));

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold text-gray-900">🔩 Part Sampai</h1>

      {/* 1) car */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">1. Kereta {picked ? '✓' : `(${cars.length} dalam workshop)`}</span>
          {!picked && cars.length > 6 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="cari plat…" className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          )}
        </div>
        {picked ? (
          <button onClick={() => setPicked(null)} className="mt-2 flex w-full items-center justify-between rounded-xl border border-blue-600 bg-blue-50 px-3 py-2.5 text-left">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-blue-900">{picked.customer || '(no name)'}</span>
              <span className="font-mono text-xs text-blue-400">{picked.inv}</span>
            </span>
            <span className="shrink-0 text-xs text-blue-500 underline">tukar</span>
          </button>
        ) : (
          <div className="mt-2 grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto">
            {shown.length === 0 && <div className="text-sm text-gray-400">Tiada invois unpaid aktif.</div>}
            {shown.map((c) => (
              <button key={c.inv} onClick={() => setPicked(c)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-800 hover:border-gray-300">
                <span className="block truncate">{c.customer || '(no name)'}</span>
                <span className="font-mono text-xs text-gray-400">{c.inv}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2) part search */}
      <div className="mt-5">
        <span className="text-sm font-medium text-gray-700">2. Cari item (kod atau nama)</span>
        <input value={q} onChange={(e) => search(e.target.value)} placeholder="cth: MRDB atau BRAKE PAD" autoComplete="off"
          className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3.5 text-lg uppercase" />
        {chosen ? (
          <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-400 bg-emerald-50 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-emerald-900">{chosen.descp}</span>
              <span className="font-mono text-xs text-emerald-600">{chosen.code} {rm(chosen.price)}</span>
            </span>
            <button onClick={() => { setChosen(null); setQ(''); }} className="shrink-0 text-xs text-emerald-600 underline">tukar</button>
          </div>
        ) : results.length > 0 ? (
          <div className="mt-2 grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto">
            {results.map((p) => (
              <button key={p.sku} onClick={() => { setChosen(p); setResults([]); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300">
                <span className="block truncate text-sm text-gray-900">{p.descp || '(no name)'}</span>
                <span className="font-mono text-xs text-gray-400">{p.code || '—'} <span className="text-gray-500">{rm(p.price)}</span></span>
              </button>
            ))}
          </div>
        ) : q.trim().length >= 2 ? (
          <div className="mt-2 text-sm text-gray-400">Tiada item sepadan… semak ejaan.</div>
        ) : null}
      </div>

      {/* 3) qty + go */}
      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700">Kuantiti:</span>
        <button onClick={() => setQty((v) => Math.max(1, v - 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl font-bold text-gray-700">−</button>
        <span className="w-10 text-center text-xl font-bold">{qty}</span>
        <button onClick={() => setQty((v) => v + 1)} className="h-11 w-11 rounded-xl border border-gray-300 text-xl font-bold text-gray-700">+</button>
      </div>

      {errMsg && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errMsg}</div>}

      <button onClick={add} disabled={!picked || !chosen}
        className="mt-4 w-full rounded-xl bg-blue-600 px-6 py-4 text-xl font-bold text-white hover:bg-blue-700 disabled:opacity-40">
        MASUKKAN KE INVOIS
      </button>

      {/* queue status */}
      {queue.length > 0 && (
        <div className="mt-5 space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Status</div>
          {queue.map((x) => (
            <div key={x.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${x.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : x.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
              <span className="shrink-0">{x.status === 'done' ? '✅' : x.status === 'error' ? '⚠️' : '⏳'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{x.label}</span>
                {x.result && <span className="block truncate text-xs opacity-75">{x.result}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
