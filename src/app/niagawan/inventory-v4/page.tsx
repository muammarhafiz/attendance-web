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
type PoSugg = { id: number; source: string | null; supplier_id: string | null; supplier_name: string | null; status: string; po_number: string | null; po_id: string | null; note: string | null };
type PoLine = { id: number; suggestion_id: number; sku: string | null; code: string | null; descp: string | null; ordered_qty: number; received_qty: number };
type Supplier = { creditor_id: string; name: string };

const OPEN = new Set(['pending', 'approved', 'created']);
const SHOW_CAP = 300; // catalog rows rendered at once — search to narrow
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
  const [avgFeed, setAvgFeed] = useState<Map<string, number>>(new Map()); // sku -> auto 3-mo avg
  const [avgAsOf, setAvgAsOf] = useState<string | null>(null);
  const [avgState, setAvgState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [busyPo, setBusyPo] = useState<number | null>(null);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // sku set
  const [targetGroupId, setTargetGroupId] = useState<number | ''>('');
  const [inserting, setInserting] = useState(false);
  const [search, setSearch] = useState('');
  const refreshPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const avgPoll = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Auto 3-month average feed (filled by the "Calculate average" button -> avg3mo job).
  const loadAvgFeed = useCallback(async () => {
    const { data } = await supabase.from('niagawan_group_avg').select('sku,avg_monthly,updated_at');
    const m = new Map<string, number>();
    let latest: string | null = null;
    for (const r of (data ?? []) as { sku: string; avg_monthly: number | null; updated_at: string | null }[]) {
      if (r.sku && r.avg_monthly != null) m.set(r.sku, Number(r.avg_monthly));
      if (r.updated_at && (!latest || r.updated_at > latest)) latest = r.updated_at;
    }
    setAvgFeed(m); setAvgAsOf(latest);
  }, []);

  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase.from('niagawan_suppliers').select('creditor_id,name').order('name');
    setSuppliers((data ?? []) as Supplier[]);
  }, []);

  const PO_COLS = 'id,source,supplier_id,supplier_name,status,po_number,po_id,note';
  // Open POs (any card) -> so we don't re-suggest what's already on the way.
  const reloadPOs = useCallback(async () => {
    const { data: ss } = await supabase.from('po_suggestions').select(PO_COLS)
      .in('source', ['inventory-v3', 'inventory-v4']).neq('status', 'rejected').order('id', { ascending: false }).limit(80);
    const suggs = (ss ?? []) as PoSugg[];
    const ids = suggs.filter((s) => OPEN.has(s.status)).map((s) => s.id);
    let lines: PoLine[] = [];
    if (ids.length) {
      const { data: ls } = await supabase.from('inventory_po_lines').select('id,suggestion_id,sku,code,descp,ordered_qty,received_qty').in('suggestion_id', ids);
      lines = (ls ?? []) as PoLine[];
    }
    setPoSuggs(suggs); setPoLines(lines);
  }, []);
  // Suggestions only (used by the in-flight poll so it never clobbers a mid-edit qty).
  const reloadSuggsOnly = useCallback(async () => {
    const { data } = await supabase.from('po_suggestions').select(PO_COLS)
      .in('source', ['inventory-v3', 'inventory-v4']).neq('status', 'rejected').order('id', { ascending: false }).limit(80);
    setPoSuggs((data ?? []) as PoSugg[]);
  }, []);

  useEffect(() => {
    if (isAdmin) { loadGroups(); loadGroupItems(); loadCatalog(); loadFreshness(); loadAvgFeed(); loadSuppliers(); reloadPOs(); }
  }, [isAdmin, loadGroups, loadGroupItems, loadCatalog, loadFreshness, loadAvgFeed, loadSuppliers, reloadPOs]);

  useEffect(() => () => { if (refreshPoll.current) clearInterval(refreshPoll.current); if (avgPoll.current) clearInterval(avgPoll.current); }, []);

  // "Calculate average" — scans the last 3 months of sales (NAS avg3mo job) and fills Avg/mo.
  const calcAverage = useCallback(async () => {
    if (avgState === 'running') return;
    setAvgState('running');
    const { data, error } = await supabase.from('sync_requests').insert({ source: 'inventory-v4', which: 'avg3mo' }).select('id').single();
    if (error || !data) { setAvgState('error'); window.setTimeout(() => setAvgState('idle'), 5000); return; }
    const id = data.id as number;
    const started = Date.now();
    if (avgPoll.current) clearInterval(avgPoll.current);
    avgPoll.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (avgPoll.current) clearInterval(avgPoll.current);
        await loadAvgFeed(); await loadGroupItems();
        setAvgState(r.status === 'done' ? 'done' : 'error');
        window.setTimeout(() => setAvgState('idle'), 6000);
      } else if (Date.now() - started > 9 * 60 * 1000) { if (avgPoll.current) clearInterval(avgPoll.current); setAvgState('idle'); }
    }, 5000);
  }, [avgState, loadAvgFeed, loadGroupItems]);

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

  const linesBySugg = useMemo(() => {
    const m = new Map<number, PoLine[]>();
    for (const l of poLines) { const arr = m.get(l.suggestion_id) ?? []; arr.push(l); m.set(l.suggestion_id, arr); }
    return m;
  }, [poLines]);

  // While a v4 PO is being created / awaiting delivery, poll so its PO number + receipts show up.
  const hasOpenPo = poSuggs.some((s) => s.source === 'inventory-v4' && (s.status === 'approved' || s.status === 'created'));
  useEffect(() => {
    if (!isAdmin || !hasOpenPo) return;
    const t = setInterval(() => { if (editingLine != null) reloadSuggsOnly(); else reloadPOs(); }, 12000);
    return () => clearInterval(t);
  }, [isAdmin, hasOpenPo, editingLine, reloadSuggsOnly, reloadPOs]);

  // ---------------- Purchase orders ----------------
  // Stage a draft PO from a card's red rows (one line per code, skip what's already on order).
  const stageCardPO = useCallback(async (g: Group) => {
    if (!g.creditor_id) { window.alert('This card has no supplier set.'); return; }
    const lines: { code: string; sku: string; descp: string; qty: number }[] = [];
    const seen = new Set<string>();
    for (const gi of groupItems.filter((x) => x.group_id === g.id)) {
      const live = itemBySku.get(gi.sku);
      const code = live?.code ?? gi.code ?? null;
      if (!code || seen.has(code) || (onOrderByCode.get(code) ?? 0) > 0) continue;
      const stock = live ? live.balance : null;
      const avg = gi.avg_monthly ?? avgFeed.get(gi.sku) ?? null;
      const keep = gi.keep_level ?? (avg != null ? avg * 3 : null);
      if (keep == null || stock == null) continue;
      const qty = orderQty(keep - stock - (onOrderByCode.get(code) ?? 0), gi.carton_size);
      if (qty <= 0) continue;
      seen.add(code);
      lines.push({ code, sku: gi.sku, descp: (live?.descp ?? gi.descp) || '', qty });
    }
    if (!lines.length) { window.alert('Nothing to order in this card.'); return; }
    setBusyPo(-g.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data: sugg, error } = await supabase.from('po_suggestions').insert({
      source: 'inventory-v4', supplier_id: g.creditor_id, supplier_name: g.supplier_name,
      items: lines.map((l) => ({ code: l.code, desc: l.descp, qty: l.qty, sku: l.sku })),
      status: 'pending', period_from: today, period_to: today,
    }).select('id').single();
    if (error || !sugg) { setBusyPo(null); window.alert('Could not stage PO: ' + (error?.message ?? '')); return; }
    const lineRows = lines.map((l) => ({ suggestion_id: sugg.id, sku: l.sku, code: l.code, descp: l.descp, ordered_qty: l.qty, received_qty: 0 }));
    const { error: le } = await supabase.from('inventory_po_lines').insert(lineRows);
    if (le) { await supabase.from('po_suggestions').delete().eq('id', sugg.id); setBusyPo(null); window.alert('Could not stage lines: ' + le.message); return; }
    setBusyPo(null);
    await reloadPOs();
  }, [groupItems, itemBySku, avgFeed, onOrderByCode, reloadPOs]);

  // Remove a PO entirely (a mistake, a test, or one deleted in Niagawan). Doesn't touch Niagawan.
  const cancelPO = useCallback(async (s: PoSugg) => {
    if (!window.confirm('Remove this PO? The items go back to needing re-order. (This does not touch Niagawan.)')) return;
    await supabase.from('inventory_po_lines').delete().eq('suggestion_id', s.id);
    await supabase.from('po_suggestions').delete().eq('id', s.id);
    await reloadPOs();
  }, [reloadPOs]);

  const setLineQtyLocal = useCallback((id: number, qty: number) => {
    setPoLines((prev) => prev.map((l) => (l.id === id ? { ...l, ordered_qty: qty } : l)));
  }, []);
  const persistLineQty = useCallback(async (id: number, qty: number) => {
    const v = Math.max(1, Math.floor(qty || 1));
    setPoLines((prev) => prev.map((l) => (l.id === id ? { ...l, ordered_qty: v } : l)));
    await supabase.from('inventory_po_lines').update({ ordered_qty: v }).eq('id', id);
  }, []);
  const removeLine = useCallback(async (id: number) => {
    await supabase.from('inventory_po_lines').delete().eq('id', id);
    await reloadPOs();
  }, [reloadPOs]);

  // Approve -> the NAS pollApproved() picks it up (~20s) and creates the PO in Niagawan.
  const approvePO = useCallback(async (s: PoSugg) => {
    const rawLines = poLines.filter((l) => l.suggestion_id === s.id);
    if (!rawLines.length) { window.alert('Add at least one item first.'); return; }
    if (!window.confirm(`Approve this PO to ${s.supplier_name ?? s.supplier_id}? It will be created in Niagawan.`)) return;
    setBusyPo(s.id);
    const byCode = new Map<string, { code: string | null; desc: string | null; qty: number; sku: string | null }>();
    for (const l of rawLines) {
      const qty = Math.max(1, Math.floor(Number(l.ordered_qty) || 1));
      const key = l.code ?? `__n_${l.id}`;
      const ex = byCode.get(key);
      if (ex) ex.qty += qty; else byCode.set(key, { code: l.code, desc: l.descp, qty, sku: l.sku });
    }
    const items = [...byCode.values()];
    const { error } = await supabase.from('po_suggestions').update({ items, status: 'approved', updated_at: new Date().toISOString() }).eq('id', s.id);
    setBusyPo(null);
    if (error) { window.alert('Could not approve: ' + error.message); return; }
    await reloadPOs();
  }, [poLines, reloadPOs]);

  const retryPO = useCallback(async (s: PoSugg) => {
    await supabase.from('po_suggestions').update({ status: 'approved', note: null, updated_at: new Date().toISOString() }).eq('id', s.id);
    await reloadSuggsOnly();
  }, [reloadSuggsOnly]);

  // Partial receipt: type the actual quantity received on a line (clamped 0..ordered).
  const setLineReceivedLocal = useCallback((id: number, qty: number) => {
    setPoLines((prev) => prev.map((l) => (l.id === id ? { ...l, received_qty: qty } : l)));
  }, []);
  const persistLineReceived = useCallback(async (id: number, qty: number, ordered: number) => {
    const v = Math.max(0, Math.min(Math.floor(qty || 0), Math.floor(ordered || 0)));
    setPoLines((prev) => prev.map((l) => (l.id === id ? { ...l, received_qty: v } : l)));
    await supabase.from('inventory_po_lines').update({ received_qty: v }).eq('id', id);
  }, []);

  // Close a PO with whatever was received (a short delivery that won't be completed) — the
  // shortfall becomes re-orderable next cycle since stock stays below keep-level.
  const closePO = useCallback(async (s: PoSugg) => {
    if (!window.confirm('Close this PO with the received amounts as entered? Any shortfall goes back to needing re-order.')) return;
    setBusyPo(s.id);
    await supabase.from('po_suggestions').update({ status: 'received', updated_at: new Date().toISOString() }).eq('id', s.id);
    setBusyPo(null);
    await reloadPOs();
  }, [reloadPOs]);

  // Manual full receipt (a DB trigger closes the PO once every line is received).
  const markLineReceived = useCallback(async (l: PoLine) => {
    await supabase.from('inventory_po_lines').update({ received_qty: l.ordered_qty }).eq('id', l.id);
    await reloadPOs();
  }, [reloadPOs]);
  const markPOReceived = useCallback(async (s: PoSugg) => {
    if (!window.confirm('Mark this whole PO as received? It will drop off the tracker.')) return;
    setBusyPo(s.id);
    for (const l of poLines.filter((x) => x.suggestion_id === s.id)) {
      if (Number(l.received_qty) < Number(l.ordered_qty)) await supabase.from('inventory_po_lines').update({ received_qty: l.ordered_qty }).eq('id', l.id);
    }
    await supabase.from('po_suggestions').update({ status: 'received', updated_at: new Date().toISOString() }).eq('id', s.id);
    setBusyPo(null);
    await reloadPOs();
  }, [poLines, reloadPOs]);

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

  const setItemLocal = (id: number, patch: Partial<GroupItem>) =>
    setGroupItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const persist = useCallback(async (id: number, field: 'avg_monthly' | 'keep_level', value: number | null) => {
    await supabase.from('inventory_po_group_items').update({ [field]: value }).eq('id', id);
  }, []);

  // ---------------- Group cards (add / delete / bind supplier / remove item) ----------------
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

  // ---------------- Inventory list card (search / select / insert into a card) ----------------
  // Token search: uppercase, every whitespace-split token must appear in "code descp".
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return items;
    const tokens = q.split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      const hay = ((it.code || '') + ' ' + (it.descp || '')).toUpperCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [items, search]);
  const shown = filtered.slice(0, SHOW_CAP);

  // A new search is a new context — clear selection so Insert only ever writes visible rows.
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
          <button onClick={calcAverage} disabled={avgState === 'running'} title="Scan the last 3 months of sales and fill Avg/mo (takes a few minutes)"
            className="rounded-md border border-blue-600 bg-blue-50 px-2.5 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
            {avgState === 'running' ? 'Calculating…' : avgState === 'done' ? '✓ done' : avgState === 'error' ? '⚠ failed' : '📊 Calculate average'}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {groups.map((g) => {
        const rows = groupItems.filter((gi) => gi.group_id === g.id);
        const need = rows.filter((gi) => {
          const live = itemBySku.get(gi.sku);
          const stock = live ? live.balance : null;
          const avg = gi.avg_monthly ?? avgFeed.get(gi.sku) ?? null;
          const keep = gi.keep_level ?? (avg != null ? avg * 3 : null);
          const code = live?.code ?? gi.code ?? '';
          const onOrder = code ? onOrderByCode.get(code) ?? 0 : 0;
          return keep != null && stock != null && orderQty(keep - stock - onOrder, gi.carton_size) > 0;
        }).length;

        return (
          <div key={g.id} className="mb-5 rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-gray-800">{g.name}</div>
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
              <div className="flex items-center gap-2">
                {need > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{need} to order</span>}
                {need > 0 && <button onClick={() => stageCardPO(g)} disabled={busyPo === -g.id}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busyPo === -g.id ? 'Staging…' : 'Generate PO →'}</button>}
              </div>
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
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No items in this card.</td></tr>
                  ) : rows.map((gi) => {
                    const live = itemBySku.get(gi.sku);
                    const code = live?.code ?? gi.code ?? '—';
                    const name = live?.descp ?? gi.descp ?? '—';
                    const stock = live ? live.balance : null;
                    const feedAvg = avgFeed.get(gi.sku) ?? null;
                    const avg = gi.avg_monthly ?? feedAvg;                          // typed override wins over the feed
                    const keepDefault = avg != null ? Math.round(avg * 3) : null;    // avg × 3
                    const keep = gi.keep_level ?? keepDefault;
                    const onOrder = code !== '—' ? onOrderByCode.get(code) ?? 0 : 0;
                    const order = keep != null && stock != null ? orderQty(keep - stock - onOrder, gi.carton_size) : null;
                    return (
                      <tr key={gi.id} className={`group ${order && order > 0 ? 'bg-rose-50' : ''}`}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{code}</td>
                        <td className="px-3 py-1.5 text-gray-700">{name}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">{stock == null ? '—' : stock}</td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="number" min={0} step="0.1" inputMode="decimal"
                            value={gi.avg_monthly == null ? '' : gi.avg_monthly}
                            onChange={(e) => setItemLocal(gi.id, { avg_monthly: e.target.value === '' ? null : Number(e.target.value) })}
                            onBlur={(e) => { const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0); setItemLocal(gi.id, { avg_monthly: v }); persist(gi.id, 'avg_monthly', v); }}
                            placeholder={feedAvg != null ? String(feedAvg) : '—'} className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs" />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="number" min={0} step="1" inputMode="numeric"
                            value={gi.keep_level == null ? '' : gi.keep_level}
                            onChange={(e) => setItemLocal(gi.id, { keep_level: e.target.value === '' ? null : Number(e.target.value) })}
                            onBlur={(e) => { const v = e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)); setItemLocal(gi.id, { keep_level: v }); persist(gi.id, 'keep_level', v); }}
                            placeholder={keepDefault != null ? String(keepDefault) : '—'} className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs" />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {order == null ? <span className="text-xs text-gray-400">set avg</span>
                            : order > 0 ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">{order}</span>
                            : <span className="text-xs text-emerald-600">ok</span>}
                          {onOrder > 0 && <div className="text-[10px] text-sky-600">{onOrder} on order</div>}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button onClick={() => removeGroupItem(gi.id)} title="Remove from this card" className="rounded px-1 text-xs text-rose-400 opacity-40 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">✕</button>
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

      {/* Add a new group card */}
      <button onClick={addGroup} className="mb-5 w-full rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
        + Add a new card
      </button>

      {/* READY FOR PO — staged drafts awaiting approval */}
      {poSuggs.some((s) => s.source === 'inventory-v4' && s.status === 'pending') && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">Ready for PO <span className="font-normal text-gray-400">· review the quantities, then approve</span></h2>
          <div className="space-y-3">
            {poSuggs.filter((s) => s.source === 'inventory-v4' && s.status === 'pending').map((s) => {
              const lines = linesBySugg.get(s.id) ?? [];
              const totalUnits = lines.reduce((n, l) => n + Number(l.ordered_qty || 0), 0);
              return (
                <div key={s.id} className="rounded-md border border-gray-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-800">{s.supplier_name ?? s.supplier_id}
                      <span className="ml-1 text-xs font-normal text-gray-400">· {lines.length} item{lines.length === 1 ? '' : 's'} · {totalUnits} unit{totalUnits === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => cancelPO(s)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">Discard</button>
                      <button onClick={() => approvePO(s)} disabled={busyPo === s.id || lines.length === 0}
                        className="rounded-md bg-emerald-600 px-3 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        {busyPo === s.id ? 'Approving…' : 'Approve → create PO'}</button>
                    </div>
                  </div>
                  <div className="overflow-auto rounded border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-gray-600"><tr>
                        <th className="px-3 py-2 font-semibold">Item Code</th><th className="px-3 py-2 font-semibold">Item Name</th>
                        <th className="px-3 py-2 text-center font-semibold">Order qty</th><th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {lines.map((l) => (
                          <tr key={l.id} className="group">
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{l.code || '—'}</td>
                            <td className="px-3 py-1.5 text-gray-700">{l.descp || '—'}</td>
                            <td className="px-3 py-1.5 text-center">
                              <input type="number" min={1} inputMode="numeric" value={l.ordered_qty}
                                onFocus={() => setEditingLine(l.id)}
                                onChange={(e) => setLineQtyLocal(l.id, Math.floor(Number(e.target.value)))}
                                onBlur={(e) => { setEditingLine(null); persistLineQty(l.id, Math.max(1, Math.floor(Number(e.target.value) || 1))); }}
                                className="w-20 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs" />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <button onClick={() => removeLine(l.id)} title="Remove this line" className="rounded px-1 text-xs text-rose-400 opacity-40 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PO TRACKER — submitted POs being created / awaiting delivery */}
      {poSuggs.some((s) => s.source === 'inventory-v4' && ['approved', 'created', 'error'].includes(s.status)) && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">PO tracker <span className="font-normal text-gray-400">· creating / awaiting delivery</span></h2>
          <div className="space-y-3">
            {poSuggs.filter((s) => s.source === 'inventory-v4' && ['approved', 'created', 'error'].includes(s.status)).map((s) => {
              const lines = linesBySugg.get(s.id) ?? [];
              const doneCount = lines.filter((l) => Number(l.received_qty) >= Number(l.ordered_qty)).length;
              return (
                <div key={s.id} className="rounded-md border border-gray-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800">
                      {s.status === 'created' && s.po_number ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{s.po_number}</span>
                      ) : s.status === 'approved' ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">creating in Niagawan…</span>
                      ) : (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">failed</span>
                      )}
                      <span>{s.supplier_name ?? s.supplier_id}</span>
                      <span className="text-xs font-normal text-gray-400">· {doneCount}/{lines.length} received</span>
                    </div>
                    {s.status === 'error' ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => retryPO(s)} className="rounded-md bg-amber-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-amber-700">Retry</button>
                        <button onClick={() => cancelPO(s)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50">Discard</button>
                      </div>
                    ) : s.status === 'created' ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => markPOReceived(s)} disabled={busyPo === s.id} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" title="Everything arrived — mark every line fully received and close">✓ All arrived</button>
                        <button onClick={() => closePO(s)} disabled={busyPo === s.id} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50" title="Short delivery that won't be completed — close with the amounts received; the shortfall becomes re-orderable">Close (short)</button>
                        <button onClick={() => cancelPO(s)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50" title="Remove this PO (a mistake, a test, or one deleted in Niagawan). Does not touch Niagawan.">✕ Discard</button>
                      </div>
                    ) : null}
                  </div>
                  {s.status === 'error' && s.note && <div className="mb-2 text-xs text-rose-600">{s.note}</div>}
                  <div className="overflow-auto rounded border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-gray-600"><tr>
                        <th className="px-3 py-2 font-semibold">Item Code</th><th className="px-3 py-2 font-semibold">Item Name</th>
                        <th className="px-3 py-2 text-center font-semibold">Received</th><th className="px-3 py-2"></th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {lines.map((l) => {
                          const done = Number(l.received_qty) >= Number(l.ordered_qty);
                          return (
                            <tr key={l.id} className={done ? 'text-gray-400' : ''}>
                              <td className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{l.code || '—'}</td>
                              <td className={`px-3 py-1.5 ${done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{l.descp || '—'}</td>
                              <td className="px-3 py-1.5 text-center tabular-nums">
                                {s.status === 'created' ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input type="number" min={0} max={Number(l.ordered_qty)} inputMode="numeric"
                                      value={Number(l.received_qty)}
                                      onFocus={() => setEditingLine(l.id)}
                                      onChange={(e) => setLineReceivedLocal(l.id, Math.floor(Number(e.target.value)))}
                                      onBlur={(e) => { setEditingLine(null); persistLineReceived(l.id, Number(e.target.value), Number(l.ordered_qty)); }}
                                      className="w-14 rounded border border-gray-200 px-1 py-0.5 text-center text-xs" />
                                    <span className="text-xs text-gray-400">/ {Number(l.ordered_qty)}</span>
                                  </span>
                                ) : (
                                  <span className={done ? 'text-emerald-600' : 'text-gray-700'}>{Number(l.received_qty)}/{Number(l.ordered_qty)}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {s.status === 'created' && !done && <button onClick={() => markLineReceived(l)} title="This line fully received" className="rounded px-1.5 py-0.5 text-xs text-emerald-600 hover:bg-emerald-50">✓ full</button>}
                                {done && <span className="text-xs text-emerald-600">✓</span>}
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
          </div>
        </div>
      )}

      {/* INVENTORY LIST CARD — search the full catalog and add rows into a group card */}
      <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
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
                {groups.length === 0 && <option value="" disabled>No cards yet — add one above</option>}
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <button
                onClick={insertSelected}
                disabled={!targetGroupId || inserting}
                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inserting ? 'Inserting…' : (() => { const n = groups.find((g) => g.id === targetGroupId)?.name; return n ? `Insert → ${n}` : 'Insert'; })()}
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

      <p className="mt-2 text-xs text-gray-400">
        Avg/mo auto-fills from 📊 Calculate average (scans the last 3 months of sales){avgAsOf ? ` · updated ${new Date(avgAsOf).toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}` : ''}; type over any oil to override, Keep-level defaults to avg×3. “Generate PO →” on a card stages a draft; approve it and the NAS creates the PO in Niagawan.
      </p>
    </div>
  );
}
