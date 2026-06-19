// src/app/niagawan/inventory-v3/page.tsx
// Inventory v3 — a re-order tracker built to the owner's weekly routine.
// Step 1: each group card is bound to ONE supplier; each item carries a carton size
// and a re-order threshold; the system counts "units sold since the last reset" and
// turns a row RED (with a carton-rounded suggested order qty) once the threshold is hit.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Item = { sku: string; code: string | null; descp: string | null; balance: number | null };
type Group = { id: number; name: string; sort_order: number; creditor_id: string | null; supplier_name: string | null };
type GroupItem = {
  id: number; group_id: number; sku: string; code: string | null; descp: string | null;
  carton_size: number | null; reorder_threshold: number | null; reset_at: string; sold_baseline: number;
};
type Supplier = { creditor_id: string; name: string };

const SHOW_CAP = 1000; // rows rendered at once (the full catalog is ~12.7k — search to narrow)

// Units to order = whole cartons covering what sold (round up); no-carton items order by units sold.
function suggestOrderQty(netSold: number, carton: number | null): number {
  if (carton && carton > 1) return Math.ceil(netSold / carton) * carton;
  return Math.ceil(netSold);
}

export default function InventoryV3Page() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupItems, setGroupItems] = useState<GroupItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [soldByCode, setSoldByCode] = useState<Map<string, number>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set()); // sku set
  const [targetGroupId, setTargetGroupId] = useState<number | ''>('');
  const [inserting, setInserting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  const loadGroups = useCallback(async () => {
    const { data } = await supabase.from('inventory_po_groups').select('id,name,sort_order,creditor_id,supplier_name').order('sort_order').order('id');
    setGroups((data ?? []) as Group[]);
  }, []);

  const loadGroupItems = useCallback(async () => {
    const { data } = await supabase.from('inventory_po_group_items').select('id,group_id,sku,code,descp,carton_size,reorder_threshold,reset_at,sold_baseline').order('id');
    setGroupItems((data ?? []) as GroupItem[]);
  }, []);

  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase.from('niagawan_suppliers').select('creditor_id,name').order('name');
    setSuppliers((data ?? []) as Supplier[]);
  }, []);

  const loadVelocity = useCallback(async () => {
    const { data } = await supabase.from('niagawan_sales_velocity').select('code,sold_30d');
    const m = new Map<string, number>();
    for (const r of (data ?? []) as { code: string; sold_30d: number | null }[]) {
      if (r.code) m.set(r.code, r.sold_30d != null ? Number(r.sold_30d) : 0);
    }
    setSoldByCode(m);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    // Full product catalog — paginated (Supabase caps each request at 1000 rows).
    const products: { sku: string; code: string | null; descp: string | null }[] = [];
    const PAGE = 1000;
    for (let from = 0; from < 40000; from += PAGE) {
      const { data, error } = await supabase.from('niagawan_products').select('sku,code,descp').order('sku').range(from, from + PAGE - 1);
      if (error || !data || !data.length) break;
      products.push(...(data as { sku: string; code: string | null; descp: string | null }[]));
      if (data.length < PAGE) break;
    }
    const { data: bal } = await supabase.from('niagawan_inventory').select('code,balance');
    const balByCode = new Map<string, number | null>();
    for (const r of (bal ?? []) as { code: string; balance: number | null }[]) balByCode.set(r.code, r.balance != null ? Number(r.balance) : null);
    const list: Item[] = products
      .map((p) => ({ sku: p.sku, code: p.code, descp: p.descp, balance: p.code && balByCode.has(p.code) ? balByCode.get(p.code) ?? null : null }))
      .sort((a, b) => (a.code || '￿').localeCompare(b.code || '￿') || a.sku.localeCompare(b.sku));
    setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadGroups();
      loadGroupItems();
      loadSuppliers();
      loadVelocity();
      loadCatalog();
    }
  }, [isAdmin, loadGroups, loadGroupItems, loadSuppliers, loadVelocity, loadCatalog]);

  // Live lookup: sku -> catalog row (for fresh description / balance in the group cards).
  const itemBySku = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items) m.set(it.sku, it);
    return m;
  }, [items]);

  // The ONE join key used everywhere (sold lookup, red tally, reset): prefer the live
  // catalog code, fall back to the insert-time snapshot if the live row lost its code.
  // Using this in all three places keeps the header tally, row highlight and reset in sync.
  const resolveCode = useCallback((gi: GroupItem): string | null => {
    return itemBySku.get(gi.sku)?.code ?? gi.code ?? null;
  }, [itemBySku]);

  const addGroup = useCallback(async () => {
    const name = window.prompt('Name the new group card (e.g. GULF):');
    if (!name || !name.trim()) return;
    const nextSort = groups.reduce((m, g) => Math.max(m, g.sort_order), 0) + 1;
    const { error } = await supabase.from('inventory_po_groups').insert({ name: name.trim(), sort_order: nextSort });
    if (error) { window.alert('Could not add: ' + error.message); return; }
    await loadGroups();
  }, [groups, loadGroups]);

  const deleteGroup = useCallback(async (id: number, name: string) => {
    if (!window.confirm(`Delete the "${name}" card and everything in it?`)) return;
    await supabase.from('inventory_po_groups').delete().eq('id', id);
    await loadGroups();
    await loadGroupItems();
  }, [loadGroups, loadGroupItems]);

  const setGroupSupplier = useCallback(async (groupId: number, creditorId: string) => {
    const sup = suppliers.find((s) => s.creditor_id === creditorId);
    const creditor = creditorId || null;
    const name = sup?.name ?? null;
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, creditor_id: creditor, supplier_name: name } : g)));
    const { error } = await supabase.from('inventory_po_groups').update({ creditor_id: creditor, supplier_name: name }).eq('id', groupId);
    if (error) { window.alert('Could not set supplier: ' + error.message); await loadGroups(); }
  }, [suppliers, loadGroups]);

  const removeGroupItem = useCallback(async (id: number) => {
    await supabase.from('inventory_po_group_items').delete().eq('id', id);
    await loadGroupItems();
  }, [loadGroupItems]);

  // Optimistic local update for an inline carton/threshold edit; caller persists onBlur.
  const setItemLocal = useCallback((id: number, patch: Partial<GroupItem>) => {
    setGroupItems((prev) => prev.map((gi) => (gi.id === id ? { ...gi, ...patch } : gi)));
  }, []);
  const persistItemField = useCallback(async (id: number, field: 'carton_size' | 'reorder_threshold', value: number | null) => {
    const { error } = await supabase.from('inventory_po_group_items').update({ [field]: value }).eq('id', id);
    if (error) { window.alert('Could not save: ' + error.message); await loadGroupItems(); }
  }, [loadGroupItems]);

  // Manually zero an item's counter (e.g. after restocking outside the system).
  // Baseline is snapshotted off the SAME code the display uses, so net truly reaches 0.
  const resetItemCount = useCallback(async (gi: GroupItem) => {
    const code = resolveCode(gi);
    const sold = code ? soldByCode.get(code) ?? 0 : 0;
    const reset_at = new Date().toISOString();
    setGroupItems((prev) => prev.map((x) => (x.id === gi.id ? { ...x, sold_baseline: sold, reset_at } : x)));
    await supabase.from('inventory_po_group_items').update({ sold_baseline: sold, reset_at }).eq('id', gi.id);
  }, [soldByCode, resolveCode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => (it.code || '').toLowerCase().includes(q) || (it.descp || '').toLowerCase().includes(q));
  }, [items, search]);
  const shown = filtered.slice(0, SHOW_CAP);

  // A new search is a new context — clear any prior selection so Insert can only
  // ever write rows the user can currently see (no hidden / off-screen inserts).
  useEffect(() => { setSelected(new Set()); }, [search]);

  const toggleSelect = useCallback((sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  }, []);

  const allShownSelected = shown.length > 0 && shown.every((it) => selected.has(it.sku));
  const toggleSelectAllShown = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const everySel = shown.length > 0 && shown.every((it) => next.has(it.sku));
      if (everySel) shown.forEach((it) => next.delete(it.sku));
      else shown.forEach((it) => next.add(it.sku));
      return next;
    });
  }, [shown]);

  const insertSelected = useCallback(async () => {
    if (!targetGroupId || selected.size === 0) return;
    setInserting(true);
    const rows = [...selected].map((sku) => {
      const it = itemBySku.get(sku);
      return { group_id: targetGroupId, sku, code: it?.code ?? null, descp: it?.descp ?? null };
    });
    // onConflict (group_id, sku): re-inserting an item already in the card is a no-op.
    const { error } = await supabase
      .from('inventory_po_group_items')
      .upsert(rows, { onConflict: 'group_id,sku', ignoreDuplicates: true });
    setInserting(false);
    if (error) { window.alert('Could not insert: ' + error.message); return; }
    setSelected(new Set());
    await loadGroupItems();
  }, [targetGroupId, selected, itemBySku, loadGroupItems]);

  if (isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  const targetName = groups.find((g) => g.id === targetGroupId)?.name;

  return (
    <div className="space-y-4">
      {/* PO CARD */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">PO CARD</h2>
      </div>

      {/* SUPPLIER GROUP CARDS (each bound to one supplier; items tracked + flagged red) */}
      {groups.map((g) => {
        const rows = groupItems.filter((gi) => gi.group_id === g.id);
        const redCount = rows.reduce((n, gi) => {
          const code = resolveCode(gi);
          const sold = code ? soldByCode.get(code) : undefined;
          const net = sold == null ? null : Math.max(0, sold - Number(gi.sold_baseline || 0));
          const thr = gi.reorder_threshold;
          return n + (thr != null && thr > 0 && net != null && net >= thr ? 1 : 0);
        }, 0);
        return (
          <div key={g.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-800">{g.name}</h2>
                <span className="text-xs text-gray-400">· {rows.length} item{rows.length === 1 ? '' : 's'}</span>
                {redCount > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">{redCount} to re-order</span>}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Supplier</label>
                <select
                  value={g.creditor_id ?? ''}
                  onChange={(e) => setGroupSupplier(g.id, e.target.value)}
                  className={`rounded-md border px-2 py-1 text-xs ${g.creditor_id ? 'border-gray-300 text-gray-800' : 'border-amber-300 bg-amber-50 text-amber-700'}`}
                >
                  <option value="">— choose supplier —</option>
                  {g.creditor_id && !suppliers.some((s) => s.creditor_id === g.creditor_id) && (
                    <option value={g.creditor_id}>{g.supplier_name ?? g.creditor_id} (not in list)</option>
                  )}
                  {suppliers.map((s) => (
                    <option key={s.creditor_id} value={s.creditor_id}>{s.name}</option>
                  ))}
                </select>
                <button onClick={() => deleteGroup(g.id, g.name)} title="Remove this group card" className="rounded border border-gray-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50">✕ delete</button>
              </div>
            </div>
            <div className="overflow-auto rounded border border-gray-100">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">No.</th>
                    <th className="px-3 py-2 font-semibold">Item Code</th>
                    <th className="px-3 py-2 font-semibold">Item Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Units sold since the last reset">Sold</th>
                    <th className="px-3 py-2 text-center font-semibold" title="Bottles per carton (blank = no carton)">Carton</th>
                    <th className="px-3 py-2 text-center font-semibold" title="Units sold that triggers re-order">Re-order at</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">No items yet — add from the Inventory List below.</td></tr>
                  ) : (
                    rows.map((gi, i) => {
                      const live = itemBySku.get(gi.sku);
                      const code = resolveCode(gi);
                      const descp = live ? live.descp : gi.descp;
                      const balance = live ? live.balance : null;
                      const sold = code ? soldByCode.get(code) : undefined;
                      const net = sold == null ? null : Math.max(0, sold - Number(gi.sold_baseline || 0));
                      const thr = gi.reorder_threshold;
                      const tracked = thr != null && thr > 0;
                      const isRed = tracked && net != null && net >= thr;
                      const orderQty = net != null ? suggestOrderQty(net, gi.carton_size) : 0;
                      return (
                        <tr key={gi.id} className={`group ${isRed ? 'bg-rose-50' : ''}`}>
                          <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{code || '—'}</td>
                          <td className="px-3 py-1.5 text-gray-700">{descp || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{balance == null ? '—' : balance}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700" title={sold == null ? 'no sales data yet' : `${sold} sold in last 30 days`}>
                            {net == null ? '—' : net}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <input
                              type="number" min={1} inputMode="numeric"
                              value={gi.carton_size == null ? '' : gi.carton_size}
                              onChange={(e) => setItemLocal(gi.id, { carton_size: e.target.value === '' ? null : Math.floor(Number(e.target.value)) })}
                              onBlur={(e) => {
                                const v = e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value) || 1));
                                setItemLocal(gi.id, { carton_size: v });
                                persistItemField(gi.id, 'carton_size', v);
                              }}
                              placeholder="—"
                              className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <input
                              type="number" min={1} inputMode="numeric"
                              value={gi.reorder_threshold == null ? '' : gi.reorder_threshold}
                              onChange={(e) => setItemLocal(gi.id, { reorder_threshold: e.target.value === '' ? null : Math.floor(Number(e.target.value)) })}
                              onBlur={(e) => {
                                const v = e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value) || 1));
                                setItemLocal(gi.id, { reorder_threshold: v });
                                persistItemField(gi.id, 'reorder_threshold', v);
                              }}
                              placeholder="—"
                              className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs"
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5">
                            <span className="inline-flex w-full items-center justify-between gap-2">
                              <span>
                                {!tracked ? (
                                  <span className="text-xs text-gray-400">set re-order point</span>
                                ) : isRed ? (
                                  <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">RE-ORDER · {orderQty}</span>
                                ) : (
                                  <span className="text-xs text-emerald-600">ok · {net ?? 0}/{thr}</span>
                                )}
                              </span>
                              <span className="flex items-center gap-1 opacity-40 transition group-hover:opacity-100">
                                <button onClick={() => resetItemCount(gi)} title="Reset the sold counter to zero (e.g. after restocking)" className="rounded px-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700">↺</button>
                                <button onClick={() => removeGroupItem(gi.id)} title="Remove from this card" className="rounded px-1 text-xs text-rose-400 hover:bg-rose-50 hover:text-rose-600">✕</button>
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Add a new group card */}
      <button onClick={addGroup} className="w-full rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
        + Add a new group card
      </button>

      {/* INVENTORY LIST CARD */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">INVENTORY LIST CARD <span className="font-normal text-gray-400">· {items.length.toLocaleString('en-MY')} items (full catalog)</span></h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or description…" className="w-64 max-w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </div>

        {/* Selection action bar — appears once you tick at least one row */}
        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-medium text-blue-800">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} disabled={inserting} className="text-xs text-blue-600 underline hover:text-blue-800 disabled:opacity-50">clear</button>
            {allShownSelected && filtered.length > SHOW_CAP && (
              <span className="text-xs text-amber-700">first {SHOW_CAP.toLocaleString('en-MY')} of {filtered.length.toLocaleString('en-MY')} matches — narrow your search to reach the rest</span>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-gray-600">Insert into</span>
              <select
                value={targetGroupId}
                onChange={(e) => setTargetGroupId(e.target.value ? Number(e.target.value) : '')}
                disabled={inserting}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
              >
                <option value="">Choose a card…</option>
                {groups.length === 0 && <option value="" disabled>No cards yet — add one below</option>}
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <button
                onClick={insertSelected}
                disabled={!targetGroupId || inserting}
                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inserting ? 'Inserting…' : targetName ? `Insert → ${targetName}` : 'Insert'}
              </button>
            </span>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500">Loading the full catalog…</div>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded border border-gray-100">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2">
                      <input type="checkbox" checked={allShownSelected} onChange={toggleSelectAllShown} title="Select all shown" className="cursor-pointer" />
                    </th>
                    <th className="px-3 py-2 font-semibold">No.</th>
                    <th className="px-3 py-2 font-semibold">Item Code</th>
                    <th className="px-3 py-2 font-semibold">Item Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map((it, i) => {
                    const sel = selected.has(it.sku);
                    return (
                      <tr key={it.sku} className={sel ? 'bg-blue-50' : ''}>
                        <td className="px-3 py-1.5">
                          <input type="checkbox" checked={sel} onChange={() => toggleSelect(it.sku)} className="cursor-pointer" />
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{it.code || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-700">{it.descp || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{it.balance == null ? '—' : it.balance}</td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No items match “{search}”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-1 text-xs text-gray-400">
              Showing {shown.length.toLocaleString('en-MY')} of {filtered.length.toLocaleString('en-MY')}{filtered.length !== items.length ? ` matching (of ${items.length.toLocaleString('en-MY')} total)` : ''}{filtered.length > SHOW_CAP ? ' — search to narrow the list.' : ''}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
