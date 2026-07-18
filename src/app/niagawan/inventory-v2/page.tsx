// src/app/niagawan/inventory-v2/page.tsx
// Inventory v2 — rebuilt reorder cockpit. Same backend tables/edge pipeline as the old page;
// new layout: freshness bar, "needs your decision" inbox, a sold-recently + low worklist
// (grouped by category, with suggested qty + Order/Hold + Undo), and a tucked-away Setup area.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

type Watch = { code: string; description: string | null; min_balance: number; category: string | null; auto_po: boolean; supplier_id: string | null; supplier_name: string | null; remarks: string | null };
type Bal = { code: string; balance: number | null; checked_at: string | null; updated_at: string | null };
type Velo = { code: string; sold_7d: number | null; sold_30d: number | null; last_sold: string | null };
type Supplier = { creditor_id: string; name: string };
type PoSugg = { id: number; supplier_id: string; supplier_name: string | null; items: { code: string; desc?: string; qty: number }[]; period_from: string | null; period_to: string | null; status: string; po_number: string | null; note: string | null; updated_at: string | null };
type NewItem = { sku: string; code: string; descp: string | null; price: number | null; first_seen: string };
type Status = { code: string; status: 'on_po' | 'kiv'; note: string | null };

const fmtD = (d: string | null) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return dd ? `${dd}/${m}/${y}` : d; };
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonday = () => { const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return isoOf(d); };
const today = () => isoOf(new Date());

const CAT_ORDER = ['Oil - Mannol', 'Oil - Liquimoly', 'Oil - Gulf', 'Oil - Shell', 'Proton', 'Other'];
const CATS = [...CAT_ORDER];
function catRank(c: string) { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i; }
function guessCategory(descp: string | null): string {
  const d = (descp || '').toUpperCase();
  if (d.includes('MANNOL')) return 'Oil - Mannol';
  if (d.includes('LIQUI')) return 'Oil - Liquimoly';
  if (d.includes('GULF')) return 'Oil - Gulf';
  if (d.includes('SHELL')) return 'Oil - Shell';
  if (/(^|[^A-Z0-9])(X[ -]?70|X[ -]?50|S[ -]?70)([^0-9]|$)/.test(d)) return 'Proton';
  return 'Other';
}

type Row = {
  code: string; description: string; category: string; min: number;
  balance: number | null; sold30: number; sold7: number; lastSold: string | null;
  stock: 'low' | 'ok' | 'unsure'; po: 'on_po' | 'kiv' | null; note: string | null; remarks: string | null;
  suggest: number; supplier_id: string | null; supplier_name: string | null;
};

