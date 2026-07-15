'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Pinv = {
  id: string;
  status: string;
  file_path: string | null;
  supplier_name: string | null;
  ref_no: string | null;
  invoice_date: string | null;
  total: number | null;
  niagawan_pi_no: string | null;
  note: string | null;
  check_status: string | null;
  checked_at: string | null;
  resolve_status: string | null;
  read_model: string | null;
  dup_pi_no: string | null;
};

type NiagawanMatch = { sku: string; code: string; descp: string; price: string; bal: string };

type Item = {
  line_no: number;
  item_code: string;
  codes: string[];
  description: string;
  qty: number;
  unit_price: number;
  discount: number;
  amount: number;
  category: string;
  will_create: boolean;
  sku_id: string | null;       // owner's chosen Niagawan product (authoritative at create time)
  sold_status: string | null;
  sold_on: string | null;
  in_niagawan: boolean | null;
  niagawan_category: string | null;
  niagawan_matches: NiagawanMatch[] | null;
  code_verified: boolean | null;
};

// Same code normalisation the NAS uses — to tell whether the line's code already points at
// exactly ONE of the matched Niagawan products.
const normCode = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const rm = (n: number) => `RM ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
// Net line total = qty x unit price, minus any per-line discount %. This is what reconciles
// against the supplier's printed line amount (and against the invoice total).
const lineAmount = (qty: number, unit: number, disc: number) => round2((Number(qty) || 0) * (Number(unit) || 0) * (1 - (Number(disc) || 0) / 100));

export default function ReviewInvoicePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [head, setHead] = useState<Pinv | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  // Candidate products from OUR catalog (niagawan_products), keyed by normalised code.
  // This is what tells us a line's code is ambiguous (e.g. 9 products share the code "DRIER").
  const [catMatches, setCatMatches] = useState<Record<string, NiagawanMatch[]>>({});
  const [candsLoaded, setCandsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Per-line product picker: search the full catalog (niagawan_products) to link an existing
  // product to a line — for code-less invoices (e.g. Tat Seng) the owner picks from the list
  // instead of creating duplicates. `picked` caches the chosen products for display.
  const [pickerLine, setPickerLine] = useState<number | null>(null);
  const [pq, setPq] = useState('');
  const [presults, setPresults] = useState<NiagawanMatch[]>([]);
  const [picked, setPicked] = useState<Record<string, NiagawanMatch>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Product-catalog refresh: re-sync niagawan_products from Niagawan on demand (same sync_requests
  // mechanism the inventory/sales pages use; a products sync runs in ~1–2 min). Used when a line
  // shows "create new" for an item that IS in Niagawan but was created after the last nightly
  // catalog sync (the stale-catalog trap). Bumping refreshNonce re-runs the candidate lookup.
  const [catSync, setCatSync] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [catSyncMsg, setCatSyncMsg] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const catPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const catCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (catPollRef.current) clearInterval(catPollRef.current); if (catCooldownRef.current) clearTimeout(catCooldownRef.current); }, []);

  useEffect(() => {
    (async () => {
      const { data: ok } = await supabase.rpc('is_admin');
      setIsAdmin(ok === true);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: p }, { data: its }, { data: catRows }] = await Promise.all([
      supabase.from('pinv').select('*').eq('id', id).maybeSingle(),
      supabase.from('pinv_item').select('*').eq('pinv_id', id).order('line_no', { ascending: true }),
      supabase.from('niagawan_category').select('name').order('name'),
    ]);
    setHead((p ?? null) as Pinv | null);
    setCats((catRows ?? []).map((c: { name: string }) => c.name).filter(Boolean));
    setItems(
      ((its ?? []) as Array<Record<string, unknown>>).map((r, i) => ({
        line_no: Number(r.line_no) || i + 1,
        item_code: String(r.item_code ?? ''),
        codes: Array.isArray(r.codes) ? (r.codes as unknown[]).map((c) => String(c ?? '')).filter(Boolean) : [],
        description: String(r.description ?? ''),
        qty: Number(r.qty) || 0,
        unit_price: Number(r.unit_price) || 0,
        discount: Number(r.discount) || 0,
        amount: Number(r.amount) || 0,
        category: String(r.category ?? '') || 'SPARE PARTS ITEM',
        will_create: Boolean(r.will_create),
        sku_id: (r.sku_id as string) ?? null,
        sold_status: (r.sold_status as string) ?? null,
        sold_on: (r.sold_on as string) ?? null,
        in_niagawan: (r.in_niagawan as boolean | null) ?? null,
        niagawan_category: (r.niagawan_category as string) ?? null,
        niagawan_matches: Array.isArray(r.niagawan_matches) ? (r.niagawan_matches as NiagawanMatch[]) : null,
        code_verified: (r.code_verified as boolean | null) ?? null,
      }))
    );
    // For lines already linked to a product, fetch its name so the Product column shows it
    // (instead of a bare sku) — covers products picked via search on a previous visit.
    const skuIds = [...new Set(((its ?? []) as Array<Record<string, unknown>>).map((r) => r.sku_id).filter(Boolean).map(String))];
    if (skuIds.length) {
      const { data: prods } = await supabase.from('niagawan_products').select('sku,code,descp,price').in('sku', skuIds);
      const pmap: Record<string, NiagawanMatch> = {};
      ((prods ?? []) as Array<{ sku: string; code: string | null; descp: string | null; price: number | string | null }>)
        .forEach((p) => { pmap[String(p.sku)] = { sku: String(p.sku), code: String(p.code ?? ''), descp: String(p.descp ?? ''), price: String(p.price ?? ''), bal: '' }; });
      setPicked((prev) => ({ ...prev, ...pmap }));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // Every distinct raw code across all lines (the typed code + any alternate codes).
  const allCodes = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => { if (it.item_code.trim()) s.add(it.item_code.trim()); it.codes.forEach((c) => c.trim() && s.add(c.trim())); });
    return [...s];
  }, [items]);
  const codeKey = useMemo(() => allCodes.slice().sort().join('|'), [allCodes]);

  // Load candidate products from our catalog for every line code, keyed by normalised code.
  useEffect(() => {
    let cancelled = false;
    setCandsLoaded(false);
    (async () => {
      if (!allCodes.length) { if (!cancelled) { setCatMatches({}); setCandsLoaded(true); } return; }
      // Token-aware match: pinv_candidates splits each product's code on spaces/commas and matches
      // any normalised token — so a combined code like "M1515-10040 M1515-A0110" is found by "M1515-10040".
      const { data } = await supabase.rpc('pinv_candidates', { p_codes: allCodes });
      if (cancelled) return;
      const map: Record<string, NiagawanMatch[]> = {};
      ((data ?? []) as Array<{ sku: string; code: string; descp: string | null; price: number | string | null }>).forEach((p) => {
        const m: NiagawanMatch = { sku: String(p.sku), code: String(p.code), descp: String(p.descp ?? ''), price: String(p.price ?? ''), bal: '' };
        // Index the product under its WHOLE normalised code AND every space/comma token, so a
        // line matches whether its code is the full string ("32X52X8R POS") or one packed token.
        Array.from(new Set([normCode(String(p.code ?? '')), ...String(p.code ?? '').split(/[\s,]+/).map(normCode)].filter(Boolean))).forEach((k) => {
          (map[k] = map[k] || []).push(m);
        });
      });
      setCatMatches(map); setCandsLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeKey, refreshNonce]);

  // Candidate products for one line = catalog products sharing any of its (normalised) codes.
  const candsFor = useCallback((it: Item): NiagawanMatch[] => {
    const keys = Array.from(new Set([it.item_code, ...it.codes].map(normCode).filter(Boolean)));
    const map = new Map<string, NiagawanMatch>();
    keys.forEach((k) => (catMatches[k] || []).forEach((m) => map.set(m.sku, m)));
    return [...map.values()];
  }, [catMatches]);

  // How a line resolves: link to one product, create new, or (ambiguous) needs the owner to choose.
  type Res = { kind: 'link'; sku: string; auto: boolean } | { kind: 'create'; auto: boolean } | { kind: 'unresolved' };
  const resolutionFor = useCallback((it: Item): Res => {
    const cands = candsFor(it);
    if (it.sku_id) return { kind: 'link', sku: it.sku_id, auto: false };
    if (it.will_create) return { kind: 'create', auto: false };
    if (cands.length === 1) return { kind: 'link', sku: cands[0].sku, auto: true };
    if (cands.length === 0) return { kind: 'create', auto: true };
    return { kind: 'unresolved' };
  }, [candsFor]);

  const unresolvedLines = useMemo(
    () => (candsLoaded ? items.filter((it) => resolutionFor(it).kind === 'unresolved').map((it) => it.line_no) : []),
    [items, resolutionFor, candsLoaded]);

  // Would a catalog refresh actually auto-link this line? Only if the live Niagawan lookup
  // (niagawan_matches, already stored on the row) found a product whose code TOKEN-matches the line
  // code the SAME way pinv_candidates does: collapse the line code; split the product code on
  // space/comma and normalise each token; require equality. This deliberately EXCLUDES the shop's
  // per-supplier suffix/variant codes (line "16260-BZ020" vs product "16260-BZ020-YCW") and
  // space-packed codes, where in_niagawan is true (the NAS uses a broad substring match on code OR
  // description) but a refresh can never produce a token candidate — so we must not tell the owner
  // to refresh those; the 🔎 picker is the right tool for them and is already offered.
  const refreshLinkable = useCallback((it: Item): boolean => {
    const wants = new Set([it.item_code, ...it.codes].map(normCode).filter(Boolean));
    if (!wants.size) return false;
    return (it.niagawan_matches ?? []).some((m) =>
      String(m.code ?? '').split(/[\s,]+/).map(normCode).filter(Boolean).some((tok) => wants.has(tok)));
  }, []);

  // The real "stale catalog" trap: the line IS in Niagawan (live lookup) but missing from our synced
  // catalog AND a refresh would genuinely token-link it (refreshLinkable). Defaulting to create-new
  // here risks a duplicate; one refresh fixes it. (Suppressed once linked / create-new chosen.)
  const staleLines = useMemo(
    () => (candsLoaded ? items.filter((it) => it.in_niagawan === true && !it.sku_id && !it.will_create && candsFor(it).length === 0 && refreshLinkable(it)).map((it) => it.line_no) : []),
    [items, candsFor, refreshLinkable, candsLoaded]);

  const computedTotal = useMemo(() => round2(items.reduce((s, it) => s + lineAmount(it.qty, it.unit_price, it.discount), 0)), [items]);
  const totalMismatch = head?.total != null && Math.abs(round2(head.total) - computedTotal) > 0.01;

  // Lines whose AI-returned code was NOT found in the PDF's own text (likely a misread). Editing the
  // code — or clicking "✓ checked" — sets code_verified back to null and clears the block.
  const codeUnverifiedLines = useMemo(() => items.filter((it) => it.code_verified === false).map((it) => it.line_no), [items]);
  // Non-empty lines that would create a NEW product but carry no code to create it by (and aren't linked).
  const codelessLines = useMemo(
    () => (candsLoaded ? items
      .filter((it) => it.item_code.trim() || it.codes.length || it.description.trim())
      .filter((it) => resolutionFor(it).kind !== 'link' && !it.item_code.trim() && it.codes.length === 0)
      .map((it) => it.line_no) : []),
    [items, resolutionFor, candsLoaded]);
  // Everything that must be ironed out before Approve. Approve stays blocked while this is non-empty.
  // Objective, always-fixable errors only — the possible-duplicate and stale-catalog notices stay
  // advisory (legitimately overridable, and both are backstopped by the NAS create step).
  const approveBlockers = useMemo(() => {
    const b: string[] = [];
    const nonEmpty = items.filter((it) => it.item_code.trim() || it.codes.length || it.description.trim());
    if (nonEmpty.length === 0) { b.push('Add at least one line item.'); return b; }
    if (!head?.supplier_name?.trim()) b.push('Enter the supplier name (needed to match the Niagawan creditor).');
    if (!head?.ref_no?.trim()) b.push('Enter the supplier invoice ref# (the duplicate guard needs it).');
    if (!head?.invoice_date) b.push('Set the invoice date.');
    if (head?.total == null) b.push('Enter the invoice total (from the PDF) so the line items can be reconciled.');
    else if (totalMismatch) b.push(`Line-items total ${rm(computedTotal)} doesn't match the PDF total ${rm(head.total)} — fix the quantity, price, or a missing/extra line until they match (or correct the total field if the PDF itself differs).`);
    if (candsLoaded && unresolvedLines.length) b.push(`Line${unresolvedLines.length === 1 ? '' : 's'} ${unresolvedLines.join(', ')}: the code matches several products — pick the right one (or “create new”).`);
    if (codelessLines.length) b.push(`Line${codelessLines.length === 1 ? '' : 's'} ${codelessLines.join(', ')}: add a code or link an existing product.`);
    if (codeUnverifiedLines.length) b.push(`Line${codeUnverifiedLines.length === 1 ? '' : 's'} ${codeUnverifiedLines.join(', ')}: the code isn’t in the PDF text (possible AI misread) — check it against the PDF, then click “✓ checked” on the line (or fix the code).`);
    return b;
  }, [items, head?.supplier_name, head?.ref_no, head?.invoice_date, head?.total, totalMismatch, computedTotal, candsLoaded, unresolvedLines, codelessLines, codeUnverifiedLines]);

  const setItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addRow = () => setItems((prev) => [...prev, { line_no: prev.length + 1, item_code: '', codes: [], description: '', qty: 1, unit_price: 0, discount: 0, amount: 0, category: 'SPARE PARTS ITEM', will_create: true, sku_id: null, sold_status: null, sold_on: null, in_niagawan: null, niagawan_category: null, niagawan_matches: null, code_verified: null }]);
  const removeRow = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, line_no: i + 1 })));

  // Token-ranked search of the full catalog: split into words, fetch products matching any word,
  // rank by how many words each contains — so "PROTON X50 SPARK PLUG" finds the product even
  // though Niagawan stores it as "SPARK PLUG ... PROTON X50" (different word order).
  const searchProducts = useCallback((text: string) => {
    setPq(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const tokens = String(text || '').toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 2);
    if (!tokens.length) { setPresults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const ors = tokens.slice(0, 6).flatMap((t) => [`descp.ilike.%${t}%`, `code.ilike.%${t}%`]).join(',');
      const { data } = await supabase.from('niagawan_products').select('sku,code,descp,price').or(ors).limit(60);
      const ranked = ((data ?? []) as Array<{ sku: string; code: string | null; descp: string | null; price: number | string | null }>)
        .map((p) => {
          const hay = (String(p.descp ?? '') + ' ' + String(p.code ?? '')).toUpperCase();
          return { p, score: tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map(({ p }) => ({ sku: String(p.sku), code: String(p.code ?? ''), descp: String(p.descp ?? ''), price: String(p.price ?? ''), bal: '' }));
      setPresults(ranked);
    }, 250);
  }, []);
  const openPicker = (idx: number, it: Item) => { setPickerLine(idx); setPresults([]); searchProducts(it.description || it.item_code || ''); };
  const pickProduct = (idx: number, p: NiagawanMatch) => {
    setPicked((prev) => ({ ...prev, [p.sku]: p }));
    setItem(idx, { sku_id: p.sku, will_create: false });
    setPickerLine(null); setPq(''); setPresults([]);
  };

  const save = useCallback(async (approve: boolean) => {
    if (!id || !head) return;
    setBusy(true); setMsg(null);
    try {
      const cleaned = items
        .map((it, i) => ({ ...it, line_no: i + 1, amount: lineAmount(it.qty, it.unit_price, it.discount) }))
        .filter((it) => it.item_code.trim() || it.codes.length || it.description.trim());
      if (approve && approveBlockers.length > 0) {
        // Defense-in-depth: the Approve button is disabled while any blocker exists, but never let a
        // known error reach Niagawan even if a click races the state. Fix them, then approve.
        throw new Error(approveBlockers.length === 1 ? approveBlockers[0] : `Fix ${approveBlockers.length} issues before approving — ${approveBlockers.join(' • ')}`);
      }
      const { error: hErr } = await supabase.from('pinv').update({
        supplier_name: head.supplier_name?.trim() || null,
        ref_no: head.ref_no?.trim() || null,
        invoice_date: head.invoice_date || null,
        total: head.total,
        status: approve ? 'approved' : 'extracted',
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (hErr) throw hErr;

      const { error: dErr } = await supabase.from('pinv_item').delete().eq('pinv_id', id);
      if (dErr) throw dErr;
      if (cleaned.length) {
        const rows = cleaned.map((it) => {
          // The owner's decision is now authoritative: link to the chosen product (sku_id) or
          // create a new one (will_create). Single catalog match auto-links; no match auto-creates.
          const res = resolutionFor(it);
          return {
            pinv_id: id,
            line_no: it.line_no,
            item_code: it.item_code.trim() || it.codes[0] || null,
            codes: it.codes,
            description: it.description.trim() || null,
            qty: it.qty,
            unit_price: it.unit_price,
            discount: it.discount,
            amount: it.amount,
            category: it.category || 'SPARE PARTS ITEM',
            code_verified: it.code_verified, // keep the read-time flag (cleared to null when the code is edited)
            sku_id: res.kind === 'link' ? res.sku : null,
            will_create: res.kind === 'create',
          };
        });
        const { error: iErr } = await supabase.from('pinv_item').insert(rows);
        if (iErr) throw iErr;
      }
      if (approve) {
        setMsg({ kind: 'ok', text: 'Approved ✓ — queued to create in Niagawan.' });
        setTimeout(() => router.push('/niagawan/purchase'), 900);
      } else {
        setMsg({ kind: 'ok', text: 'Saved ✓' });
        await load();
      }
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [id, head, items, load, router, resolutionFor, approveBlockers]);

  const runCheck = useCallback(async () => {
    if (!id) return;
    setMsg(null);
    const { error } = await supabase.from('pinv').update({ check_status: 'queued', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setHead((h) => (h ? { ...h, check_status: 'queued' } : h));
  }, [id]);

  // While a sales check is queued/running, poll for the result.
  useEffect(() => {
    if (head?.check_status !== 'queued' && head?.check_status !== 'checking') return;
    const t = setInterval(() => { load(); }, 4000);
    return () => clearInterval(t);
  }, [head?.check_status, load]);

  const runResolve = useCallback(async () => {
    if (!id) return;
    const { error } = await supabase.from('pinv').update({ resolve_status: 'queued' }).eq('id', id);
    if (!error) setHead((h) => (h ? { ...h, resolve_status: 'queued' } : h));
  }, [id]);

  // Re-sync the product catalog (niagawan_products) from Niagawan, then re-run the candidate lookup
  // so freshly-created Niagawan items link instead of defaulting to "create new". Mirrors the
  // inventory page's sync lifecycle (insert sync_request -> poll every 4s -> reload, 5-min cap).
  const refreshCatalog = useCallback(async () => {
    if (catSync !== 'idle') return; // also blocks the brief done/error cooldown window (no re-entrancy)
    if (catPollRef.current) clearInterval(catPollRef.current);
    if (catCooldownRef.current) clearTimeout(catCooldownRef.current);
    const cooldown = () => { catCooldownRef.current = setTimeout(() => { setCatSync('idle'); setCatSyncMsg(''); }, 6000); };
    setCatSync('running'); setCatSyncMsg('Refreshing the product list from Niagawan… ~1–2 min. You can keep editing.');
    const { data, error } = await supabase.from('sync_requests').insert({ which: 'products', source: 'website-review-refresh' }).select('id').single();
    if (error || !data) { setCatSync('error'); setCatSyncMsg('Could not start the refresh: ' + (error?.message ?? 'unknown')); cooldown(); return; }
    const sid = data.id as number;
    const started = Date.now();
    catPollRef.current = setInterval(async () => {
      const { data: r } = await supabase.from('sync_requests').select('status').eq('id', sid).single();
      if (r?.status === 'done' || r?.status === 'error') {
        if (catPollRef.current) clearInterval(catPollRef.current);
        if (r.status === 'done') { setRefreshNonce((n) => n + 1); setCatSync('done'); setCatSyncMsg('Product list updated ✓ — re-checking matches…'); }
        else { setCatSync('error'); setCatSyncMsg('Refresh ran but reported an error.'); }
        cooldown();
      } else if (Date.now() - started > 5 * 60 * 1000) {
        if (catPollRef.current) clearInterval(catPollRef.current);
        setCatSync('idle'); setCatSyncMsg('Still running in the background — press Refresh again in a bit.');
        catCooldownRef.current = setTimeout(() => setCatSyncMsg(''), 10000);
      }
    }, 4000);
  }, [catSync]);

  // Auto-look-up Niagawan categories once if this invoice has never been resolved.
  useEffect(() => {
    if (head && (head.resolve_status === null || head.resolve_status === undefined)) runResolve();
  }, [head, runResolve]);

  // While the Niagawan lookup is queued/running, poll for the result.
  useEffect(() => {
    if (head?.resolve_status !== 'queued' && head?.resolve_status !== 'resolving') return;
    const t = setInterval(() => { load(); }, 4000);
    return () => clearInterval(t);
  }, [head?.resolve_status, load]);

  const viewPdf = useCallback(async () => {
    if (!head?.file_path) return;
    const { data } = await supabase.storage.from('pinv').createSignedUrl(head.file_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, [head]);

  // Dismiss = hide this invoice from the list (e.g. it's already keyed into Niagawan manually).
  // Nothing in Niagawan is touched; reversible from the list via "Show dismissed".
  const dismissInvoice = useCallback(async () => {
    if (!id || !head) return;
    if (!window.confirm(`Dismiss ${head.ref_no || 'this invoice'}? It will be hidden from the list — nothing is changed in Niagawan.`)) return;
    const { error } = await supabase.from('pinv').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    router.push('/niagawan/purchase');
  }, [id, head, router]);

  const restoreInvoice = useCallback(async () => {
    if (!id || !head) return;
    const back = head.supplier_name || head.total != null ? 'extracted' : 'uploaded';
    const { error } = await supabase.from('pinv').update({ status: back, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    await load();
  }, [id, head, load]);

  if (isAdmin === null || loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;
  if (!head) return <div className="text-sm text-gray-600">Invoice not found. <button onClick={() => router.push('/niagawan/purchase')} className="text-blue-600 underline">Back</button></div>;

  const locked = head.status === 'approved' || head.status === 'creating' || head.status === 'created' || head.status === 'dismissed';
  const showBilled = head.check_status === 'checked';
  const resolving = head.resolve_status === 'queued' || head.resolve_status === 'resolving';

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => router.push('/niagawan/purchase')} className="text-sm text-gray-500 hover:text-gray-900">← Back to invoices</button>
        <div className="flex items-center gap-2">
          {(head.check_status === 'queued' || head.check_status === 'checking')
            ? <span className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Checking sales… (~1 min)</span>
            : <button onClick={runCheck} className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">{head.check_status === 'checked' ? '↻ Re-check sales' : 'Check against sales'}</button>}
          {!locked && (catSync === 'idle'
            ? <button onClick={refreshCatalog} title="Re-sync the product list from Niagawan. Use this if a line shows 'create new' for an item that IS already in Niagawan (e.g. just created there)." className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">🔄 Refresh product list</button>
            : <span className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">{catSync === 'running' ? 'Refreshing products… (~1–2 min)' : catSync === 'done' ? 'Products updated ✓' : 'Refresh failed'}</span>)}
          {head.file_path && <button onClick={viewPdf} className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">View PDF</button>}
          {(head.status === 'uploaded' || head.status === 'extracted' || head.status === 'error') && (
            <button onClick={dismissInvoice} title="Hide this invoice (e.g. it's already in Niagawan). Nothing is changed in Niagawan." className="rounded border border-gray-200 px-2.5 py-1 text-xs text-rose-500 hover:bg-rose-50">✕ Dismiss</button>
          )}
          {head.status === 'dismissed' && (
            <button onClick={restoreInvoice} className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">↩ Restore</button>
          )}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{head.status === 'created' && head.niagawan_pi_no ? head.niagawan_pi_no : head.status}</span>
        </div>
      </div>

      {catSyncMsg && (
        <div className={`mb-3 rounded-md border p-2 text-sm ${catSync === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : catSync === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{catSyncMsg}</div>
      )}

      {locked && (
        <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-sm text-indigo-800">
          {head.status === 'dismissed'
            ? <>This invoice is dismissed (hidden from the list). Press <b>↩ Restore</b> above if you want to process it after all.</>
            : <>This invoice is {head.status}. It can no longer be edited.</>}
        </div>
      )}

      {/* Duplicate guard: this supplier invoice ref already exists in Niagawan */}
      {head.dup_pi_no && head.status !== 'created' && (
        <div className="mb-3 rounded-md border-2 border-rose-400 bg-rose-50 p-3 text-sm text-rose-800">
          ⚠️ <b>Possible duplicate.</b> This supplier invoice{head.ref_no ? <> (<span className="font-mono">{head.ref_no}</span>)</> : ''} is <b>already in Niagawan</b> as <b className="font-mono">{head.dup_pi_no}</b>. Approving would create a second copy — only approve if this is genuinely a new, separate invoice. (The system will also refuse to create a duplicate.)
        </div>
      )}

      {/* Which AI read this — flag clearly when the backup model was used so codes get extra scrutiny */}
      {head.read_model && (
        head.read_model.includes('3.5')
          ? <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">Read by primary AI (<span className="font-mono">{head.read_model}</span>).</div>
          : <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠️ Read by <b>backup AI</b> (<span className="font-mono">{head.read_model}</span>) because the primary was overloaded. Please <b>double-check the part codes</b> against the PDF before approving.</div>
      )}

      {/* Needs-decision summary: lines whose code matches MORE THAN ONE product in the catalog.
          These block approval until the owner picks the right product (or chooses create-new). */}
      {candsLoaded && unresolvedLines.length > 0 && (
        <div className="mb-3 rounded-md border-2 border-rose-400 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          ⚠ <b>{unresolvedLines.length} line{unresolvedLines.length === 1 ? '' : 's'} need a decision</b> (line{unresolvedLines.length === 1 ? '' : 's'} {unresolvedLines.join(', ')}) — the code matches several products. Pick the right one (or choose <b>create new</b>) in the <b>Product</b> column below. Approving is blocked until then.
        </div>
      )}

      {/* Stale-catalog guard: lines that ARE in Niagawan (per the live lookup) but missing from our
          synced product list — they'd default to create-new and risk a duplicate. One click refreshes. */}
      {candsLoaded && staleLines.length > 0 && (
        <div className="mb-3 rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ <b>{staleLines.length} line{staleLines.length === 1 ? '' : 's'} (line{staleLines.length === 1 ? '' : 's'} {staleLines.join(', ')}) {staleLines.length === 1 ? 'is' : 'are'} in Niagawan but missing from your synced product list</b> — {staleLines.length === 1 ? 'it' : 'they'}&rsquo;ll default to <b>create new</b> and risk a duplicate. This usually means the item was created in Niagawan very recently. Press <b>🔄 Refresh product list</b> above{catSync === 'running' ? ' (running now…)' : ''}, then {staleLines.length === 1 ? 'it' : 'they'}&rsquo;ll link automatically. (If a line still shows after refreshing, use <b>🔎 choose existing item</b> on it.)
        </div>
      )}

      {/* Code-verification summary: codes that weren't found verbatim in the PDF's own text */}
      {(() => {
        const bad = items.filter((it) => it.code_verified === false);
        if (bad.length === 0) return null;
        return (
          <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            ⚠ <b>{bad.length} code{bad.length === 1 ? '' : 's'} not found in the PDF text</b> (lines {bad.map((b) => b.line_no).join(', ')}) — the AI may have misread {bad.length === 1 ? 'it' : 'them'}. They're highlighted red below; please check against the PDF before approving.
          </div>
        );
      })()}

      {/* Header */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Supplier</span>
            <input disabled={locked} value={head.supplier_name ?? ''} onChange={(e) => setHead({ ...head, supplier_name: e.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Supplier invoice ref#</span>
            <input disabled={locked} value={head.ref_no ?? ''} onChange={(e) => setHead({ ...head, ref_no: e.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Invoice date</span>
            <input disabled={locked} type="date" value={head.invoice_date ?? ''} onChange={(e) => setHead({ ...head, invoice_date: e.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Invoice total (from PDF)</span>
            <input disabled={locked} type="number" step="0.01" value={head.total ?? ''} onChange={(e) => setHead({ ...head, total: e.target.value === '' ? null : Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-gray-500">Line items total: <b className="tabular-nums text-gray-800">{rm(computedTotal)}</b></span>
          {totalMismatch
            ? <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">⚠ differs from PDF total {rm(head.total ?? 0)} — fix before approving</span>
            : <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">✓ matches PDF total</span>}
        </div>
      </div>

      {/* Sales-check result banner (3-way: billed / check / not billed) */}
      {head.check_status === 'checked' && (() => {
        const nf = items.filter((it) => it.sold_status === 'not_found');
        const ck = items.filter((it) => it.sold_status === 'check');
        if (nf.length === 0 && ck.length === 0)
          return <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">✓ All items were billed on a sale invoice (±7 days of the invoice date).</div>;
        return (
          <div className="mb-3 space-y-2">
            {nf.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">
                <b>{nf.length} item{nf.length === 1 ? '' : 's'} not on any sale invoice</b> — possibly bought but not yet billed to a customer: {nf.map((it) => it.item_code).filter(Boolean).join(', ')}
              </div>
            )}
            {ck.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
                <b>{ck.length} item{ck.length === 1 ? '' : 's'} to verify</b> — the code only appears in a sale invoice’s <b>remark/note</b>, not as a billed line item. It might be the real sale (recorded loosely) or a note about a different part — open the listed invoice to confirm: {ck.map((it) => it.item_code).filter(Boolean).join(', ')}
              </div>
            )}
          </div>
        );
      })()}

      {/* Items — the line-items table has many columns; break it out of the narrow
          max-w-6xl section column to use the fuller viewport width so it doesn't need
          horizontal scrolling. Capped at 84rem; centered; heading matches the width. */}
      <div style={{ width: 'min(84rem, calc(100vw - 2rem))' }} className="relative left-1/2 mb-2 flex -translate-x-1/2 items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Line items ({items.length}){resolving && <span className="ml-2 font-normal text-amber-600">· looking up Niagawan categories…</span>}</h2>
        {!locked && <button onClick={addRow} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">+ Add row</button>}
      </div>
      <div style={{ width: 'min(84rem, calc(100vw - 2rem))' }} className="relative left-1/2 -translate-x-1/2 overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-2 py-2 font-medium text-gray-600">#</th>
              <th className="px-2 py-2 font-medium text-gray-600">Item code</th>
              <th className="px-2 py-2 font-medium text-gray-600">Description</th>
              <th className="px-2 py-2 text-right font-medium text-gray-600">Qty</th>
              <th className="px-2 py-2 text-right font-medium text-gray-600">Unit price</th>
              <th className="px-2 py-2 text-right font-medium text-gray-600">Disc %</th>
              <th className="px-2 py-2 text-right font-medium text-gray-600">Amount</th>
              <th className="px-2 py-2 font-medium text-gray-600">Product <span className="font-normal text-gray-400">(link existing · or create new)</span></th>
              {showBilled && <th className="px-2 py-2 font-medium text-gray-600">Billed?</th>}
              {!locked && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={(locked ? 8 : 9) + (showBilled ? 1 : 0)} className="px-3 py-6 text-center text-gray-500">No line items.</td></tr>
            ) : items.map((it, idx) => {
              return (
                <tr key={idx} className="border-t border-gray-100 align-top">
                  <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                  <td className="px-2 py-1.5">
                    <input disabled={locked} value={it.item_code}
                      onChange={(e) => {
                        // Typing a code is an explicit override: it must ALSO become the codes
                        // list (which is what the NAS matches/creates by). Leaving stale alt
                        // codes there made Niagawan ignore the owner's typed code (2026-06-12).
                        const v = e.target.value;
                        // Editing the code invalidates the live-lookup signals tied to the OLD code:
                        // clear in_niagawan/niagawan_matches so the stale-catalog warning can't make a
                        // false claim about an unverified/changed code.
                        setItem(idx, { item_code: v, codes: v.trim() ? [v.trim()] : [], code_verified: null, sku_id: null, will_create: false, in_niagawan: null, niagawan_matches: null });
                      }}
                      className={`w-36 rounded border px-1.5 py-1 font-mono text-xs disabled:bg-transparent ${it.code_verified === false ? 'border-rose-400 bg-rose-50' : 'border-gray-200 disabled:border-transparent'}`} />
                    {it.code_verified === false && (
                      <div className="mt-0.5 max-w-[12rem] text-[10px] font-medium leading-tight text-rose-600" title="This code was NOT found in the invoice's text — the AI may have misread it. Check it against the PDF.">
                        ⚠ not found in PDF text — check it
                        {!locked && <button type="button" onClick={() => setItem(idx, { code_verified: null })} title="I've checked this code against the PDF — it's correct" className="ml-1 rounded border border-rose-300 px-1 text-rose-700 underline hover:bg-rose-100">✓ checked</button>}
                      </div>
                    )}
                    {it.codes.length > 1 && (
                      <div className="mt-1 max-w-[12rem] font-mono text-[10px] leading-tight text-gray-400" title={'All codes recognised on this line:\n' + it.codes.join('  ')}>
                        +{it.codes.length - 1} more: {it.codes.slice(1).join(' ')}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input disabled={locked} value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })}
                      className="w-full min-w-[14rem] rounded border border-gray-200 px-1.5 py-1 text-xs disabled:bg-transparent disabled:border-transparent" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input disabled={locked} type="number" step="any" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })}
                      className="w-16 rounded border border-gray-200 px-1.5 py-1 text-right text-xs disabled:bg-transparent disabled:border-transparent" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input disabled={locked} type="number" step="0.01" value={it.unit_price} onChange={(e) => setItem(idx, { unit_price: Number(e.target.value) })}
                      className="w-20 rounded border border-gray-200 px-1.5 py-1 text-right text-xs disabled:bg-transparent disabled:border-transparent" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input disabled={locked} type="number" step="0.01" value={it.discount} onChange={(e) => setItem(idx, { discount: Number(e.target.value) })}
                      title="Per-line discount %, e.g. 15 for a 15% discount"
                      className="w-14 rounded border border-gray-200 px-1.5 py-1 text-right text-xs disabled:bg-transparent disabled:border-transparent" />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{rm(lineAmount(it.qty, it.unit_price, it.discount))}</td>
                  <td className="px-2 py-1.5">
                    {!candsLoaded ? <span className="text-xs text-gray-400">checking…</span> : pickerLine === idx ? (
                      <div className="flex w-64 flex-col gap-1">
                        <input autoFocus value={pq} onChange={(e) => searchProducts(e.target.value)} placeholder="search item name or code…"
                          className="rounded border border-blue-400 px-1.5 py-1 text-xs" />
                        {presults.length > 0 ? (
                          <div className="max-h-48 overflow-y-auto rounded border border-gray-200">
                            {presults.map((p) => (
                              <button key={p.sku} onClick={() => pickProduct(idx, p)}
                                className="block w-full border-b border-gray-100 px-1.5 py-1 text-left text-[11px] last:border-0 hover:bg-blue-50">
                                <span className="font-mono text-gray-500">{p.code || '—'}</span> {p.descp}{p.price ? ` · RM${p.price}` : ''}
                              </button>
                            ))}
                          </div>
                        ) : pq.trim().length >= 2 ? <span className="text-[10px] text-gray-400">No match — try fewer / different words.</span> : null}
                        <button onClick={() => { setPickerLine(null); setPq(''); setPresults([]); }} className="text-left text-[10px] text-gray-400 underline">cancel</button>
                      </div>
                    ) : (() => {
                      const cands = candsFor(it);
                      const res = resolutionFor(it);
                      if (res.kind === 'create') {
                        // No catalog code-match (or owner chose to create) → make a new product,
                        // OR pick an existing one from the full list (for code-less invoices).
                        return (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">🆕 create new product</span>
                            {it.in_niagawan === true && !it.sku_id && !it.will_create && cands.length === 0 && refreshLinkable(it) && (
                              <span className="max-w-[11rem] text-[10px] font-medium leading-tight text-amber-700" title="This code exists in Niagawan but isn't in the synced product list yet. Press “🔄 Refresh product list” up top to link it instead of creating a duplicate.">
                                ⚠ in Niagawan, not in synced list — Refresh ↑
                              </span>
                            )}
                            <select disabled={locked} value={cats.includes(it.category) ? it.category : ''} onChange={(e) => setItem(idx, { category: e.target.value })}
                              className="w-44 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-xs disabled:bg-transparent disabled:border-transparent" title="New item — pick the category it will be created in">
                              {!cats.includes(it.category) && <option value="">{it.category || '—'}</option>}
                              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            {!locked && <button onClick={() => openPicker(idx, it)} className="text-left text-[10px] font-medium text-blue-600 underline">🔎 or choose from existing items</button>}
                            {cands.length > 0 && !locked && (
                              <button onClick={() => setItem(idx, { will_create: false, sku_id: cands.length === 1 ? cands[0].sku : null })}
                                className="text-left text-[10px] text-blue-500 underline">{cands.length} code match{cands.length > 1 ? 'es' : ''} — link</button>
                            )}
                          </div>
                        );
                      }
                      if (res.kind === 'link') {
                        const m = cands.find((c) => c.sku === res.sku) || (it.niagawan_matches ?? []).find((c) => c.sku === res.sku) || picked[res.sku];
                        return (
                          <div className="flex flex-col gap-1">
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700" title="This purchase line will be booked to this exact product">
                              → {m ? `${m.code} — ${m.descp}` : `sku ${res.sku}`}
                            </span>
                            {!locked && (
                              <div className="flex flex-wrap gap-2">
                                <button onClick={() => openPicker(idx, it)} className="text-[10px] text-blue-500 underline">change / search</button>
                                <button onClick={() => setItem(idx, { will_create: true, sku_id: null })} className="text-[10px] text-blue-500 underline">create new instead</button>
                              </div>
                            )}
                          </div>
                        );
                      }
                      // Unresolved: several products share this code — the owner must choose one.
                      return (
                        <div className="flex flex-col gap-1">
                          <select disabled={locked} value="" onChange={(e) => { if (e.target.value) setItem(idx, { sku_id: e.target.value, will_create: false }); }}
                            className="w-64 rounded border border-rose-400 bg-rose-50 px-1.5 py-1 text-xs font-medium disabled:bg-transparent"
                            title="Several products share this code — choose which one this stock belongs to">
                            <option value="">⚠ {cands.length} products share this code — choose…</option>
                            {cands.map((m) => <option key={m.sku} value={m.sku}>{m.code} — {m.descp}{m.price ? ` (RM${m.price})` : ''}</option>)}
                          </select>
                          {!locked && (
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => openPicker(idx, it)} className="text-[10px] text-blue-500 underline">🔎 search all items</button>
                              <button onClick={() => setItem(idx, { will_create: true, sku_id: null })} className="text-[10px] text-blue-500 underline">none — create new</button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {showBilled && (
                    <td className="px-2 py-1.5">
                      {it.sold_status === 'found'
                        ? <span title={it.sold_on || ''} className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ {it.sold_on || 'billed'}</span>
                        : it.sold_status === 'check'
                          ? <span title={'Code found only in a sale invoice’s remark/note, not as a billed line item — open it to confirm:\n' + (it.sold_on || '')} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚠ check {it.sold_on || ''}</span>
                          : it.sold_status === 'not_found'
                            ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">✗ not billed</span>
                            : <span className="text-xs text-gray-400">—</span>}
                    </td>
                  )}
                  {!locked && (
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => removeRow(idx)} className="rounded px-1.5 py-0.5 text-xs text-rose-500 hover:bg-rose-50">✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Each line is booked to the product in the <b>Product</b> column. A code match links automatically; if there&rsquo;s no code (or no match) you can <b>🔎 choose an existing item</b> from the list (the search is pre-filled from the description) instead of creating a duplicate — or create a new product in the chosen <b>Category</b>. When several products share a code you pick the right one. The importer uses exactly what you chose here — no re-guessing, no duplicates.
      </p>

      {msg && <div className={`mt-3 rounded-md border p-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}

      {!locked && (
        <>
          {approveBlockers.length > 0 && (
            <div className="mt-4 rounded-md border-2 border-rose-400 bg-rose-50 p-3 text-sm text-rose-800">
              <div className="mb-1 font-semibold">⚠ Fix {approveBlockers.length === 1 ? 'this' : `these ${approveBlockers.length}`} before approving:</div>
              <ul className="ml-4 list-disc space-y-0.5">
                {approveBlockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => save(false)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={() => save(true)} disabled={busy || !candsLoaded || approveBlockers.length > 0}
              title={!candsLoaded ? 'Checking product matches…' : approveBlockers.length > 0 ? 'Resolve the issues listed above first' : undefined}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Working…' : 'Approve → create in Niagawan'}
            </button>
            {!candsLoaded && <span className="text-xs text-gray-400">checking product matches…</span>}
          </div>
        </>
      )}
    </div>
  );
}
