// src/app/niagawan/inventory/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

type Watch = { code: string; description: string | null; min_balance: number; category: string | null; auto_po: boolean; supplier_id: string | null; supplier_name: string | null; remarks: string | null };
type Bal = { code: string; balance: number | null; suppliers: number | null; checked_at: string | null; updated_at: string | null };
type Supplier = { creditor_id: string; name: string };
type PoSugg = { id: number; supplier_id: string; supplier_name: string | null; items: { code: string; desc?: string; qty: number }[]; period_from: string | null; period_to: string | null; status: string; po_number: string | null; note: string | null };
type NewItem = { sku: string; code: string; descp: string | null; price: number | null; first_seen: string };
const fmtD = (d: string | null) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return dd ? `${dd}/${m}/${y}` : d; };
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonday = () => { const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return isoOf(d); };
const today = () => isoOf(new Date());
type Status = { code: string; status: 'on_po' | 'kiv'; note: string | null };

type Row = {
  code: string;
  description: string;
  category: string;
  min: number;
  balance: number | null;
  updated_at: string | null;
  stock: 'low' | 'ok' | 'unsure';
  po: 'on_po' | 'kiv' | null;
  note: string | null;
  remarks: string | null;
};

const CAT_ORDER = ['Oil - Mannol', 'Oil - Liquimoly', 'Oil - Gulf', 'Oil - Shell', 'Proton', 'Other'];
const CATS = [...CAT_ORDER];
function catRank(c: string) { const i = CAT_ORDER.indexOf(c); return i < 0 ? CAT_ORDER.length : i; }
// Best-guess category for a new catalog item from its description.
// Oil brands are checked first: oil descriptions sometimes name an example vehicle
// (e.g. "MANNOL ATF Multivehicle 1l eg. X70cbu") and the brand must win over the model.
function guessCategory(descp: string | null): string {
  const d = (descp || '').toUpperCase();
  if (d.includes('MANNOL')) return 'Oil - Mannol';
  if (d.includes('LIQUI')) return 'Oil - Liquimoly';
  if (d.includes('GULF')) return 'Oil - Gulf';
  if (d.includes('SHELL')) return 'Oil - Shell';
  if (/(^|[^A-Z0-9])(X[ -]?70|X[ -]?50|S[ -]?70)([^0-9]|$)/.test(d)) return 'Proton';
  return 'Other';
}

