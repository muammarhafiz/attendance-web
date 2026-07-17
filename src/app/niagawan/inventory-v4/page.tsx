// src/app/niagawan/inventory-v4/page.tsx
// Inventory v4 — keep-level restock. For each supplier card: live stock, an average
// monthly sold (typed for now; a "Calculate average" button that scans 3 months of sales
// is wired next), a keep-level (= avg x3, editable), and a carton-rounded Order suggestion
// = keep - stock - already-on-order. No reset, no sold-since-reset counter (that was v3's
// broken part). Reuses v3's tables (inventory_po_groups / inventory_po_group_items) and
// balance sync — v1/v2/v3 are untouched.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Group = { id: number; name: string; sort_order: number; creditor_id: string | null; supplier_name: string | null };
type GroupItem = { id: number; group_id: number; sku: string; code: string | null; descp: string | null; carton_size: number | null; avg_monthly: number | null; keep_level: number | null };
type Item = { sku: string; code: string | null; descp: string | null; balance: number | null };
type PoSugg = { id: number; status: string; po_number: string | null };
type PoLine = { suggestion_id: number; sku: string | null; code: string | null; ordered_qty: number; received_qty: number };

const OPEN = new Set(['pending', 'approved', 'created']);
// Round the order up to whole cartons (Gulf = 4 per carton). No carton set -> order exact units.
function orderQty(need: number, carton: number | null): number {
  if (need <= 0) return 0;
  if (carton && carton > 1) return Math.ceil(need / carton) * carton;
  return Math.ceil(need);
}

