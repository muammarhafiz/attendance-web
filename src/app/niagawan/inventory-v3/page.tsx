// src/app/niagawan/inventory-v3/page.tsx
// Inventory v3 — a re-order tracker built to the owner's weekly routine.
// Step 1: each group card is bound to ONE supplier; each item carries a carton size
// and a re-order threshold; the system counts "units sold since the last reset" and
// turns a row RED (with a carton-rounded suggested order qty) once the threshold is hit.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Item = { sku: string; code: string | null; descp: string | null; balance: number | null };
type Group = { id: number; name: string; sort_order: number; creditor_id: string | null; supplier_name: string | null };
type GroupItem = {
  id: number; group_id: number; sku: string; code: string | null; descp: string | null;
  carton_size: number | null; reorder_threshold: number | null; reset_at: string; sold_baseline: number;
};
type Supplier = { creditor_id: string; name: string };
type PoSuggItem = { code: string | null; desc?: string | null; qty: number; sku?: string | null };
type PoSugg = {
  id: number; supplier_id: string; supplier_name: string | null; status: string;
  po_number: string | null; po_id: string | null; note: string | null;
  items: PoSuggItem[]; created_at: string; updated_at: string;
};
type PoLine = {
  id: number; suggestion_id: number; sku: string | null; code: string | null; descp: string | null;
  ordered_qty: number; received_qty: number;
};