export default function NiagawanInventoryPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [watch, setWatch] = useState<Watch[]>([]);
  const [bals, setBals] = useState<Bal[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suggs, setSuggs] = useState<PoSugg[]>([]);
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'low' | 'all'>('low');
  const [showReview, setShowReview] = useState(false);
  const [showKiv, setShowKiv] = useState(false);
  const [showManage, setShowManage] = useState(false);

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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  const loadStatuses = useCallback(async () => {
    const { data } = await supabase.from('niagawan_inventory_status').select('code,status,note');
    setStatuses((data ?? []) as Status[]);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [w, b, s, sup, pg] = await Promise.all([
      supabase.from('niagawan_min_stock').select('code,description,min_balance,category,auto_po,supplier_id,supplier_name,remarks'),
      supabase.from('niagawan_inventory').select('code,balance,suppliers,checked_at,updated_at'),
      supabase.from('niagawan_inventory_status').select('code,status,note'),
      supabase.from('niagawan_suppliers').select('creditor_id,name').order('name'),
      supabase.from('po_suggestions').select('id,supplier_id,supplier_name,items,period_from,period_to,status,po_number,note').neq('status', 'rejected').order('id', { ascending: false }).limit(30),
    ]);
    if (w.error) setErr(w.error.message);
    else setWatch((w.data ?? []) as Watch[]);
    setBals((b.data ?? []) as Bal[]);
    setStatuses((s.data ?? []) as Status[]);
    setSuppliers((sup.data ?? []) as Supplier[]);
    setSuggs((pg.data ?? []) as PoSugg[]);
    setLoading(false);
  }, []);

  const loadSuggs = useCallback(async () => {
    const { data } = await supabase.from('po_suggestions').select('id,supplier_id,supplier_name,items,period_from,period_to,status,po_number,note').neq('status', 'rejected').order('id', { ascending: false }).limit(30);
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
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (poPollRef.current) clearInterval(poPollRef.current); }, []);

  const balByCode = useMemo(() => { const m = new Map<string, Bal>(); for (const b of bals) m.set(b.code, b); return m; }, [bals]);
  const statByCode = useMemo(() => { const m = new Map<string, Status>(); for (const s of statuses) m.set(s.code, s); return m; }, [statuses]);

  const rows: Row[] = useMemo(() => {
    return watch.map((w) => {
      const b = balByCode.get(w.code);
      const balance = b && b.balance != null ? Number(b.balance) : null;
      let stock: Row['stock'];
      if (balance == null) stock = 'unsure';
      else if (balance <= (w.min_balance || 0)) stock = 'low';
      else stock = 'ok';
      const st = statByCode.get(w.code);
      return {
        code: w.code,
        description: w.description || '',
        category: w.category || 'Other',
        min: w.min_balance || 0,
        balance,
        updated_at: b?.updated_at ?? null,
        stock,
        po: st?.status ?? null,
        note: st?.note ?? null,
        remarks: w.remarks ?? null,
      };
    });
  }, [watch, balByCode, statByCode]);

  const lastChecked = useMemo(() => {
    let t: string | null = null;
    for (const b of bals) if (b.updated_at && (!t || b.updated_at > t)) t = b.updated_at;
    return t ? new Date(t).toLocaleString('en-MY') : '—';
  }, [bals]);

  const stats = useMemo(() => {
    let toOrder = 0, onPo = 0, kiv = 0, review = 0;
    for (const r of rows) {
      if (r.po === 'kiv') { kiv++; continue; }
      if (r.stock === 'unsure') { review++; continue; }
      if (r.stock === 'low') { if (r.po === 'on_po') onPo++; else toOrder++; }
    }
    return { toOrder, onPo, kiv, review };
  }, [rows]);

  // Reorder list: low (or all) items, excluding KIV.
  const groups = useMemo(() => {
    const visible = rows.filter((r) => r.po !== 'kiv' && r.stock !== 'unsure' && (filter === 'all' || r.stock === 'low'));
    const byCat = new Map<string, Row[]>();
    for (const r of visible) { if (!byCat.has(r.category)) byCat.set(r.category, []); byCat.get(r.category)!.push(r); }
    const cats = Array.from(byCat.keys()).sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
    return cats.map((cat) => {
      const items = byCat.get(cat)!;
      items.sort((a, b) => {
        const ar = a.stock === 'low' && a.po !== 'on_po' ? 0 : a.po === 'on_po' ? 1 : 2;
        const br = b.stock === 'low' && b.po !== 'on_po' ? 0 : b.po === 'on_po' ? 1 : 2;
        if (ar !== br) return ar - br;
        return a.code.localeCompare(b.code);
      });
      const lowCount = items.filter((r) => r.stock === 'low' && r.po !== 'on_po').length;
      return { cat, items, lowCount };
    });
  }, [rows, filter]);

  const review = useMemo(() => rows.filter((r) => r.stock === 'unsure' && r.po !== 'kiv'), [rows]);
  const kivList = useMemo(() => rows.filter((r) => r.po === 'kiv').sort((a, b) => catRank(a.category) - catRank(b.category) || a.code.localeCompare(b.code)), [rows]);

  const filteredWatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? watch.filter((w) => w.code.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q)) : watch;
    return [...list].sort((a, b) => catRank(a.category || 'Other') - catRank(b.category || 'Other') || a.code.localeCompare(b.code));
  }, [watch, search]);

  // --- purchasing status writes ---
  const setPO = useCallback(async (code: string) => {
    await supabase.from('niagawan_inventory_status').upsert({ code, status: 'on_po', updated_at: new Date().toISOString() }, { onConflict: 'code' });
    await loadStatuses();
  }, [loadStatuses]);
  const setKIV = useCallback(async (code: string) => {
    await supabase.from('niagawan_inventory_status').upsert({ code, status: 'kiv', updated_at: new Date().toISOString() }, { onConflict: 'code' });
    await loadStatuses();
  }, [loadStatuses]);
  const clearStatus = useCallback(async (code: string) => {
    await supabase.from('niagawan_inventory_status').delete().eq('code', code);
    await loadStatuses();
  }, [loadStatuses]);
  const saveNote = useCallback(async (code: string, note: string) => {
    await supabase.from('niagawan_inventory_status').update({ note }).eq('code', code);
    await loadStatuses();
  }, [loadStatuses]);

  const saveRemarks = useCallback(async (code: string, remarks: string) => {
    setWatch((ws) => ws.map((w) => (w.code === code ? { ...w, remarks } : w)));
    await supabase.from('niagawan_min_stock').update({ remarks: remarks || null, updated_at: new Date().toISOString() }).eq('code', code);
  }, []);
  const addNewToWatchlist = useCallback(async (it: NewItem) => {
    await supabase.from('niagawan_min_stock').insert({ code: it.code, description: it.descp || null, min_balance: 4, category: guessCategory(it.descp) });
    await Promise.all([loadAll(), loadNewItems()]);
  }, [loadAll, loadNewItems]);
  const dismissNewItem = useCallback(async (sku: string) => {
    await supabase.rpc('dismiss_new_item', { p_sku: sku });
    await loadNewItems();
  }, [loadNewItems]);

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

  // Sections that can actually produce a PO = have auto-PO items WITH a supplier assigned.
  const scanCats = useMemo(() => {
    const s = new Set<string>();
    watch.forEach((w) => { if (w.auto_po && w.supplier_id && w.category) s.add(w.category); });
    return [...s].sort();
  }, [watch]);
  // Default to all scannable sections; keep prior selection (pruned) when the list changes.
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
    setPoScanMsg('Scanning sales in Niagawan… ~1–2 min. Draft POs will appear above.');
    const started = Date.now();
    poPollRef.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', id).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (poPollRef.current) clearInterval(poPollRef.current);
        await loadSuggs();
        setPoScan(r.status === 'done' ? 'done' : 'error');
        setPoScanMsg(r.status === 'done' ? 'Scan complete ✓ — any draft POs are shown above to approve.' : 'Scan ran but reported an error.');
        setTimeout(() => { setPoScan('idle'); setPoScanMsg(''); }, 6000);
      } else if (Date.now() - started > 5 * 60 * 1000) {
        if (poPollRef.current) clearInterval(poPollRef.current);
        setPoScan('idle'); setPoScanMsg('Still running in the background — refresh in a bit.');
      }
    }, 4000);
  }, [poScan, scanFrom, scanTo, selectedCats, scanCats, loadSuggs]);

  const addItem = useCallback(async () => {
    const code = nCode.trim();
    if (!code) return;
    const { error } = await supabase.from('niagawan_min_stock').insert({ code, description: nDesc.trim() || null, min_balance: Number(nMin) || 4, category: nCat });
    if (!error) { setNCode(''); setNDesc(''); setNMin('4'); setNCat('Other'); await loadAll(); } else setErr(error.message);
  }, [nCode, nDesc, nMin, nCat, loadAll]);
  const startEdit = useCallback((w: Watch) => { setEditCode(w.code); setEDesc(w.description || ''); setEMin(String(w.min_balance || 4)); setECat(w.category || 'Other'); }, []);
  const saveEdit = useCallback(async () => {
    if (!editCode) return;
    await supabase.from('niagawan_min_stock').update({ description: eDesc.trim() || null, min_balance: Number(eMin) || 4, category: eCat, updated_at: new Date().toISOString() }).eq('code', editCode);
    setEditCode(null); await loadAll();
  }, [editCode, eDesc, eMin, eCat, loadAll]);
  const deleteItem = useCallback(async (code: string) => { await supabase.from('niagawan_min_stock').delete().eq('code', code); await loadAll(); }, [loadAll]);
  const toggleAutoPo = useCallback(async (code: string, val: boolean) => {
    setWatch((ws) => ws.map((w) => (w.code === code ? { ...w, auto_po: val } : w)));
    await supabase.from('niagawan_min_stock').update({ auto_po: val, updated_at: new Date().toISOString() }).eq('code', code);
  }, []);
  const setSupplierFor = useCallback(async (code: string, supplier_id: string) => {
    const sup = suppliers.find((s) => s.creditor_id === supplier_id) || null;
    setWatch((ws) => ws.map((w) => (w.code === code ? { ...w, supplier_id: supplier_id || null, supplier_name: sup?.name ?? null } : w)));
    await supabase.from('niagawan_min_stock').update({ supplier_id: supplier_id || null, supplier_name: sup?.name ?? null, updated_at: new Date().toISOString() }).eq('code', code);
  }, [suppliers]);
  // Set one supplier + turn on Auto-PO for every item in a category → makes that section scannable.
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

  const pendingSuggs = suggs.filter((s) => s.status === 'pending').length;

  return (
    <div>
      {newItems.length > 0 && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900">🆕 New items in Niagawan<span className="rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white">{newItems.length}</span><span className="text-xs font-normal text-emerald-700/70">review → add to watchlist or dismiss</span></h2>
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {newItems.map((it) => {
              const cat = guessCategory(it.descp);
              return (
              <div key={it.sku} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-white p-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">{it.code}{cat !== 'Other' && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">→ {cat}</span>}</div>
                  <div className="truncate text-xs text-gray-500">{it.descp}{it.price != null ? ` · RM${Number(it.price).toLocaleString('en-MY')}` : ''} · seen {fmtD(it.first_seen.slice(0, 10))}</div>
                </div>
                <div className="whitespace-nowrap"><button onClick={() => addNewToWatchlist(it)} className="mr-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Add to watchlist</button><button onClick={() => dismissNewItem(it.sku)} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100">Dismiss</button></div>
              </div>
              );
            })}
          </div>
        </div>
      )}
      {suggs.length > 0 && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-blue-900">
            Purchase orders to approve{pendingSuggs > 0 ? ` (${pendingSuggs} pending)` : ''}
          </h2>
          <div className="space-y-2">
            {suggs.map((s) => (
              <div key={s.id} className="rounded-md border border-gray-200 bg-white p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-gray-900">
                    {s.supplier_name}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {(s.items || []).length} item{(s.items || []).length !== 1 ? 's' : ''}
                      {s.period_from ? ` · sold ${fmtD(s.period_from)}–${fmtD(s.period_to)}` : ''}
                    </span>
                  </div>
                  <div className="whitespace-nowrap">
                    {s.status === 'pending' && (
                      <>
                        <button onClick={() => approveSugg(s.id)} className="mr-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Approve → create PO</button>
                        <button onClick={() => rejectSugg(s.id)} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100">Reject</button>
                      </>
                    )}
                    {s.status === 'approved' && <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600"><span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500" />Approved — creating in Niagawan…</span>}
                    {s.status === 'created' && <span className="text-xs font-medium text-emerald-700">✓ Created {s.po_number || ''}{s.note ? ` · ${s.note}` : ''}</span>}
                    {s.status === 'error' && <span className="text-xs font-medium text-rose-600">Error: {s.note}</span>}
                    {s.status !== 'pending' && (
                      <button onClick={() => dismissSugg(s.id)} title="Remove from list" className="ml-2 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-700">✕</button>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {(s.items || []).map((it) => `${it.qty}× ${it.desc || it.code}`).join('  ·  ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-sm font-medium text-gray-800">Draft purchase orders from sales</div>
        <div className="mt-0.5 text-xs text-gray-400">Scans what sold in this period and drafts a PO per supplier. Review &amp; approve above before anything is created in Niagawan.</div>
        {scanCats.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
              <span>Sections to scan:</span>
              <button onClick={() => setSelectedCats(scanCats)} className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100">All</button>
              <button onClick={() => setSelectedCats([])} className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100">None</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {scanCats.map((c) => {
                const on = selectedCats.includes(c);
                return (
                  <button key={c} onClick={() => toggleCat(c)} className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500'}`}>
                    {on ? '✓ ' : ''}{c}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">From<br /><input type="date" value={scanFrom} onChange={(e) => setScanFrom(e.target.value)} className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm" /></label>
          <label className="text-xs text-gray-500">To<br /><input type="date" value={scanTo} onChange={(e) => setScanTo(e.target.value)} className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm" /></label>
          <button onClick={runAutoPo} disabled={poScan === 'running'} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {poScan === 'running' ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-white" />Scanning…</>) : 'Scan sales & draft POs'}
          </button>
          {poScanMsg && <span className="text-xs text-gray-500">{poScanMsg}</span>}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Reorder list</h2>
          <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
            <button onClick={() => setFilter('low')} className={`px-2 py-1 ${filter === 'low' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>Low only</button>
            <button onClick={() => setFilter('all')} className={`px-2 py-1 ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}>All</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Last checked: {lastChecked}</span>
          <button onClick={checkStockNow} disabled={sync === 'running'}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${sync === 'running' ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {sync === 'running' ? (<><span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />Checking…</>) : 'Check stock now'}
          </button>
        </div>
      </div>

      {syncMsg && (<div className={`mb-3 rounded border p-2 text-xs ${sync === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : sync === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>{syncMsg}</div>)}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"><div className="text-xs font-medium text-gray-500">To order</div><div className="mt-1 text-lg font-semibold text-rose-600">{stats.toOrder}</div></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"><div className="text-xs font-medium text-gray-500">On PO</div><div className="mt-1 text-lg font-semibold text-blue-600">{stats.onPo}</div></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"><div className="text-xs font-medium text-gray-500">KIV / on hold</div><div className="mt-1 text-lg font-semibold text-gray-500">{stats.kiv}</div></div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"><div className="text-xs font-medium text-gray-500">Needs review</div><div className="mt-1 text-lg font-semibold text-amber-600">{stats.review}</div></div>
      </div>

      {err && <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{err}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
          {filter === 'low' ? 'Nothing left to order — all low items are on a PO, on hold, or back in stock. 🎉' : 'No stock data yet. Tap “Check stock now”.'}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.cat} className="overflow-hidden rounded-lg border border-gray-200">
              <div className="flex items-center justify-between bg-blue-50 px-3 py-2 text-sm font-semibold text-gray-800">
                <span>{g.cat}</span>
                <span className="text-xs font-medium text-gray-500">{g.items.length} item{g.items.length !== 1 ? 's' : ''}, {g.lowCount} to order</span>
              </div>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold text-gray-700">Code</th>
                    <th className="px-3 py-2 font-semibold text-gray-700">Description</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Bal</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Min</th>
                    <th className="px-3 py-2 font-semibold text-gray-700">Remarks</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {g.items.map((r) => {
                    const onPo = r.po === 'on_po';
                    const low = r.stock === 'low';
                    const rowCls = onPo ? 'bg-blue-50' : low ? 'bg-rose-50' : '';
                    return (
                      <tr key={r.code} className={rowCls}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                          {r.code}
                          {onPo && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">ON PO</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{r.description}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${onPo ? 'text-blue-700' : low ? 'text-rose-600' : 'text-gray-900'}`}>{r.balance}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.min}</td>
                        <td className="px-3 py-2">
                          <input defaultValue={r.remarks || ''} placeholder="add a note…" onBlur={(e) => { if (e.target.value !== (r.remarks || '')) saveRemarks(r.code, e.target.value); }} className="w-full min-w-[120px] rounded border border-gray-200 px-1.5 py-0.5 text-xs" />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {onPo ? (
                            <button onClick={() => clearStatus(r.code)} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Undo PO</button>
                          ) : (
                            <button onClick={() => setPO(r.code)} className="mr-1 rounded-md border border-blue-200 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">On PO</button>
                          )}
                          <button onClick={() => setKIV(r.code)} className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">KIV</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* KIV / on hold */}
      {kivList.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setShowKiv((s) => !s)} className="text-xs font-medium text-gray-600 underline hover:text-gray-800">
            {showKiv ? 'Hide' : 'Show'} KIV / on hold ({kivList.length})
          </button>
          {showKiv && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Code</th>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Bal</th>
                    <th className="px-3 py-2 font-semibold">Note</th>
                    <th className="px-3 py-2 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {kivList.map((r) => (
                    <tr key={r.code}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{r.code}</td>
                      <td className="px-3 py-2 text-gray-700">{r.description}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{r.balance == null ? '—' : r.balance}</td>
                      <td className="px-3 py-2">
                        <input defaultValue={r.note || ''} placeholder="e.g. supplier out till July" onBlur={(e) => { if (e.target.value !== (r.note || '')) saveNote(r.code, e.target.value); }}
                          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs" />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button onClick={() => clearStatus(r.code)} className="rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">← Reorder</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Needs review */}
      {review.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setShowReview((s) => !s)} className="text-xs font-medium text-amber-700 underline hover:text-amber-900">
            {showReview ? 'Hide' : 'Show'} {review.length} item(s) needing review (stock couldn’t be read)
          </button>
          {showReview && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-amber-200">
              <table className="min-w-full divide-y divide-amber-100 text-sm">
                <tbody className="divide-y divide-amber-50 bg-amber-50/40">
                  {review.map((r) => (
                    <tr key={r.code} className="text-gray-600">
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium">{r.code}</td>
                      <td className="px-3 py-1.5">{r.description}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-gray-400">{r.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Manage watchlist */}
      <div className="mt-6">
        <button onClick={() => setShowManage((s) => !s)} className="text-xs font-medium text-gray-500 underline hover:text-gray-700">
          {showManage ? 'Hide' : 'Manage'} watchlist ({watch.length} items · {autoPoCount} on auto-PO)
        </button>
        {showManage && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
            <p className="mb-3 text-xs text-gray-500">
              Items the scraper checks each run. <strong>Auto-PO</strong> = include this item in the daily auto-purchase-order task
              (when it sells, it gets drafted into a PO for its <strong>supplier</strong>). Tick the items you want and pick each
              one&rsquo;s supplier.
            </p>
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
              <label className="text-xs text-gray-600">Code<input value={nCode} onChange={(e) => setNCode(e.target.value)} placeholder="e.g. MN7501-4" className="mt-1 block w-32 rounded-md border border-gray-300 px-2 py-1 text-xs" /></label>
              <label className="text-xs text-gray-600">Description<input value={nDesc} onChange={(e) => setNDesc(e.target.value)} className="mt-1 block w-56 rounded-md border border-gray-300 px-2 py-1 text-xs" /></label>
              <label className="text-xs text-gray-600">Min<input value={nMin} onChange={(e) => setNMin(e.target.value)} className="mt-1 block w-14 rounded-md border border-gray-300 px-2 py-1 text-xs" /></label>
              <label className="text-xs text-gray-600">Category
                <select value={nCat} onChange={(e) => setNCat(e.target.value)} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-xs">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
              <button onClick={addItem} disabled={!nCode.trim()} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40">Add item</button>
            </div>
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-blue-100 bg-blue-50/60 p-2">
              <div className="w-full text-xs font-medium text-blue-900">Bulk-assign a supplier to a whole category — turns on Auto-PO for every item in it, so the section becomes scannable in “Draft POs from sales”.</div>
              <label className="text-xs text-gray-600">Category
                <select value={bulkCat} onChange={(e) => { setBulkCat(e.target.value); setBulkMsg(''); }} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-xs">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
              <label className="text-xs text-gray-600">Supplier
                <select value={bulkSup} onChange={(e) => { setBulkSup(e.target.value); setBulkMsg(''); }} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-xs">
                  <option value="">— pick —</option>
                  {suppliers.map((s) => <option key={s.creditor_id} value={s.creditor_id}>{s.name}</option>)}
                </select>
              </label>
              <button onClick={() => bulkAssignSupplier(bulkCat, bulkSup)} disabled={!bulkSup} className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-40">Apply to all {watch.filter((w) => w.category === bulkCat).length} items</button>
              {bulkMsg && <span className="w-full text-xs text-gray-700">{bulkMsg}</span>}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or description…" className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1 text-xs" />
            <div className="max-h-96 overflow-y-auto rounded-md border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
                  <tr><th className="px-2 py-1 font-semibold">Code</th><th className="px-2 py-1 font-semibold">Description</th><th className="px-2 py-1 font-semibold">Min</th><th className="px-2 py-1 font-semibold">Category</th><th className="px-2 py-1 text-center font-semibold">Auto-PO</th><th className="px-2 py-1 font-semibold">Supplier</th><th className="px-2 py-1"></th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredWatch.map((w) =>
                    editCode === w.code ? (
                      <tr key={w.code} className="bg-amber-50">
                        <td className="whitespace-nowrap px-2 py-1 font-medium text-gray-900">{w.code}</td>
                        <td className="px-2 py-1"><input value={eDesc} onChange={(e) => setEDesc(e.target.value)} className="w-full rounded border border-gray-300 px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><input value={eMin} onChange={(e) => setEMin(e.target.value)} className="w-12 rounded border border-gray-300 px-1 py-0.5" /></td>
                        <td className="px-2 py-1"><select value={eCat} onChange={(e) => setECat(e.target.value)} className="rounded border border-gray-300 px-1 py-0.5">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                        <td className="px-2 py-1 text-center text-gray-300">—</td>
                        <td className="px-2 py-1 text-gray-300">—</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right">
                          <button onClick={saveEdit} className="mr-1 rounded-md border border-emerald-200 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50">Save</button>
                          <button onClick={() => setEditCode(null)} className="rounded-md border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-gray-100">Cancel</button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={w.code}>
                        <td className="whitespace-nowrap px-2 py-1 font-medium text-gray-900">{w.code}</td>
                        <td className="px-2 py-1 text-gray-700">{w.description}</td>
                        <td className="px-2 py-1 text-gray-500">{w.min_balance}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-gray-500">{w.category}</td>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={w.auto_po} onChange={(e) => toggleAutoPo(w.code, e.target.checked)} className="h-3.5 w-3.5" />
                        </td>
                        <td className="px-2 py-1">
                          <select value={w.supplier_id || ''} onChange={(e) => setSupplierFor(w.code, e.target.value)}
                            className={`max-w-[180px] rounded border px-1 py-0.5 ${w.auto_po && !w.supplier_id ? 'border-rose-300 bg-rose-50' : 'border-gray-300'}`}>
                            <option value="">— pick —</option>
                            {suppliers.map((s) => <option key={s.creditor_id} value={s.creditor_id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-right">
                          <button onClick={() => startEdit(w)} className="mr-1 rounded-md border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-100">Edit</button>
                          <button onClick={() => deleteItem(w.code)} className="rounded-md border border-gray-200 px-2 py-0.5 text-rose-600 hover:bg-rose-50">Delete</button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
