// src/app/add-part/page.tsx — "part arrived" v2.
// Type a few letters of the code or name -> instant list from the synced product catalog ->
// tap the EXACT product -> it queues in the background and the form resets immediately.
// A status table shows each queued item turning ✓ as the NAS lands it on the invoice.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import BackLink from '@/components/BackLink';
import { useVisibleInterval } from '@/lib/useVisibleInterval';
import BarcodeScanner, { looksLikeCode } from '@/components/BarcodeScanner';

type OpenInv = { inv: string; sale_id: string; customer: string | null };
type Product = { sku: string; code: string | null; descp: string | null; price: number | string | null; cost: number | string | null };
type Queued = { id: number; item: string; qty: number; car: string; status: 'pending' | 'done' | 'error'; result?: string };

const rm = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? `RM ${v.toFixed(2)}` : '—'; };
// niagawan_sale_inv.customer is "VEHICLE PLATE<invoiceNo>, , <cashier login>" — keep the vehicle+plate part only
const carLabel = (c: OpenInv) => {
  const raw = String(c.customer ?? '');
  const clean = (raw.split(c.inv)[0] || raw).replace(/[,\s]+$/, '').trim();
  return clean || c.inv;
};

export default function AddPartPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null); // supervisors/admins only
  const [cars, setCars] = useState<OpenInv[]>([]);
  const [picked, setPicked] = useState<OpenInv | null>(null);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [chosen, setChosen] = useState<Product | null>(null);
  const [priceOverride, setPriceOverride] = useState(''); // feature 1: per-line selling-price override
  const [editPrice, setEditPrice] = useState(false);
  const [newItem, setNewItem] = useState<{ barcode: string; descp: string; price: string } | null>(null); // feature 2: item not in catalog
  const [qty, setQty] = useState(1);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false); // camera barcode scanner open
  const [scannedCode, setScannedCode] = useState(''); // barcode from the last scan — becomes the new product's code
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) {
        const { data: bw } = await supabase.rpc('can_access', { p_feature: 'add_part' });
        setAllowed(bw === true);
      } else setAllowed(false);
    })();
  }, []);

  const loadCars = useCallback(async () => {
    const { data } = await supabase.rpc('open_invoices_today');
    setCars((data ?? []) as OpenInv[]);
  }, []);

  useEffect(() => {
    if (authed && allowed === true) loadCars();
  }, [authed, allowed, loadCars]);
  useVisibleInterval(loadCars, 30000, authed && allowed === true);

  // Instant product search against the synced catalog (no Niagawan round-trip).
  const search = useCallback((text: string) => {
    setQ(text);
    setChosen(null);
    setEditPrice(false);
    setPriceOverride('');
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = text.trim();
    if (term.length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, '')}%`;
      const { data } = await supabase
        .from('niagawan_products')
        .select('sku,code,descp,price,cost')
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
    if (!picked) { setErrMsg('Pick a vehicle first.'); return; }
    let rpcArgs: Record<string, unknown>;
    let label: string;
    if (newItem) {
      // brand-new item not in Niagawan -> the NAS creates a real product (barcode + name + price)
      // and adds it to the invoice; falls back to the "--" placeholder only if the create fails.
      if (!newItem.descp.trim()) { setErrMsg('Enter the item name.'); return; }
      // Last line of defence before we create a REAL product: never let a bad scan through.
      const bc = newItem.barcode.trim();
      if (bc && !looksLikeCode(bc)) {
        setErrMsg('That barcode didn’t read cleanly. Scan it again, or type the code by hand.');
        return;
      }
      const priceN = Number(newItem.price);
      if (newItem.price.trim() === '' || !Number.isFinite(priceN) || priceN < 0) { setErrMsg('Enter a valid selling price.'); return; }
      rpcArgs = {
        p_inv: picked.inv, p_sale_id: picked.sale_id, p_plate: picked.customer ?? '',
        p_code: '', p_qty: qty, p_sku: null, p_descp: newItem.descp.trim(), p_price: priceN, p_is_new: true,
        p_barcode: newItem.barcode.trim(),
      };
      label = newItem.descp.trim();
    } else {
      if (!chosen) { setErrMsg('Pick an item from the list.'); return; }
      let priceN: number | null = null;
      if (editPrice && priceOverride.trim() !== '') {
        priceN = Number(priceOverride);
        if (!Number.isFinite(priceN) || priceN < 0) { setErrMsg('Enter a valid price.'); return; }
      }
      rpcArgs = {
        p_inv: picked.inv, p_sale_id: picked.sale_id, p_plate: picked.customer ?? '',
        p_code: chosen.code ?? '', p_qty: qty, p_sku: chosen.sku, p_descp: chosen.descp ?? '', p_price: priceN, p_is_new: false,
      };
      label = chosen.descp || chosen.code || '?';
    }
    setErrMsg(null);
    const { data: id, error } = await supabase.rpc('queue_add_item', rpcArgs);
    if (error || !id) { setErrMsg(error?.message ?? 'failed'); return; }
    const entry: Queued = { id: id as number, item: label, qty, car: carLabel(picked), status: 'pending' };
    setQueue((prev) => [entry, ...prev].slice(0, 8));
    // fire-and-forget: reset the item immediately, keep the same vehicle selected
    setQ(''); setResults([]); setChosen(null); setQty(1);
    setEditPrice(false); setPriceOverride(''); setNewItem(null); setScannedCode('');
  }, [picked, chosen, qty, editPrice, priceOverride, newItem]);

  if (authed === null || (authed && allowed === null)) return <div className="p-6 text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="p-6 text-sm text-gray-600">Please sign in first.</div>;
  if (!allowed) return <div className="p-6 text-sm text-gray-600">This page is for supervisors only.</div>;

  const shown = cars.filter((c) => !filter.trim() || carLabel(c).toUpperCase().includes(filter.trim().toUpperCase()));

  return (
    <div className="mx-auto max-w-md px-5 py-6">
      {scanning && (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onDetected={(code) => { setScanning(false); setScannedCode(code.trim()); search(code); }}
        />
      )}
      <BackLink />
      <h1 className="mt-2 text-2xl font-bold text-gray-900">🔩 Part Arrived</h1>

      {/* 1) vehicle */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">1. Vehicle {picked ? '✓' : `(${cars.length} in workshop)`}</span>
          {!picked && cars.length > 6 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="search plate…" className="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          )}
        </div>
        {picked ? (
          <button onClick={() => setPicked(null)} className="mt-2 flex w-full items-center justify-between rounded-xl border border-blue-600 bg-blue-50 px-3 py-2.5 text-left">
            <span className="truncate text-sm font-semibold text-blue-900">{carLabel(picked)}</span>
            <span className="shrink-0 rounded-lg border border-blue-300 px-2 py-1 text-xs font-medium text-blue-600">Change vehicle</span>
          </button>
        ) : (
          <div className="mt-2 grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto">
            {shown.length === 0 && <div className="text-sm text-gray-400">No open unpaid invoices.</div>}
            {shown.map((c) => (
              <button key={c.inv} onClick={() => setPicked(c)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-800 hover:border-gray-300">
                <span className="block truncate">{carLabel(c)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2) part search OR new item */}
      <div className="mt-5">
        <span className="text-sm font-medium text-gray-700">2. {newItem ? 'New product (will be created in Niagawan)' : 'Search item (code or name)'}</span>
        {newItem ? (
          <div className="mt-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-gray-600">Barcode</span>
              <input value={newItem.barcode} onChange={(e) => setNewItem({ ...newItem, barcode: e.target.value })}
                placeholder="scan or leave blank" autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase" />
            </div>
            <input value={newItem.descp} onChange={(e) => setNewItem({ ...newItem, descp: e.target.value })}
              placeholder="Item name (printed on the invoice)" autoComplete="off" autoFocus={!!newItem.barcode}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Selling price RM</span>
              <input type="number" inputMode="decimal" step="0.01" min="0" value={newItem.price}
                onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} placeholder="0.00"
                className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-base" />
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => { setNewItem(null); setScannedCode(''); }} className="text-xs text-gray-500 underline">← back to search</button>
            </div>
            <p className="text-xs text-gray-400">Creates a real Niagawan product{newItem.barcode ? ' with this barcode' : ''}, priced as above, and adds it to the invoice — so it&apos;s in the catalog and scannable next time.</p>
          </div>
        ) : (
          <>
            <input value={q} onChange={(e) => { setScannedCode(''); search(e.target.value); }} placeholder="e.g. MRDB or BRAKE PAD" autoComplete="off"
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3.5 text-lg uppercase" />
            {!chosen && (
              <button type="button" onClick={() => setScanning(true)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-blue-600 bg-blue-50 px-4 py-3 text-base font-semibold text-blue-700 hover:bg-blue-100">
                📷 Scan barcode
              </button>
            )}
            {chosen ? (
              <div className="mt-2 rounded-xl border border-emerald-400 bg-emerald-50 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-emerald-900">{chosen.descp}</span>
                    <span className="font-mono text-xs text-emerald-600">{chosen.code || '—'} · Price {rm(editPrice && priceOverride !== '' ? priceOverride : chosen.price)} · Cost {rm(chosen.cost)}</span>
                  </span>
                  <button onClick={() => { setChosen(null); setQ(''); setEditPrice(false); setPriceOverride(''); }} className="shrink-0 text-xs text-emerald-600 underline">change</button>
                </div>
                {editPrice ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-600">Selling price RM</span>
                    <input type="number" inputMode="decimal" step="0.01" min="0" autoFocus value={priceOverride}
                      onChange={(e) => setPriceOverride(e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                    <button onClick={() => { setEditPrice(false); setPriceOverride(''); }} className="text-xs text-gray-400 underline">cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setEditPrice(true); setPriceOverride(String(chosen.price ?? '')); }} className="mt-1.5 text-xs font-medium text-blue-600 underline">change price</button>
                )}
              </div>
            ) : results.length > 0 ? (
              <div className="mt-2 grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto">
                {results.map((p) => (
                  <button key={p.sku} onClick={() => { setChosen(p); setResults([]); setEditPrice(false); setPriceOverride(''); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300">
                    <span className="block truncate text-sm text-gray-900">{p.descp || '(no name)'}</span>
                    <span className="font-mono text-xs text-gray-400">{p.code || '—'} · <span className="text-gray-600">Price {rm(p.price)}</span> · <span className="text-amber-700">Cost {rm(p.cost)}</span></span>
                  </button>
                ))}
              </div>
            ) : q.trim().length >= 2 ? (
              <div className="mt-2 text-sm text-gray-400">
                {scannedCode ? <>Barcode <span className="font-mono">{scannedCode}</span> isn&apos;t in the system yet.</> : 'No matching item… check the spelling.'}
              </div>
            ) : null}
            {!chosen && (!scannedCode || looksLikeCode(scannedCode)) && (
              <button onClick={() => { setNewItem({ barcode: scannedCode, descp: scannedCode ? '' : q.trim(), price: '' }); setQ(''); setResults([]); }}
                className="mt-2 text-xs font-medium text-blue-600 underline">
                {scannedCode ? '➕ Not in the system — create this scanned part' : '➕ Item not in the list — add as a new item'}
              </button>
            )}
            {!chosen && scannedCode && !looksLikeCode(scannedCode) && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                That barcode didn&apos;t read cleanly, so it can&apos;t be used to create a part. Scan it again, or type the code in the box above.
              </div>
            )}
          </>
        )}
      </div>

      {/* 3) qty + go */}
      <div className="mt-4 flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700">Quantity:</span>
        <button onClick={() => setQty((v) => Math.max(1, v - 1))} className="h-11 w-11 rounded-xl border border-gray-300 text-xl font-bold text-gray-700">−</button>
        <span className="w-10 text-center text-xl font-bold">{qty}</span>
        <button onClick={() => setQty((v) => v + 1)} className="h-11 w-11 rounded-xl border border-gray-300 text-xl font-bold text-gray-700">+</button>
      </div>

      {errMsg && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errMsg}</div>}

      <button onClick={add} disabled={!picked || (!chosen && !newItem)}
        className="mt-4 w-full rounded-xl bg-blue-600 px-6 py-4 text-xl font-bold text-white hover:bg-blue-700 disabled:opacity-40">
        ADD TO INVOICE
      </button>

      {/* queue status */}
      {queue.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Status</div>
          <div className="mt-1.5 overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-2 py-2 font-medium">Qty</th>
                  <th className="px-2 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((x) => (
                  <tr key={x.id} className={`border-t border-gray-100 ${x.status === 'done' ? 'bg-emerald-50/50' : x.status === 'error' ? 'bg-rose-50/50' : ''}`}>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-gray-800" title={x.item}>{x.item}</td>
                    <td className="px-2 py-2 text-gray-600">×{x.qty}</td>
                    <td className="max-w-[7rem] truncate px-2 py-2 text-gray-600" title={x.car}>{x.car}</td>
                    <td className="px-3 py-2 text-right" title={x.result ?? ''}>
                      {x.status === 'done' ? '✅' : x.status === 'error' ? <span className="text-xs text-rose-600">⚠️ failed</span> : '⏳'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