export default function InventoryV4Page() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupItems, setGroupItems] = useState<GroupItem[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [poSuggs, setPoSuggs] = useState<PoSugg[]>([]);
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [refreshState, setRefreshState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [balanceAsOf, setBalanceAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const loadGroups = useCallback(async () => {
    const { data } = await supabase.from('inventory_po_groups').select('id,name,sort_order,creditor_id,supplier_name').order('sort_order').order('id');
    setGroups((data ?? []) as Group[]);
  }, []);

  const loadGroupItems = useCallback(async () => {
    const { data } = await supabase.from('inventory_po_group_items').select('id,group_id,sku,code,descp,carton_size,avg_monthly,keep_level').order('id');
    setGroupItems((data ?? []) as GroupItem[]);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
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
    setItems(products.map((p) => ({ sku: p.sku, code: p.code, descp: p.descp, balance: p.code && balByCode.has(p.code) ? balByCode.get(p.code) ?? null : null })));
    setLoading(false);
  }, []);

  const loadFreshness = useCallback(async () => {
    const { data } = await supabase.from('niagawan_inventory').select('updated_at').order('updated_at', { ascending: false }).limit(1);
    setBalanceAsOf((data && data[0]?.updated_at) ? String(data[0].updated_at) : null);
  }, []);

  // Open POs (any card) -> so we don't re-suggest what's already on the way.
  const reloadPOs = useCallback(async () => {
    const { data: ss } = await supabase.from('po_suggestions').select('id,status,po_number')
      .in('source', ['inventory-v3', 'inventory-v4']).neq('status', 'rejected').order('id', { ascending: false }).limit(80);
    const suggs = (ss ?? []) as PoSugg[];
    const ids = suggs.filter((s) => OPEN.has(s.status)).map((s) => s.id);
    let lines: PoLine[] = [];
    if (ids.length) {
      const { data: ls } = await supabase.from('inventory_po_lines').select('suggestion_id,sku,code,ordered_qty,received_qty').in('suggestion_id', ids);
      lines = (ls ?? []) as PoLine[];
    }
    setPoSuggs(suggs); setPoLines(lines);
  }, []);

  useEffect(() => {
    if (isAdmin) { loadGroups(); loadGroupItems(); loadCatalog(); loadFreshness(); reloadPOs(); }
  }, [isAdmin, loadGroups, loadGroupItems, loadCatalog, loadFreshness, reloadPOs]);

  useEffect(() => () => { if (refreshPoll.current) clearInterval(refreshPoll.current); }, []);

  const updateBalances = useCallback(async () => {
    if (refreshState === 'running') return;
    setRefreshState('running');
    const { data, error } = await supabase.from('sync_requests').insert({ source: 'inventory-v4', which: 'groupbal' }).select('id').single();
    if (error || !data) { setRefreshState('error'); window.setTimeout(() => setRefreshState('idle'), 5000); return; }
    const id = data.id as number;
    const started = Date.now();
    if (refreshPoll.current) clearInterval(refreshPoll.current);
    refreshPoll.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (refreshPoll.current) clearInterval(refreshPoll.current);
        await loadCatalog(); await loadFreshness();
        setRefreshState(r.status === 'done' ? 'done' : 'error');
        window.setTimeout(() => setRefreshState('idle'), 5000);
      } else if (Date.now() - started > 4 * 60 * 1000) { if (refreshPoll.current) clearInterval(refreshPoll.current); setRefreshState('idle'); }
    }, 4000);
  }, [refreshState, loadCatalog, loadFreshness]);

  const itemBySku = useMemo(() => { const m = new Map<string, Item>(); for (const it of items) m.set(it.sku, it); return m; }, [items]);

  // Units already on an OPEN po (by code) -> subtract from the order suggestion.
  const onOrderByCode = useMemo(() => {
    const openIds = new Set(poSuggs.filter((s) => OPEN.has(s.status)).map((s) => s.id));
    const m = new Map<string, number>();
    for (const l of poLines) {
      if (!openIds.has(l.suggestion_id)) continue;
      const key = l.code ?? '';
      const remaining = Math.max(0, Number(l.ordered_qty || 0) - Number(l.received_qty || 0));
      if (key) m.set(key, (m.get(key) ?? 0) + remaining);
    }
    return m;
  }, [poSuggs, poLines]);

  const setItemLocal = (id: number, patch: Partial<GroupItem>) =>
    setGroupItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const persist = useCallback(async (id: number, field: 'avg_monthly' | 'keep_level', value: number | null) => {
    await supabase.from('inventory_po_group_items').update({ [field]: value }).eq('id', id);
  }, []);

  if (isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-lg font-semibold text-gray-900">Inventory v4 — keep-level restock</div>
          <div className="text-xs text-gray-500">Order = keep-level − stock − already-on-order, rounded up to cartons. Names/codes follow Niagawan live.</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {balanceAsOf && <span className="text-xs text-gray-400">stock as of {new Date(balanceAsOf).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' })}</span>}
          <button onClick={updateBalances} disabled={refreshState === 'running'}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {refreshState === 'running' ? 'Updating balances…' : refreshState === 'done' ? '✓ updated' : refreshState === 'error' ? '⚠ failed' : '↻ Update balances'}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {groups.map((g) => {
        const rows = groupItems.filter((gi) => gi.group_id === g.id);
        const need = rows.filter((gi) => {
          const live = itemBySku.get(gi.sku);
          const stock = live ? live.balance : null;
          const avg = gi.avg_monthly;
          const keep = gi.keep_level ?? (avg != null ? avg * 3 : null);
          const code = live?.code ?? gi.code ?? '';
          const onOrder = code ? onOrderByCode.get(code) ?? 0 : 0;
          return keep != null && stock != null && orderQty(keep - stock - onOrder, gi.carton_size) > 0;
        }).length;

        return (
          <div key={g.id} className="mb-5 rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <div className="text-sm font-semibold text-gray-800">{g.name} <span className="font-normal text-gray-400">· {g.supplier_name ?? '—'}</span></div>
              {need > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{need} to order</span>}
            </div>
            <div className="overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Item Code</th>
                    <th className="px-3 py-2 font-semibold">Item Name</th>
                    <th className="px-3 py-2 text-right font-semibold">Stock</th>
                    <th className="px-3 py-2 text-center font-semibold" title="Average monthly units sold (3-month). Type it, or use Calculate average (coming).">Avg/mo</th>
                    <th className="px-3 py-2 text-center font-semibold" title="Stock to keep = avg × 3. Editable.">Keep-level</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Keep-level − stock − on-order, rounded up to cartons">Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No items in this card.</td></tr>
                  ) : rows.map((gi) => {
                    const live = itemBySku.get(gi.sku);
                    const code = live?.code ?? gi.code ?? '—';
                    const name = live?.descp ?? gi.descp ?? '—';
                    const stock = live ? live.balance : null;
                    const avg = gi.avg_monthly;
                    const keep = gi.keep_level ?? (avg != null ? avg * 3 : null);
                    const onOrder = code !== '—' ? onOrderByCode.get(code) ?? 0 : 0;
                    const order = keep != null && stock != null ? orderQty(keep - stock - onOrder, gi.carton_size) : null;
                    return (
                      <tr key={gi.id} className={order && order > 0 ? 'bg-rose-50' : ''}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{code}</td>
                        <td className="px-3 py-1.5 text-gray-700">{name}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{stock == null ? '—' : stock}</td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="number" min={0} step="0.1" inputMode="decimal"
                            value={gi.avg_monthly == null ? '' : gi.avg_monthly}
                            onChange={(e) => setItemLocal(gi.id, { avg_monthly: e.target.value === '' ? null : Number(e.target.value) })}
                            onBlur={(e) => { const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0); setItemLocal(gi.id, { avg_monthly: v }); persist(gi.id, 'avg_monthly', v); }}
                            placeholder="—" className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs" />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="number" min={0} step="1" inputMode="numeric"
                            value={keep == null ? '' : keep}
                            onChange={(e) => setItemLocal(gi.id, { keep_level: e.target.value === '' ? null : Number(e.target.value) })}
                            onBlur={(e) => { const v = e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)); setItemLocal(gi.id, { keep_level: v }); persist(gi.id, 'keep_level', v); }}
                            placeholder="—" className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs" />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {order == null ? <span className="text-xs text-gray-400">set avg</span>
                            : order > 0 ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{order}</span>
                            : <span className="text-xs text-emerald-600">ok</span>}
                          {onOrder > 0 && <div className="text-[10px] text-sky-600">{onOrder} on order</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <p className="mt-2 text-xs text-gray-400">Next: a 📊 “Calculate average” button (scans the last 3 months and fills Avg/mo automatically), and a “Generate PO” action.</p>
    </div>
  );
}