// PO lifecycle: pending (staged, awaiting approval) -> approved (creating in Niagawan) -> created (has PO no).
const OPEN_STATUSES = new Set(['pending', 'approved', 'created']);

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
  const [poSuggs, setPoSuggs] = useState<PoSugg[]>([]);
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [busyPo, setBusyPo] = useState<number | null>(null);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [refreshState, setRefreshState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [balanceAsOf, setBalanceAsOf] = useState<string | null>(null);
  const refreshPoll = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const loadFreshness = useCallback(async () => {
    const { data } = await supabase.from('niagawan_inventory').select('updated_at').order('updated_at', { ascending: false }).limit(1);
    setBalanceAsOf((data && data[0]?.updated_at) ? String(data[0].updated_at) : null);
  }, []);

  const loadVelocity = useCallback(async () => {
    const { data } = await supabase.from('niagawan_sales_velocity').select('code,sold_30d');
    const m = new Map<string, number>();
    for (const r of (data ?? []) as { code: string; sold_30d: number | null }[]) {
      if (r.code) m.set(r.code, r.sold_30d != null ? Number(r.sold_30d) : 0);
    }
    setSoldByCode(m);
  }, []);

  const PO_COLS = 'id,supplier_id,supplier_name,status,po_number,po_id,note,items,created_at,updated_at';

  // Refresh suggestions only (used by the in-flight poll — does NOT touch poLines,
  // so a poll can never clobber an order-qty edit the user is mid-typing).
  const reloadSuggsOnly = useCallback(async () => {
    const { data } = await supabase
      .from('po_suggestions').select(PO_COLS)
      .eq('source', 'inventory-v3').neq('status', 'rejected')
      .order('id', { ascending: false }).limit(60);
    setPoSuggs((data ?? []) as PoSugg[]);
  }, []);

  // Refresh suggestions AND their lines (used after explicit PO actions). Lines are
  // scoped to the loaded suggestion ids so the query is bounded.
  const reloadPOs = useCallback(async () => {
    const { data: ss } = await supabase
      .from('po_suggestions').select(PO_COLS)
      .eq('source', 'inventory-v3').neq('status', 'rejected')
      .order('id', { ascending: false }).limit(60);
    const suggs = (ss ?? []) as PoSugg[];
    const ids = suggs.map((s) => s.id);
    let lines: PoLine[] = [];
    if (ids.length) {
      const { data: ls } = await supabase
        .from('inventory_po_lines')
        .select('id,suggestion_id,sku,code,descp,ordered_qty,received_qty')
        .in('suggestion_id', ids).order('id');
      lines = (ls ?? []) as PoLine[];
    }
    setPoSuggs(suggs);
    setPoLines(lines);
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
      loadFreshness();
      reloadPOs();
    }
  }, [isAdmin, loadGroups, loadGroupItems, loadSuppliers, loadVelocity, loadCatalog, loadFreshness, reloadPOs]);

  // Clean up the balance-refresh poll on unmount.
  useEffect(() => () => { if (refreshPoll.current) clearInterval(refreshPoll.current); }, []);

  // "Update balances" — refresh stock for ONLY the group-card items (fast). Queues a
  // groupbal scrape job for the NAS, polls the request row, then reloads the balances.
  const updateBalances = useCallback(async () => {
    if (refreshState === 'running') return;
    setRefreshState('running');
    const { data, error } = await supabase.from('sync_requests').insert({ source: 'inventory-v3', which: 'groupbal' }).select('id').single();
    if (error || !data) { setRefreshState('error'); window.setTimeout(() => setRefreshState('idle'), 5000); return; }
    const id = data.id as number;
    const started = Date.now();
    if (refreshPoll.current) clearInterval(refreshPoll.current);
    refreshPoll.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (refreshPoll.current) clearInterval(refreshPoll.current);
        await loadCatalog();
        await loadFreshness();
        setRefreshState(r.status === 'done' ? 'done' : 'error');
        window.setTimeout(() => setRefreshState('idle'), 5000);
      } else if (Date.now() - started > 4 * 60 * 1000) {
        if (refreshPoll.current) clearInterval(refreshPoll.current);
        setRefreshState('idle');
      }
    }, 4000);
  }, [refreshState, loadCatalog, loadFreshness]);

  // While any PO is open (being created, or on order awaiting delivery), poll so the PO number
  // and auto cross-off receipts show up. Skip the lines refresh while a qty input is focused
  // so a poll can't clobber an in-progress edit.
  const hasOpenPo = poSuggs.some((s) => s.status === 'approved' || s.status === 'created');
  useEffect(() => {
    if (!isAdmin || !hasOpenPo) return;
    const t = setInterval(() => { if (editingLine != null) reloadSuggsOnly(); else reloadPOs(); }, 12000);
    return () => clearInterval(t);
  }, [isAdmin, hasOpenPo, editingLine, reloadSuggsOnly, reloadPOs]);

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

  const linesBySugg = useMemo(() => {
    const m = new Map<number, PoLine[]>();
    for (const l of poLines) { const a = m.get(l.suggestion_id) ?? []; a.push(l); m.set(l.suggestion_id, a); }
    return m;
  }, [poLines]);

  // Codes currently on an OPEN PO (pending/approved/created) with stock still outstanding.
  // Such items show "on order" instead of red, so the same item is never ordered twice.
  const openByCode = useMemo(() => {
    const m = new Map<string, { status: string; po_number: string | null }>();
    const openIds = new Map<number, PoSugg>();
    for (const s of poSuggs) if (OPEN_STATUSES.has(s.status)) openIds.set(s.id, s);
    for (const l of poLines) {
      const s = openIds.get(l.suggestion_id);
      if (s && l.code && Number(l.received_qty) < Number(l.ordered_qty)) {
        if (!m.has(l.code)) m.set(l.code, { status: s.status, po_number: s.po_number });
      }
    }
    return m;
  }, [poSuggs, poLines]);

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

  // ----- Step 2: stage red items into a PO, approve, track -----

  // Take all ready-to-order (red, not already on order) items in a card into a new draft PO.
  const stageCardPO = useCallback(async (g: Group) => {
    if (!g.creditor_id) { window.alert('Set a supplier for this card first.'); return; }
    const cardRows = groupItems.filter((gi) => gi.group_id === g.id);
    const lines: { code: string; sku: string; descp: string; qty: number }[] = [];
    const seen = new Set<string>(); // one line per code (many skus can share a code — never double-order)
    for (const gi of cardRows) {
      const code = resolveCode(gi);
      if (!code || openByCode.has(code) || seen.has(code)) continue;
      const sold = soldByCode.get(code);
      const net = sold == null ? null : Math.max(0, sold - Number(gi.sold_baseline || 0));
      const thr = gi.reorder_threshold;
      if (!(thr != null && thr > 0 && net != null && net >= thr)) continue;
      const qty = suggestOrderQty(net, gi.carton_size);
      if (qty <= 0) continue;
      seen.add(code);
      lines.push({ code, sku: gi.sku, descp: (itemBySku.get(gi.sku)?.descp ?? gi.descp) || '', qty });
    }
    if (!lines.length) { window.alert('No items ready to order in this card.'); return; }
    setBusyPo(-g.id);
    const today = new Date().toISOString().slice(0, 10);
    const { data: sugg, error } = await supabase.from('po_suggestions').insert({
      source: 'inventory-v3', supplier_id: g.creditor_id, supplier_name: g.supplier_name,
      items: lines.map((l) => ({ code: l.code, desc: l.descp, qty: l.qty, sku: l.sku })),
      status: 'pending', period_from: today, period_to: today,
    }).select('id').single();
    if (error || !sugg) { setBusyPo(null); window.alert('Could not stage PO: ' + (error?.message ?? '')); return; }
    const lineRows = lines.map((l) => ({ suggestion_id: sugg.id, sku: l.sku, code: l.code, descp: l.descp, ordered_qty: l.qty, received_qty: 0 }));
    const { error: le } = await supabase.from('inventory_po_lines').insert(lineRows);
    if (le) {
      // Don't leave a half-built PO behind — roll the suggestion back.
      await supabase.from('po_suggestions').delete().eq('id', sugg.id);
      setBusyPo(null);
      window.alert('Could not stage PO lines: ' + le.message);
      return;
    }
    setBusyPo(null);
    await reloadPOs();
  }, [groupItems, resolveCode, openByCode, soldByCode, itemBySku, reloadPOs]);

  const setLineQtyLocal = useCallback((id: number, qty: number) => {
    setPoLines((prev) => prev.map((l) => (l.id === id ? { ...l, ordered_qty: qty } : l)));
  }, []);
  const persistLineQty = useCallback(async (id: number, qty: number) => {
    const v = Math.max(0, Math.floor(qty || 0));
    setPoLines((prev) => prev.map((l) => (l.id === id ? { ...l, ordered_qty: v } : l)));
    await supabase.from('inventory_po_lines').update({ ordered_qty: v }).eq('id', id);
  }, []);
  const removeLine = useCallback(async (id: number) => {
    await supabase.from('inventory_po_lines').delete().eq('id', id);
    await reloadPOs();
  }, [reloadPOs]);

  const cancelPO = useCallback(async (s: PoSugg) => {
    if (!window.confirm('Discard this draft PO? (the items go back to needing re-order)')) return;
    await supabase.from('po_suggestions').delete().eq('id', s.id);
    await reloadPOs();
  }, [reloadPOs]);

  // Approve: rebuild items from the (possibly edited) lines, reset the sold counter for every
  // tracked item in this PO ("submit = reset"), and flip to 'approved' so the NAS creates it.
  const approvePO = useCallback(async (s: PoSugg) => {
    const rawLines = linesBySugg.get(s.id) ?? [];
    if (!rawLines.length) { window.alert('Add at least one item first.'); return; }
    if (!window.confirm(`Approve this PO to ${s.supplier_name ?? s.supplier_id}? It will be created in Niagawan and the sold counters reset to zero.`)) return;
    setBusyPo(s.id);
    // Rebuild items from the (possibly edited) lines: clamp each qty to >=1 (never silently drop a line)
    // and merge by code (a backstop — lines are already deduped by code at stage time).
    const byCode = new Map<string, PoSuggItem>();
    for (const l of rawLines) {
      const qty = Math.max(1, Math.floor(Number(l.ordered_qty) || 1));
      const key = l.code ?? `__nosku_${l.id}`;
      const existing = byCode.get(key);
      if (existing) existing.qty = Number(existing.qty) + qty;
      else byCode.set(key, { code: l.code, desc: l.descp, qty, sku: l.sku });
    }
    const items = [...byCode.values()];
    // 1) Flip status FIRST — if this fails, no counter is touched, so the items stay orderable.
    const { error } = await supabase.from('po_suggestions').update({ items, status: 'approved', updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) { setBusyPo(null); window.alert('Could not approve: ' + error.message); return; }
    // 2) Now reset the sold counter ("submit = reset"). Best-effort: the code is on an approved PO,
    //    so it stays suppressed (on order) regardless of whether every counter write lands.
    const codes = new Set(rawLines.map((l) => l.code).filter(Boolean) as string[]);
    const reset_at = new Date().toISOString();
    const resets = groupItems.filter((gi) => { const c = resolveCode(gi); return c != null && codes.has(c); });
    for (const gi of resets) {
      const c = resolveCode(gi); const sold = c ? soldByCode.get(c) ?? 0 : 0;
      setGroupItems((prev) => prev.map((x) => (x.id === gi.id ? { ...x, sold_baseline: sold, reset_at } : x)));
      await supabase.from('inventory_po_group_items').update({ sold_baseline: sold, reset_at }).eq('id', gi.id);
    }
    setBusyPo(null);
    await reloadPOs();
  }, [linesBySugg, groupItems, resolveCode, soldByCode, reloadPOs]);

  const retryPO = useCallback(async (s: PoSugg) => {
    await supabase.from('po_suggestions').update({ status: 'approved', note: null, updated_at: new Date().toISOString() }).eq('id', s.id);
    await reloadSuggsOnly();
  }, [reloadSuggsOnly]);

  // Manual receipt (fallback for invoices keyed straight into Niagawan, which the auto
  // cross-off never sees). A DB trigger closes the PO once every line is received and
  // re-zeroes the sold counters, so the UI just records the line and reloads.
  const markLineReceived = useCallback(async (l: PoLine) => {
    await supabase.from('inventory_po_lines').update({ received_qty: l.ordered_qty }).eq('id', l.id);
    await reloadPOs();
  }, [reloadPOs]);

  const markPOReceived = useCallback(async (s: PoSugg) => {
    if (!window.confirm('Mark this whole PO as received? It will drop off the tracker.')) return;
    setBusyPo(s.id);
    for (const l of linesBySugg.get(s.id) ?? []) {
      if (Number(l.received_qty) < Number(l.ordered_qty)) {
        await supabase.from('inventory_po_lines').update({ received_qty: l.ordered_qty }).eq('id', l.id);
      }
    }
    await supabase.from('po_suggestions').update({ status: 'received', updated_at: new Date().toISOString() }).eq('id', s.id);
    setBusyPo(null);
    await reloadPOs();
  }, [linesBySugg, reloadPOs]);

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
      {/* Toolbar: refresh balances for just the items in your cards */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={updateBalances}
          disabled={refreshState === 'running'}
          title="Pull current Niagawan stock for the items in your cards (~under a minute)"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {refreshState === 'running' ? 'Updating balances…' : '↻ Update balances'}
        </button>
        {balanceAsOf && (
          <span className="text-xs text-gray-400">
            balances as of {new Date(balanceAsOf).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' })}
          </span>
        )}
        {refreshState === 'done' && <span className="text-xs text-emerald-600">updated ✓</span>}
        {refreshState === 'error' && <span className="text-xs text-rose-600">couldn’t update — try again</span>}
        {refreshState === 'running' && <span className="text-xs text-gray-400">checking live stock in Niagawan…</span>}
      </div>

      {/* READY FOR PO — staged drafts awaiting your approval */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">READY FOR PO</h2>
        {poSuggs.filter((s) => s.status === 'pending').length === 0 ? (
          <div className="text-sm text-gray-400">Nothing staged yet — when items go red, use “Add → PO” on a card.</div>
        ) : (
          <div className="space-y-3">
            {poSuggs.filter((s) => s.status === 'pending').map((s) => {
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
                      <button onClick={() => approvePO(s)} disabled={busyPo === s.id || lines.length === 0} className="rounded-md bg-emerald-600 px-3 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        {busyPo === s.id ? 'Approving…' : 'Approve → create PO'}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-auto rounded border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-gray-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Item Code</th>
                          <th className="px-3 py-2 font-semibold">Item Description</th>
                          <th className="px-3 py-2 text-center font-semibold">Order qty</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {lines.map((l) => (
                          <tr key={l.id} className="group">
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-gray-900">{l.code || '—'}</td>
                            <td className="px-3 py-1.5 text-gray-700">{l.descp || '—'}</td>
                            <td className="px-3 py-1.5 text-center">
                              <input
                                type="number" min={1} inputMode="numeric"
                                value={l.ordered_qty}
                                onFocus={() => setEditingLine(l.id)}
                                onChange={(e) => setLineQtyLocal(l.id, Math.floor(Number(e.target.value)))}
                                onBlur={(e) => { setEditingLine(null); persistLineQty(l.id, Math.max(1, Math.floor(Number(e.target.value) || 1))); }}
                                className="w-20 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs"
                              />
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
        )}
      </div>

      {/* PO TRACKER — submitted POs being created / awaiting delivery */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">PO TRACKER <span className="font-normal text-gray-400">· waiting to be received</span></h2>
        {poSuggs.filter((s) => ['approved', 'created', 'error'].includes(s.status)).length === 0 ? (
          <div className="text-sm text-gray-400">No POs in progress.</div>
        ) : (
          <div className="space-y-3">
            {poSuggs.filter((s) => ['approved', 'created', 'error'].includes(s.status)).map((s) => {
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
                      <button onClick={() => markPOReceived(s)} disabled={busyPo === s.id} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50" title="If the invoice was keyed straight into Niagawan, mark it received here">
                        Mark all received
                      </button>
                    ) : null}
                  </div>
                  {s.status === 'error' && s.note && <div className="mb-2 text-xs text-rose-600">{s.note}</div>}
                  <div className="overflow-auto rounded border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-gray-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Item Code</th>
                          <th className="px-3 py-2 font-semibold">Item Description</th>
                          <th className="px-3 py-2 text-center font-semibold">Received</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {lines.map((l) => {
                          const done = Number(l.received_qty) >= Number(l.ordered_qty);
                          return (
                            <tr key={l.id} className={done ? 'text-gray-400' : ''}>
                              <td className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{l.code || '—'}</td>
                              <td className={`px-3 py-1.5 ${done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{l.descp || '—'}</td>
                              <td className="px-3 py-1.5 text-center tabular-nums">
                                <span className={done ? 'text-emerald-600' : 'text-gray-700'}>{Number(l.received_qty)}/{Number(l.ordered_qty)}</span>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {s.status === 'created' && !done && (
                                  <button onClick={() => markLineReceived(l)} title="Mark this line received" className="rounded px-1.5 py-0.5 text-xs text-emerald-600 hover:bg-emerald-50">✓ receive</button>
                                )}
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
        )}
      </div>

      {/* SUPPLIER GROUP CARDS (each bound to one supplier; items tracked + flagged red) */}
      {groups.map((g) => {
        const rows = groupItems.filter((gi) => gi.group_id === g.id);
        // "ready to re-order" = red AND not already on an open PO.
        const redCount = rows.reduce((n, gi) => {
          const code = resolveCode(gi);
          if (!code || openByCode.has(code)) return n;
          const sold = soldByCode.get(code);
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
                {redCount > 0 && (
                  <button
                    onClick={() => stageCardPO(g)}
                    disabled={busyPo === -g.id || !g.creditor_id}
                    title={g.creditor_id ? 'Stage these into a draft PO' : 'Set a supplier first'}
                    className="rounded-md bg-rose-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    {busyPo === -g.id ? 'Adding…' : `Add ${redCount} → PO`}
                  </button>
                )}
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
                      const onOrder = code ? openByCode.get(code) : undefined;
                      const isRed = tracked && net != null && net >= thr && !onOrder;
                      const orderQty = net != null ? suggestOrderQty(net, gi.carton_size) : 0;
                      return (
                        <tr key={gi.id} className={`group ${isRed ? 'bg-rose-50' : onOrder ? 'bg-sky-50' : ''}`}>
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
                                {onOrder ? (
                                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                                    {onOrder.po_number ? `on order · ${onOrder.po_number}` : onOrder.status === 'pending' ? 'in draft PO' : 'ordering…'}
                                  </span>
                                ) : !tracked ? (
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
