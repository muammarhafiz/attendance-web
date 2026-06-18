// src/app/niagawan/inventory-v3/page.tsx
// Inventory v3 — a new inventory tracker built to the owner's weekly routine, step by step.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Item = { sku: string; code: string | null; descp: string | null; balance: number | null };
type Group = { id: number; name: string; sort_order: number };
type GroupItem = { id: number; group_id: number; sku: string; code: string | null; descp: string | null };

const SHOW_CAP = 1000; // rows rendered at once (the full catalog is ~12.7k — search to narrow)

export default function InventoryV3Page() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupItems, setGroupItems] = useState<GroupItem[]>([]);
  const [supplierByCode, setSupplierByCode] = useState<Map<string, string>>(new Map());
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
    const { data } = await supabase.from('inventory_po_groups').select('id,name,sort_order').order('sort_order').order('id');
    setGroups((data ?? []) as Group[]);
  }, []);

  const loadGroupItems = useCallback(async () => {
    const { data } = await supabase.from('inventory_po_group_items').select('id,group_id,sku,code,descp').order('id');
    setGroupItems((data ?? []) as GroupItem[]);
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
    // Supplier name comes from the watchlist (niagawan_min_stock), keyed by code.
    const { data: sup } = await supabase.from('niagawan_min_stock').select('code,supplier_name');
    const supMap = new Map<string, string>();
    for (const r of (sup ?? []) as { code: string; supplier_name: string | null }[]) {
      if (r.code && r.supplier_name) supMap.set(r.code, r.supplier_name);
    }
    setSupplierByCode(supMap);
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
      loadCatalog();
    }
  }, [isAdmin, loadGroups, loadGroupItems, loadCatalog]);

  // Live lookup: sku -> catalog row (for fresh description / balance in the group cards).
  const itemBySku = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items) m.set(it.sku, it);
    return m;
  }, [items]);

  const addGroup = useCallback(async () => {
    const name = window.prompt('Name the new group card (e.g. PROTON PO):');
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

  const removeGroupItem = useCallback(async (id: number) => {
    await supabase.from('inventory_po_group_items').delete().eq('id', id);
    await loadGroupItems();
  }, [loadGroupItems]);

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

      {/* GROUP PO CARDS (data-driven — add/remove your own) */}
      {groups.map((g) => {
        const rows = groupItems.filter((gi) => gi.group_id === g.id);
        return (
          <div key={g.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{g.name} <span className="font-normal text-gray-400">· {rows.length} item{rows.length === 1 ? '' : 's'}</span></h2>
              <button onClick={() => deleteGroup(g.id, g.name)} title="Remove this group card" className="rounded border border-gray-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50">✕ delete</button>
            </div>
            <div className="overflow-auto rounded border border-gray-100">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">No.</th>
                    <th className="px-3 py-2 font-semibold">Item Code</th>
                    <th className="px-3 py-2 font-semibold">Item Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                    <th className="px-3 py-2 font-semibold">Supplier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No items yet.</td></tr>
                  ) : (
                    rows.map((gi, i) => {
                      const live = itemBySku.get(gi.sku);
                      // Trust the live catalog whenever the sku still exists (membership identity is sku).
                      // Only fall back to the insert-time snapshot if the sku has vanished from the catalog
                      // — otherwise a code that genuinely reloaded as NULL would resurrect a stale code.
                      const code = live ? live.code : gi.code;
                      const descp = live ? live.descp : gi.descp;
                      const balance = live ? live.balance : null;
                      const supplier = code ? supplierByCode.get(code) : undefined;
                      return (
                        <tr key={gi.id} className="group">
                          <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{code || '—'}</td>
                          <td className="px-3 py-1.5 text-gray-700">{descp || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{balance == null ? '—' : balance}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">
                            <span className="inline-flex w-full items-center justify-between gap-2">
                              <span>{supplier || '—'}</span>
                              <button
                                onClick={() => removeGroupItem(gi.id)}
                                title="Remove from this card"
                                className="rounded px-1 text-xs text-rose-400 opacity-40 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
                              >✕</button>
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
