// src/app/niagawan/inventory-v3/page.tsx
// Inventory v3 — a new inventory tracker built to the owner's weekly routine, step by step.
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Item = { code: string; description: string | null; balance: number | null };

export default function InventoryV3Page() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      setLoading(true);
      const [w, b] = await Promise.all([
        supabase.from('niagawan_min_stock').select('code,description'),
        supabase.from('niagawan_inventory').select('code,balance'),
      ]);
      const balByCode = new Map<string, number | null>();
      for (const r of (b.data ?? []) as { code: string; balance: number | null }[]) {
        balByCode.set(r.code, r.balance != null ? Number(r.balance) : null);
      }
      const list = ((w.data ?? []) as { code: string; description: string | null }[])
        .map((r) => ({ code: r.code, description: r.description, balance: balByCode.has(r.code) ? balByCode.get(r.code) ?? null : null }))
        .sort((a, b) => a.code.localeCompare(b.code));
      setItems(list);
      setLoading(false);
    })();
  }, [isAdmin]);

  if (isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div className="space-y-4">
      {/* PO CARD */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">PO CARD</h2>
      </div>

      {/* INVENTORY LIST CARD */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">INVENTORY LIST CARD <span className="font-normal text-gray-400">· {items.length} items</span></h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : (
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
                {items.map((it, i) => (
                  <tr key={it.code}>
                    <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{it.code}</td>
                    <td className="px-3 py-1.5 text-gray-700">{it.description || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{it.balance == null ? '—' : it.balance}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No items.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
