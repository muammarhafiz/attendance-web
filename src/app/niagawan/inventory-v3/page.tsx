// src/app/niagawan/inventory-v3/page.tsx
// Inventory v3 — a new inventory tracker built to the owner's weekly routine, step by step.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Item = { sku: string; code: string | null; descp: string | null; balance: number | null };
type Group = { id: number; name: string; sort_order: number };

const SHOW_CAP = 1000; // rows rendered at once (the full catalog is ~12.7k — search to narrow)

export default function InventoryV3Page() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);

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

  useEffect(() => { if (isAdmin) { loadGroups(); loadCatalog(); } }, [isAdmin, loadGroups, loadCatalog]);

  const addGroup = useCallback(async () => {
    const name = window.prompt('Name the new group card (e.g. PROTON PO):');
    if (!name || !name.trim()) return;
    const nextSort = groups.reduce((m, g) => Math.max(m, g.sort_order), 0) + 1;
    const { error } = await supabase.from('inventory_po_groups').insert({ name: name.trim(), sort_order: nextSort });
    if (error) { window.alert('Could not add: ' + error.message); return; }
    await loadGroups();
  }, [groups, loadGroups]);

  const deleteGroup = useCallback(async (id: number, name: string) => {
    if (!window.confirm(`Delete the "${name}" card? (the items aren't deleted)`)) return;
    await supabase.from('inventory_po_groups').delete().eq('id', id);
    await loadGroups();
  }, [loadGroups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => (it.code || '').toLowerCase().includes(q) || (it.descp || '').toLowerCase().includes(q));
  }, [items, search]);
  const shown = filtered.slice(0, SHOW_CAP);

  if (isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div className="space-y-4">
      {/* PO CARD */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">PO CARD</h2>
      </div>

      {/* GROUP PO CARDS (data-driven — add/remove your own) */}
      {groups.map((g) => (
        <div key={g.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">{g.name}</h2>
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
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No items yet.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}

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
        {loading ? (
          <div className="text-sm text-gray-500">Loading the full catalog…</div>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded border border-gray-100">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">No.</th>
                    <th className="px-3 py-2 font-semibold">Item Code</th>
                    <th className="px-3 py-2 font-semibold">Item Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map((it, i) => (
                    <tr key={it.sku}>
                      <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{it.code || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-700">{it.descp || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{it.balance == null ? '—' : it.balance}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No items match “{search}”.</td></tr>
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