export default function InventoryV2Page() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [watch, setWatch] = useState<Watch[]>([]);
  const [bals, setBals] = useState<Bal[]>([]);
  const [velos, setVelos] = useState<Velo[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suggs, setSuggs] = useState<PoSugg[]>([]);
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadWarn, setLoadWarn] = useState<string | null>(null);

  const [showSlow, setShowSlow] = useState(false);   // "low but not sold recently"
  const [showProg, setShowProg] = useState(false);    // On PO + KIV
  const [showReview, setShowReview] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // transient toast / undo snackbar
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'undo'; msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((t: { kind: 'ok' | 'err' | 'undo'; msg: string; undo?: () => void }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.undo ? 7000 : 3500);
  }, []);

  const [sync, setSync] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [poScan, setPoScan] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [poScanMsg, setPoScanMsg] = useState('');
  const [scanFrom, setScanFrom] = useState(thisMonday());
  const [scanTo, setScanTo] = useState(today());
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const poPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [search, setSearch] = useState('');
  const [nCode, setNCode] = useState('');
  const [nDesc, setNDesc] = useState('');
  const [nMin, setNMin] = useState('4');
  const [nCat, setNCat] = useState('Other');
  const [editCode, setEditCode] = useState<string | null>(null);
  const [eDesc, setEDesc] = useState('');
  const [eMin, setEMin] = useState('4');
  const [eCat, setECat] = useState('Other');
  const [bulkCat, setBulkCat] = useState('Proton');
  const [bulkSup, setBulkSup] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');
  const [qtyEdits, setQtyEdits] = useState<Record<string, number>>({}); // per-code order qty override
  const [drafting, setDrafting] = useState<string | null>(null);        // category currently being drafted

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const loadStatuses = useCallback(async () => {
    const { data } = await supabase.from('niagawan_inventory_status').select('code,status,note');
    setStatuses((data ?? []) as Status[]);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true); setErr(null); setLoadWarn(null);
    const [w, b, v, s, sup, pg] = await Promise.all([
      supabase.from('niagawan_min_stock').select('code,description,min_balance,category,auto_po,supplier_id,supplier_name,remarks'),
      supabase.from('niagawan_inventory').select('code,balance,checked_at,updated_at'),
      supabase.from('niagawan_sales_velocity').select('code,sold_7d,sold_30d,last_sold'),
      supabase.from('niagawan_inventory_status').select('code,status,note'),
      supabase.from('niagawan_suppliers').select('creditor_id,name').order('name'),
      supabase.from('po_suggestions').select('id,supplier_id,supplier_name,items,period_from,period_to,status,po_number,note,updated_at').neq('status', 'rejected').or('source.is.null,source.neq.inventory-v3').order('id', { ascending: false }).limit(40),
    ]);
    if (w.error) setErr(w.error.message); else setWatch((w.data ?? []) as Watch[]);
    setBals((b.data ?? []) as Bal[]);
    setVelos((v.data ?? []) as Velo[]);
    setStatuses((s.data ?? []) as Status[]);
    setSuppliers((sup.data ?? []) as Supplier[]);
    setSuggs((pg.data ?? []) as PoSugg[]);
    // Surface secondary load failures (old page swallowed these).
    const warns: string[] = [];
    if (b.error) warns.push('stock balances'); if (v.error) warns.push('sales velocity');
    if (sup.error) warns.push('suppliers'); if (pg.error) warns.push('PO drafts'); if (s.error) warns.push('statuses');
    setLoadWarn(warns.length ? `Couldn’t load: ${warns.join(', ')}. Some sections may be incomplete.` : null);
    setLoading(false);
  }, []);

  const loadSuggs = useCallback(async () => {
    const { data } = await supabase.from('po_suggestions').select('id,supplier_id,supplier_name,items,period_from,period_to,status,po_number,note,updated_at').neq('status', 'rejected').or('source.is.null,source.neq.inventory-v3').order('id', { ascending: false }).limit(40);
    setSuggs((data ?? []) as PoSugg[]);
  }, []);
  const loadNewItems = useCallback(async () => {
    const { data } = await supabase.rpc('new_catalog_items');
    setNewItems((Array.isArray(data) ? data : []) as NewItem[]);
  }, []);
  const approveSugg = useCallback(async (id: number) => { await supabase.from('po_suggestions').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', id); await loadSuggs(); }, [loadSuggs]);
  const rejectSugg = useCallback(async (id: number) => { await supabase.from('po_suggestions').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', id); await loadSuggs(); }, [loadSuggs]);
  const dismissSugg = useCallback(async (id: number) => { await supabase.from('po_suggestions').delete().eq('id', id); await loadSuggs(); }, [loadSuggs]);

  useEffect(() => { if (!isAdmin) return; loadAll(); loadNewItems(); }, [isAdmin, loadAll, loadNewItems]);
  useVisibleInterval(loadSuggs, 12000, isAdmin);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (poPollRef.current) clearInterval(poPollRef.current); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const balByCode = useMemo(() => { const m = new Map<string, Bal>(); for (const b of bals) m.set(b.code, b); return m; }, [bals]);
  const veloByCode = useMemo(() => { const m = new Map<string, Velo>(); for (const v of velos) m.set(v.code, v); return m; }, [velos]);
  const statByCode = useMemo(() => { const m = new Map<string, Status>(); for (const s of statuses) m.set(s.code, s); return m; }, [statuses]);
  const haveVelocity = velos.length > 0; // feed populated yet?

  const rows: Row[] = useMemo(() => watch.map((w) => {
    const b = balByCode.get(w.code);
    const balance = b && b.balance != null ? Number(b.balance) : null;
    const min = w.min_balance || 0;
    let stock: Row['stock'];
    if (balance == null) stock = 'unsure';
    else if (balance <= min) stock = 'low';
    else stock = 'ok';
    const v = veloByCode.get(w.code);
    const st = statByCode.get(w.code);
    return {
      code: w.code, description: w.description || '', category: w.category || 'Other', min,
      balance, sold30: v?.sold_30d != null ? Number(v.sold_30d) : 0, sold7: v?.sold_7d != null ? Number(v.sold_7d) : 0,
      lastSold: v?.last_sold ?? null, stock, po: st?.status ?? null, note: st?.note ?? null, remarks: w.remarks ?? null,
      suggest: balance == null ? 0 : Math.max(min - balance, 0), supplier_id: w.supplier_id, supplier_name: w.supplier_name,
    };
  }), [watch, balByCode, veloByCode, statByCode]);

  const lastChecked = useMemo(() => { let t: string | null = null; for (const b of bals) if (b.updated_at && (!t || b.updated_at > t)) t = b.updated_at; return t; }, [bals]);
  const staleHours = useMemo(() => { if (!lastChecked) return null; return (Date.now() - new Date(lastChecked).getTime()) / 3.6e6; }, [lastChecked]);
  const health: 'green' | 'amber' | 'red' = staleHours == null ? 'red' : staleHours > 36 ? 'red' : staleHours > 24 ? 'amber' : 'green';

  // The reorder worklist = LOW + (sold recently, when we have velocity data), excluding KIV/on_po.
  // Until the velocity feed is populated, fall back to "all low" so the page is still useful.
  // Codes already sitting in a non-rejected PO draft (pending/approved/created) — keep them OFF
  // the worklist so nothing gets ordered twice; they show in the inbox / in-progress instead.
  const draftedCodes = useMemo(() => { const s = new Set<string>(); for (const g of suggs) for (const it of (g.items || [])) s.add(it.code); return s; }, [suggs]);
  const orderable = useMemo(() => rows.filter((r) => r.stock === 'low' && r.po == null && !draftedCodes.has(r.code)), [rows, draftedCodes]);
  const qtyFor = useCallback((r: Row) => { const v = qtyEdits[r.code]; return v != null ? v : Math.max(r.suggest, 1); }, [qtyEdits]);
  const setQty = useCallback((code: string, val: string) => { const n = Math.max(0, Math.floor(Number(val) || 0)); setQtyEdits((p) => ({ ...p, [code]: n })); }, []);
  const soldLow = useMemo(() => (haveVelocity ? orderable.filter((r) => r.sold30 > 0) : orderable), [orderable, haveVelocity]);
  const slowLow = useMemo(() => (haveVelocity ? orderable.filter((r) => r.sold30 <= 0) : []), [orderable, haveVelocity]);
  const onPoList = useMemo(() => rows.filter((r) => r.po === 'on_po').sort((a, b) => catRank(a.category) - catRank(b.category) || a.code.localeCompare(b.code)), [rows]);
  const kivList = useMemo(() => rows.filter((r) => r.po === 'kiv').sort((a, b) => catRank(a.category) - catRank(b.category) || a.code.localeCompare(b.code)), [rows]);
  const review = useMemo(() => rows.filter((r) => r.stock === 'unsure' && r.po !== 'kiv'), [rows]);

  const groups = useMemo(() => {
    const byCat = new Map<string, Row[]>();
    for (const r of soldLow) { if (!byCat.has(r.category)) byCat.set(r.category, []); byCat.get(r.category)!.push(r); }
    const cats = Array.from(byCat.keys()).sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
    return cats.map((cat) => {
      const items = byCat.get(cat)!.sort((a, b) => (b.sold30 - a.sold30) || a.code.localeCompare(b.code));
      return { cat, items };
    });
  }, [soldLow]);

  const filteredWatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? watch.filter((w) => w.code.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q)) : watch;
    return [...list].sort((a, b) => catRank(a.category || 'Other') - catRank(b.category || 'Other') || a.code.localeCompare(b.code));
  }, [watch, search]);

  // Draft a PO straight from the live worklist: group this category's items by their supplier and
  // write one pending po_suggestions row per supplier. Flows through the same approve -> NAS-create
  // path as the sales scan. Items with no supplier are skipped (set one in Setup).
  const draftCategoryPO = useCallback(async (items: Row[], cat: string) => {
    const bySup = new Map<string, { supplier_id: string; supplier_name: string | null; items: { code: string; desc: string; qty: number }[] }>();
    let noSup = 0;
    for (const r of items) {
      if (!r.supplier_id) { noSup++; continue; }
      const q = qtyFor(r); if (q <= 0) continue;
      const g = bySup.get(r.supplier_id) || { supplier_id: r.supplier_id, supplier_name: r.supplier_name, items: [] };
      g.items.push({ code: r.code, desc: r.description || r.code, qty: q });
      bySup.set(r.supplier_id, g);
    }
    if (bySup.size === 0) { flash({ kind: 'err', msg: noSup ? 'No supplier set for these — set one in Setup → Manage watchlist.' : 'Nothing to draft.' }); return; }
    setDrafting(cat);
    const t = today();
    // Tag manual drafts with a source so the auto-PO scan's (source IS NULL) purge can't delete them.
    const insertRows = [...bySup.values()].map((g) => ({ supplier_id: g.supplier_id, supplier_name: g.supplier_name, items: g.items, status: 'pending', period_from: t, period_to: t, source: 'inventory-v2' }));
    const { error } = await supabase.from('po_suggestions').insert(insertRows);
    setDrafting(null);
    if (error) { flash({ kind: 'err', msg: 'Could not draft PO: ' + error.message }); return; }
    await loadSuggs();
    flash({ kind: 'ok', msg: `Drafted ${insertRows.length} PO${insertRows.length > 1 ? 's' : ''} for ${cat} — approve in the inbox above.${noSup ? ` (${noSup} item(s) skipped — no supplier)` : ''}` });
  }, [qtyFor, flash, loadSuggs]);

  // ---- status writes (with error surfacing) ----
  const setPO = useCallback(async (code: string) => {
    const { error } = await supabase.from('niagawan_inventory_status').upsert({ code, status: 'on_po', updated_at: new Date().toISOString() }, { onConflict: 'code' });
    await loadStatuses();
    if (error) flash({ kind: 'err', msg: 'Could not mark On PO — try again.' });
    else flash({ kind: 'undo', msg: `“${code}” marked Ordered (On PO)`, undo: async () => { await supabase.from('niagawan_inventory_status').delete().eq('code', code); await loadStatuses(); } });
  }, [loadStatuses, flash]);
  const setKIV = useCallback(async (code: string) => {
    const { error } = await supabase.from('niagawan_inventory_status').upsert({ code, status: 'kiv', updated_at: new Date().toISOString() }, { onConflict: 'code' });
    await loadStatuses();
    if (error) flash({ kind: 'err', msg: 'Could not put on hold — try again.' });
    else flash({ kind: 'undo', msg: `“${code}” put on hold (KIV)`, undo: async () => { await supabase.from('niagawan_inventory_status').delete().eq('code', code); await loadStatuses(); } });
  }, [loadStatuses, flash]);
  const clearStatus = useCallback(async (code: string) => { await supabase.from('niagawan_inventory_status').delete().eq('code', code); await loadStatuses(); }, [loadStatuses]);
  const saveNote = useCallback(async (code: string, note: string) => { await supabase.from('niagawan_inventory_status').update({ note }).eq('code', code); await loadStatuses(); }, [loadStatuses]);

  const addNewToWatchlist = useCallback(async (it: NewItem) => {
    const { error } = await supabase.from('niagawan_min_stock').insert({ code: it.code, description: it.descp || null, min_balance: 4, category: guessCategory(it.descp) });
    if (error) { flash({ kind: 'err', msg: error.message }); return; }
    await Promise.all([loadAll(), loadNewItems()]);
    flash({ kind: 'ok', msg: `Added “${it.code}” to the watchlist` });
  }, [loadAll, loadNewItems, flash]);
  const dismissNewItem = useCallback(async (sku: string) => { await supabase.rpc('dismiss_new_item', { p_sku: sku }); await loadNewItems(); }, [loadNewItems]);

  const checkStockNow = useCallback(async () => {
    if (sync === 'running') return;
    setSync('running'); setSyncMsg('Starting stock check…');
    const { data, error } = await supabase.from('sync_requests').insert({ source: 'website-inventory', which: 'inventory' }).select('id').single();
    if (error || !data) { setSync('error'); setSyncMsg('Could not start: ' + (error?.message ?? 'unknown')); return; }
    const id = data.id as number;
    setSyncMsg('Checking live stock in Niagawan… ~1–2 min. You can leave this page.');
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (pollRef.current) clearInterval(pollRef.current);
        await loadAll();
        setSync(r.status === 'done' ? 'done' : 'error');
        setSyncMsg(r.status === 'done' ? 'Stock updated ✓' : 'Check ran but reported an error.');
        setTimeout(() => { setSync('idle'); setSyncMsg(''); }, 5000);
      } else if (Date.now() - started > 5 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setSync('idle'); setSyncMsg('Still running in the background — refresh in a bit.');
      }
    }, 4000);
  }, [sync, loadAll]);

  const scanCats = useMemo(() => { const s = new Set<string>(); watch.forEach((w) => { if (w.auto_po && w.supplier_id && w.category) s.add(w.category); }); return [...s].sort(); }, [watch]);
  useEffect(() => { setSelectedCats((prev) => (prev.length ? prev.filter((c) => scanCats.includes(c)) : scanCats)); }, [scanCats]);
  const toggleCat = useCallback((c: string) => { setSelectedCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])); }, []);

  const runAutoPo = useCallback(async () => {
    if (poScan === 'running') return;
    if (!scanFrom || !scanTo) { setPoScan('error'); setPoScanMsg('Pick a date range first.'); return; }
    if (scanCats.length && !selectedCats.length) { setPoScan('error'); setPoScanMsg('Tick at least one section to scan.'); return; }
    setPoScan('running'); setPoScanMsg('Starting sales scan…');
    const { data, error } = await supabase.from('sync_requests').insert({ source: 'website-inventory', which: 'autopo', from_date: scanFrom, to_date: scanTo, categories: selectedCats }).select('id').single();
    if (error || !data) { setPoScan('error'); setPoScanMsg('Could not start: ' + (error?.message ?? 'unknown')); return; }
    const id = data.id as number;
    setPoScanMsg('Scanning sales in Niagawan… ~1–2 min. Draft POs will appear in the inbox.');
    const started = Date.now();
    poPollRef.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (poPollRef.current) clearInterval(poPollRef.current);
        await loadSuggs();
        setPoScan(r.status === 'done' ? 'done' : 'error');
        setPoScanMsg(r.status === 'done' ? 'Scan complete ✓ — any draft POs are in the inbox to approve.' : 'Scan ran but reported an error.');
        setTimeout(() => { setPoScan('idle'); setPoScanMsg(''); }, 6000);
      } else if (Date.now() - started > 5 * 60 * 1000) {
        if (poPollRef.current) clearInterval(poPollRef.current);
        setPoScan('idle'); setPoScanMsg('Still running in the background — refresh in a bit.');
      }
    }, 4000);
  }, [poScan, scanFrom, scanTo, selectedCats, scanCats, loadSuggs]);

  const addItem = useCallback(async () => {
    const code = nCode.trim(); if (!code) return;
    const { error } = await supabase.from('niagawan_min_stock').insert({ code, description: nDesc.trim() || null, min_balance: Number(nMin) || 4, category: nCat });
    if (!error) { setNCode(''); setNDesc(''); setNMin('4'); setNCat('Other'); await loadAll(); flash({ kind: 'ok', msg: `Added “${code}”` }); } else setErr(error.message);
  }, [nCode, nDesc, nMin, nCat, loadAll, flash]);
  const startEdit = useCallback((w: Watch) => { setEditCode(w.code); setEDesc(w.description || ''); setEMin(String(w.min_balance || 4)); setECat(w.category || 'Other'); }, []);
  const saveEdit = useCallback(async () => {
    if (!editCode) return;
    await supabase.from('niagawan_min_stock').update({ description: eDesc.trim() || null, min_balance: Number(eMin) || 4, category: eCat, updated_at: new Date().toISOString() }).eq('code', editCode);
    setEditCode(null); await loadAll();
  }, [editCode, eDesc, eMin, eCat, loadAll]);
  const deleteItem = useCallback(async (code: string) => { await supabase.from('niagawan_min_stock').delete().eq('code', code); await loadAll(); }, [loadAll]);
  const toggleAutoPo = useCallback(async (code: string, val: boolean) => {
    setWatch((ws) => ws.map((w) => (w.code === code ? { ...w, auto_po: val } : w)));
    const { error } = await supabase.from('niagawan_min_stock').update({ auto_po: val, updated_at: new Date().toISOString() }).eq('code', code);
    if (error) { flash({ kind: 'err', msg: 'Auto-PO change didn’t save — reloading.' }); await loadAll(); }
  }, [flash, loadAll]);
  const setSupplierFor = useCallback(async (code: string, supplier_id: string) => {
    const sup = suppliers.find((s) => s.creditor_id === supplier_id) || null;
    setWatch((ws) => ws.map((w) => (w.code === code ? { ...w, supplier_id: supplier_id || null, supplier_name: sup?.name ?? null } : w)));
    const { error } = await supabase.from('niagawan_min_stock').update({ supplier_id: supplier_id || null, supplier_name: sup?.name ?? null, updated_at: new Date().toISOString() }).eq('code', code);
    if (error) { flash({ kind: 'err', msg: 'Supplier change didn’t save — reloading.' }); await loadAll(); }
  }, [suppliers, flash, loadAll]);
  const bulkAssignSupplier = useCallback(async (cat: string, supplier_id: string) => {
    const sup = suppliers.find((s) => s.creditor_id === supplier_id) || null;
    if (!sup) { setBulkMsg('Pick a supplier first.'); return; }
    const n = watch.filter((w) => w.category === cat).length;
    if (!n) { setBulkMsg(`No items in “${cat}”.`); return; }
    setBulkMsg('Updating…');
    setWatch((ws) => ws.map((w) => (w.category === cat ? { ...w, supplier_id, supplier_name: sup.name, auto_po: true } : w)));
    const { error } = await supabase.from('niagawan_min_stock').update({ supplier_id, supplier_name: sup.name, auto_po: true, updated_at: new Date().toISOString() }).eq('category', cat);
    setBulkMsg(error ? `Error: ${error.message}` : `✓ Set ${sup.name} + Auto-PO on all ${n} “${cat}” item(s) — it’s now scannable in Draft POs.`);
  }, [suppliers, watch]);
  const autoPoCount = useMemo(() => watch.filter((w) => w.auto_po).length, [watch]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking session…</div>;
  if (authed === false) return <div className="text-sm text-gray-600">Please sign in to view this page.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  const pending = suggs.filter((s) => s.status === 'pending');
  const approvedStuck = suggs.filter((s) => s.status === 'approved' && s.updated_at && (Date.now() - new Date(s.updated_at).getTime()) > 10 * 60 * 1000);
  const inboxCount = newItems.length + pending.length;
  const dot = health === 'green' ? 'bg-emerald-500' : health === 'amber' ? 'bg-amber-500' : 'bg-rose-500';

  const stockChip = (r: Row) => {
    if (r.balance == null) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">stock unknown</span>;
    const cls = r.balance <= 0 ? 'bg-rose-100 text-rose-700' : 'bg-rose-50 text-rose-600';
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{r.balance <= 0 ? 'out of stock' : `only ${r.balance} left`} · min {r.min}</span>;
  };

  return (
    <div className="pb-16">
      {/* Status bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
          <span className="font-medium text-gray-800">
            {lastChecked ? `Stock checked ${new Date(lastChecked).toLocaleString('en-MY')}` : 'No stock check yet'}
          </span>
          {health === 'amber' && <span className="text-xs text-amber-600">· over a day old</span>}
          {health === 'red' && <span className="text-xs text-rose-600">· stale — refresh</span>}
        </div>
        <button onClick={checkStockNow} disabled={sync === 'running'}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${sync === 'running' ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
          {sync === 'running' ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />Checking…</>) : '🔄 Refresh stock'}
        </button>
      </div>
      {syncMsg && (<div className={`mb-3 rounded border p-2 text-xs ${sync === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : sync === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>{syncMsg}</div>)}
      {loadWarn && <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{loadWarn}</div>}
      {err && <div className="mb-3 rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}

      {/* Needs your decision (inbox) */}
      {inboxCount > 0 && (
        <div className="mb-5 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
          <h2 className="mb-2 text-sm font-semibold text-indigo-900">📥 Needs your decision <span className="rounded-full bg-indigo-600 px-1.5 text-xs font-semibold text-white">{inboxCount}</span></h2>

          {pending.length > 0 && (
            <div className="mb-2 space-y-2">
              {suggs.filter((s) => s.status !== 'created' && s.status !== 'error' || approvedStuck.includes(s)).map((s) => (
                <div key={s.id} className="rounded-md border border-gray-200 bg-white p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-900">{s.supplier_name}
                      <span className="ml-2 text-xs font-normal text-gray-500">{(s.items || []).length} item{(s.items || []).length !== 1 ? 's' : ''}{s.period_from && s.period_from !== s.period_to ? ` · sold ${fmtD(s.period_from)}–${fmtD(s.period_to)}` : ''}</span>
                    </div>
                    <div className="whitespace-nowrap">
                      {s.status === 'pending' && (<>
                        <button onClick={() => approveSugg(s.id)} className="mr-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Order this →</button>
                        <button onClick={() => rejectSugg(s.id)} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100">Not now</button>
                      </>)}
                      {s.status === 'approved' && !approvedStuck.includes(s) && <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600"><span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500" />Creating in Niagawan…</span>}
                      {approvedStuck.includes(s) && <span className="text-xs font-medium text-amber-700">Still working — check Niagawan, or tell the owner. <button onClick={() => dismissSugg(s.id)} className="ml-1 underline">dismiss</button></span>}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{(s.items || []).map((it) => `${it.qty}× ${it.desc || it.code}`).join('  ·  ')}</div>
                </div>
              ))}
            </div>
          )}

          {newItems.length > 0 && (
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              <div className="text-xs font-medium text-indigo-900/70">🆕 New items in Niagawan — add to watchlist or dismiss</div>
              {newItems.map((it) => { const cat = guessCategory(it.descp); return (
                <div key={it.sku} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-white p-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">{it.code}{cat !== 'Other' && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">→ {cat}</span>}</div>
                    <div className="truncate text-xs text-gray-500">{it.descp}{it.price != null ? ` · RM${Number(it.price).toLocaleString('en-MY')}` : ''} · seen {fmtD(it.first_seen.slice(0, 10))}</div>
                  </div>
                  <div className="whitespace-nowrap"><button onClick={() => addNewToWatchlist(it)} className="mr-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Add</button><button onClick={() => dismissNewItem(it.sku)} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100">Dismiss</button></div>
                </div>
              ); })}
            </div>
          )}
        </div>
      )}

      {/* Reorder worklist */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Reorder {soldLow.length > 0 && <span className="text-sm font-normal text-gray-500">· {soldLow.length} to order</span>}</h2>
        {!haveVelocity && <span className="text-xs text-amber-600">sales feed pending — showing all low items</span>}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : soldLow.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          {lastChecked ? 'Nothing to reorder right now — everything that sold recently is in stock, ordered, or on hold. 🎉' : 'No stock data yet — tap “Refresh stock”.'}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.cat} className="overflow-hidden rounded-lg border border-gray-200">
              <div className="flex items-center justify-between bg-blue-50 px-3 py-2 text-sm font-semibold text-gray-800">
                <span>{g.cat} <span className="font-normal text-gray-500">· {g.items.length} to order</span></span>
                <button onClick={() => draftCategoryPO(g.items, g.cat)} disabled={drafting === g.cat} title="Create a draft PO per supplier from these items — appears in the inbox to approve" className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{drafting === g.cat ? 'Drafting…' : 'Draft PO →'}</button>
              </div>
              <div className="divide-y divide-gray-100 bg-white">
                {g.items.map((r) => (
                  <div key={r.code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">{r.description || r.code}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-400">{r.code}</span>
                        {stockChip(r)}
                        {haveVelocity && r.sold30 > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">sold {r.sold30} (30d)</span>}
                        {!r.supplier_id && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">no supplier</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <label className="flex items-center gap-1 text-[11px] text-gray-400">qty<input type="number" min={0} value={qtyFor(r)} onChange={(e) => setQty(r.code, e.target.value)} title="Order quantity for the draft PO" className="w-14 rounded border border-gray-300 px-1.5 py-1 text-right text-xs text-gray-700" /></label>
                      <button onClick={() => setPO(r.code)} title="Mark as already ordered (no PO created)" className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">✓ Ordered</button>
                      <button onClick={() => setKIV(r.code)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">⏸ Hold</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Low but not sold recently */}
      {slowLow.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowSlow((s) => !s)} className="text-xs font-medium text-gray-500 underline hover:text-gray-700">{showSlow ? 'Hide' : 'Show'} low but not sold recently ({slowLow.length})</button>
          {showSlow && (
            <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {slowLow.sort((a, b) => catRank(a.category) - catRank(b.category) || a.code.localeCompare(b.code)).map((r) => (
                <div key={r.code} className="flex items-center justify-between gap-2 border-b border-gray-50 px-3 py-1.5 last:border-0">
                  <div className="min-w-0"><span className="text-sm text-gray-700">{r.description || r.code}</span> <span className="font-mono text-xs text-gray-400">{r.code}</span></div>
                  <div className="flex items-center gap-1.5">{stockChip(r)}
                    <button onClick={() => setPO(r.code)} className="rounded border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">Ordered</button>
                    <button onClick={() => setKIV(r.code)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100">Hold</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* In progress: On PO + KIV */}
      {(onPoList.length > 0 || kivList.length > 0) && (
        <div className="mt-4">
          <button onClick={() => setShowProg((s) => !s)} className="text-xs font-medium text-gray-500 underline hover:text-gray-700">{showProg ? 'Hide' : 'Show'} in progress — {onPoList.length} ordered · {kivList.length} on hold</button>
          {showProg && (
            <div className="mt-2 space-y-3">
              {onPoList.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-blue-200 bg-white">
                  <div className="bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">Ordered / On PO ({onPoList.length})</div>
                  {onPoList.map((r) => (
                    <div key={r.code} className="flex items-center justify-between gap-2 border-b border-gray-50 px-3 py-1.5 last:border-0">
                      <div className="min-w-0"><span className="text-sm text-gray-700">{r.description || r.code}</span> <span className="font-mono text-xs text-gray-400">{r.code}</span> <span className="text-xs text-gray-400">· bal {r.balance ?? '—'}</span></div>
                      <button onClick={() => clearStatus(r.code)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100">Undo</button>
                    </div>
                  ))}
                </div>
              )}
              {kivList.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">On hold / KIV ({kivList.length})</div>
                  {kivList.map((r) => (
                    <div key={r.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-50 px-3 py-1.5 last:border-0">
                      <div className="min-w-0 flex-1"><span className="text-sm text-gray-700">{r.description || r.code}</span> <span className="font-mono text-xs text-gray-400">{r.code}</span></div>
                      <input defaultValue={r.note || ''} placeholder="why on hold? e.g. supplier out till July" onBlur={(e) => { if (e.target.value !== (r.note || '')) saveNote(r.code, e.target.value); }} className="w-48 rounded border border-gray-200 px-1.5 py-0.5 text-xs" />
                      <button onClick={() => clearStatus(r.code)} className="rounded border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50">← back to list</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Needs review (couldn't read stock) */}
      {review.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowReview((s) => !s)} className="text-xs font-medium text-amber-700 underline hover:text-amber-900">{showReview ? 'Hide' : 'Show'} couldn’t read stock ({review.length})</button>
          {showReview && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 p-2">
              <div className="mb-1 text-xs text-amber-800">The scraper couldn’t match a balance for these — usually a code that doesn’t exactly match Niagawan. Fix the code in Setup → Manage watchlist.</div>
              {review.sort((a, b) => catRank(a.category) - catRank(b.category) || a.code.localeCompare(b.code)).map((r) => (
                <div key={r.code} className="flex items-center justify-between gap-2 px-1 py-1 text-sm text-gray-600">
                  <span><span className="font-mono text-xs">{r.code}</span> · {r.description || '—'}</span>
                  <span className="text-xs text-gray-400">{r.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Setup drawer */}
      <div className="mt-8 border-t border-gray-200 pt-4">
        <button onClick={() => setShowSetup((s) => !s)} className="text-sm font-medium text-gray-500 underline hover:text-gray-800">{showSetup ? 'Hide' : '⚙ Setup'} — watchlist & draft-PO scan</button>
        {showSetup && (
          <div className="mt-3 space-y-4">
            {/* Draft POs from sales */}
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-sm font-medium text-gray-800">Draft purchase orders from sales</div>
              <div className="mt-0.5 text-xs text-gray-400">Scans what sold in a period and drafts a PO per supplier — they appear in the “Needs your decision” inbox to approve.</div>
              {scanCats.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-2 text-xs text-gray-500"><span>Sections:</span>
                    <button onClick={() => setSelectedCats(scanCats)} className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100">All</button>
                    <button onClick={() => setSelectedCats([])} className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100">None</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">{scanCats.map((c) => { const on = selectedCats.includes(c); return (<button key={c} onClick={() => toggleCat(c)} className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500'}`}>{on ? '✓ ' : ''}{c}</button>); })}</div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-500">From<br /><input type="date" value={scanFrom} onChange={(e) => setScanFrom(e.target.value)} className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm" /></label>
                <label className="text-xs text-gray-500">To<br /><input type="date" value={scanTo} onChange={(e) => setScanTo(e.target.value)} className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm" /></label>
                <button onClick={runAutoPo} disabled={poScan === 'running'} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">{poScan === 'running' ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-white" />Scanning…</>) : 'Scan sales & draft POs'}</button>
                {poScanMsg && <span className="text-xs text-gray-500">{poScanMsg}</span>}
              </div>
            </div>

            {/* Manage watchlist */}
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="mb-2 text-sm font-medium text-gray-800">Manage watchlist <span className="font-normal text-gray-400">({watch.length} items · {autoPoCount} on auto-PO)</span></div>
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
                <label className="text-xs text-gray-600">Code<input value={nCode} onChange={(e) => setNCode(e.target.value)} placeholder="e.g. MN7501-4" className="mt-1 block w-32 rounded-md border border-gray-300 px-2 py-1 text-xs" /></label>
                <label className="text-xs text-gray-600">Description<input value={nDesc} onChange={(e) => setNDesc(e.target.value)} className="mt-1 block w-56 rounded-md border border-gray-300 px-2 py-1 text-xs" /></label>
                <label className="text-xs text-gray-600">Min<input value={nMin} onChange={(e) => setNMin(e.target.value)} className="mt-1 block w-14 rounded-md border border-gray-300 px-2 py-1 text-xs" /></label>
                <label className="text-xs text-gray-600">Category<select value={nCat} onChange={(e) => setNCat(e.target.value)} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-xs">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                <button onClick={addItem} disabled={!nCode.trim()} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40">Add item</button>
              </div>
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-blue-100 bg-blue-50/60 p-2">
                <div className="w-full text-xs font-medium text-blue-900">Bulk-assign a supplier to a whole category — turns on Auto-PO for every item in it.</div>
                <label className="text-xs text-gray-600">Category<select value={bulkCat} onChange={(e) => { setBulkCat(e.target.value); setBulkMsg(''); }} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-xs">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                <label className="text-xs text-gray-600">Supplier<select value={bulkSup} onChange={(e) => { setBulkSup(e.target.value); setBulkMsg(''); }} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-xs"><option value="">— pick —</option>{suppliers.map((s) => <option key={s.creditor_id} value={s.creditor_id}>{s.name}</option>)}</select></label>
                <button onClick={() => bulkAssignSupplier(bulkCat, bulkSup)} disabled={!bulkSup} className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-40">Apply to all {watch.filter((w) => w.category === bulkCat).length} items</button>
                {bulkMsg && <span className="w-full text-xs text-gray-700">{bulkMsg}</span>}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or description…" className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1 text-xs" />
              <div className="max-h-96 overflow-y-auto rounded-md border border-gray-100">
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-left text-gray-500"><tr><th className="px-2 py-1 font-semibold">Code</th><th className="px-2 py-1 font-semibold">Description</th><th className="px-2 py-1 font-semibold">Min</th><th className="px-2 py-1 font-semibold">Category</th><th className="px-2 py-1 text-center font-semibold">Auto-PO</th><th className="px-2 py-1 font-semibold">Supplier</th><th className="px-2 py-1"></th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredWatch.map((w) => editCode === w.code ? (
                      <tr key={w.code} className="bg-amber-50">
                        <td className="whitespace-nowrap px-2 py-1 font-medium text-gray-900">{w.code}</td>
                        <td className="px-2 py-1"><input value={eDesc} onChange={(e) => setEDesc(e.target.value)} className="w-full rounded border border-gray-300 px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input value={eMin} onChange={(e) => setEMin(e.target.value)} className="w-12 rounded border border-gray-300 px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><select value={eCat} onChange={(e) => setECat(e.target.value)} className="rounded border border-gray-300 px-1 py-0.5">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                        <td className="px-2 py-1 text-center text-gray-300">—</td><td className="px-2 py-1 text-gray-300">—</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right"><button onClick={saveEdit} className="mr-1 rounded-md border border-emerald-200 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50">Save</button><button onClick={() => setEditCode(null)} className="rounded-md border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-gray-100">Cancel</button></td>
                      </tr>
                    ) : (
                      <tr key={w.code}>
                        <td className="whitespace-nowrap px-2 py-1 font-medium text-gray-900">{w.code}</td>
                        <td className="px-2 py-1 text-gray-700">{w.description}</td>
                        <td className="px-2 py-1 text-gray-500">{w.min_balance}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-gray-500">{w.category}</td>
                        <td className="px-2 py-1 text-center"><input type="checkbox" checked={w.auto_po} onChange={(e) => toggleAutoPo(w.code, e.target.checked)} className="h-3.5 w-3.5" /></td>
                        <td className="px-2 py-1"><select value={w.supplier_id || ''} onChange={(e) => setSupplierFor(w.code, e.target.value)} className={`max-w-[180px] rounded border px-1 py-0.5 ${w.auto_po && !w.supplier_id ? 'border-rose-300 bg-rose-50' : 'border-gray-300'}`}><option value="">— pick —</option>{suppliers.map((s) => <option key={s.creditor_id} value={s.creditor_id}>{s.name}</option>)}</select></td>
                        <td className="whitespace-nowrap px-2 py-1 text-right"><button onClick={() => startEdit(w)} className="mr-1 rounded-md border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-100">Edit</button><button onClick={() => deleteItem(w.code)} className="rounded-md border border-gray-200 px-2 py-0.5 text-rose-600 hover:bg-rose-50">Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast / undo snackbar */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className={`flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${toast.kind === 'err' ? 'bg-rose-600' : 'bg-gray-900'}`}>
            <span>{toast.msg}</span>
            {toast.undo && <button onClick={() => { const u = toast.undo!; setToast(null); u(); }} className="font-semibold text-amber-300 underline">Undo</button>}
          </div>
        </div>
      )}
    </div>
  );
}
