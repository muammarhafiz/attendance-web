'use client';
// Manage Tyres — admin-only. Three jobs: (1) edit the service rates (valve/balancing/alignment),
// (2) import a supplier's price list from a PDF/photo (AI reads it → you preview the computed
// retail → Save), (3) search / edit / hide / delete existing tyres. Everything is gated by
// is_admin() both here and in the RPCs; the customer-facing tyre quote never shows any of this.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Rates = { valve_rate: number; balancing_rate: number; alignment_sedan: number; alignment_suv: number };
type Extracted = { brand: string; model: string; size: string; cost: number | null; retail: number | null; origin: string; load_speed: string };
type EditRow = { brand: string; model: string; size: string; cost: string; retail: string; origin: string; load_speed: string };
type ManageRow = {
  id: number; dealer: string | null; dealer_phone: string | null; brand: string; pattern: string | null;
  origin: string | null; size: string; rim: number | null; load_speed: string | null;
  cost: number | null; retail: number | null; hidden: boolean; price_list_date: string | null;
};

const DEALERS = ['Lee Kim Yean', 'Siow', 'Michael', 'Oscar'];
const DEALER_PHONES: Record<string, string> = {
  'Lee Kim Yean': '0125206232', Siow: '0123591990', Michael: '0199885687', Oscar: '0122323210',
};
const rm = (n: number | null | undefined) => `RM${Math.round(Number(n || 0)).toLocaleString('en-MY')}`;
const today = () => new Date().toISOString().slice(0, 10);

// Parse a price the owner typed — tolerant of "1,250", "RM250", spaces. Returns a positive number
// or null (so a stray comma can never reach the DB cast and abort a save).
const cleanNum = (s: unknown): number | null => {
  const n = Number(String(s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The house markup — MUST match scrape.js / tyre_build.py. If the list prints a retail, use it;
// else cost ≤120 → +RM40, ≤280 → +30%, else +20%. Shown as a suggestion; the owner can override.
function suggestedRetail(cost: number | null, printed: number | null): number {
  if (printed && printed > 0) return Math.round(printed);
  const c = Number(cost || 0);
  if (c <= 0) return 0;
  if (c <= 120) return Math.round(c + 40);
  if (c <= 280) return Math.round(c * 1.3);
  return Math.round(c * 1.2);
}

const fileToBase64 = (file: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

export default function TyresAdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // rates
  const [rates, setRates] = useState<Rates | null>(null);
  const [savingRates, setSavingRates] = useState(false);
  const [ratesMsg, setRatesMsg] = useState('');

  // import
  const [dealer, setDealer] = useState('');
  const [brand, setBrand] = useState(''); // single-brand lists (e.g. Rovelo) have no per-row brand — fills blanks
  const [phone, setPhone] = useState('');
  const [listDate, setListDate] = useState(today());
  const [replace, setReplace] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importErr, setImportErr] = useState('');
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // manage
  const [q, setQ] = useState('');
  const [list, setList] = useState<ManageRow[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [editMsg, setEditMsg] = useState('');
  const [rev, setRev] = useState(0); // bumped to force an inline input to remount back to its stored value

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('is_admin');
      setIsAdmin(data === true);
      if (data === true) {
        const { data: cfg } = await supabase.rpc('tyre_config_get');
        if (cfg) setRates(cfg as Rates);
      }
    })();
  }, []);

  const token = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }, []);

  const saveRates = useCallback(async () => {
    if (!rates) return;
    setSavingRates(true); setRatesMsg('');
    const { data, error } = await supabase.rpc('tyre_config_set', {
      p_valve: rates.valve_rate, p_balancing: rates.balancing_rate,
      p_align_sedan: rates.alignment_sedan, p_align_suv: rates.alignment_suv,
    });
    setSavingRates(false);
    if (error) { setRatesMsg(error.message); return; }
    if (data) setRates(data as Rates);
    setRatesMsg('Saved ✓'); setTimeout(() => setRatesMsg(''), 2000);
  }, [rates]);

  // Reading a supplier list can't be done in one server request: a long price list takes longer than
  // Vercel's 60s function cap. So the page LOOP lives HERE in the browser (no time limit) — exactly the
  // invoice reader's "one small bounded AI call per request" principle, repeated once per page:
  //   1) one 'split' request pulls the per-page text (no AI, fast),
  //   2) one 'page' request reads EACH page (~15s each, always under 60s), run a few at a time,
  //   3) merge + dedupe the rows. A photo / scanned PDF (no text layer) → one 'vision' request instead.
  const onFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setImportErr(''); setSaveMsg(''); setRows(null); setProgress(null); setExtracting(true);
    // Single-brand lists (e.g. Rovelo) print the brand only in the header/filename, not on each row.
    // Best-effort pre-fill the Brand field from the filename if it's empty, so blank rows get a brand.
    setBrand((cur) => {
      if (cur.trim()) return cur;
      return file.name.replace(/\.[^.]+$/, '')
        .replace(/price\s*list|pricelist|updated|revised|\b\d{1,2}(st|nd|rd|th)?\b|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|\b\d{4}\b|[-_()]/gi, ' ')
        .replace(/\s+/g, ' ').trim();
    });
    try {
      const data = await fileToBase64(file);
      const mimeType = file.type || 'application/pdf';
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` };
      const call = async (payload: Record<string, unknown>) => {
        const r = await fetch('/api/tyre-extract', { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
        const t = await r.text();
        let j: { pages?: unknown; rows?: unknown; error?: string };
        try { j = JSON.parse(t); } catch { throw new Error(r.ok ? 'Unexpected response from the reader.' : `Read failed (${r.status}).`); }
        if (!r.ok) throw new Error(j?.error || `Read failed (${r.status})`);
        return j;
      };

      // 1) per-page text (photos / scanned PDFs come back with no pages → vision fallback below)
      let pages: string[] = [];
      if (mimeType === 'application/pdf') {
        const split = await call({ mode: 'split', data, mimeType });
        pages = Array.isArray(split.pages) ? (split.pages as string[]) : [];
      }

      let gathered: Extracted[] = [];
      const failedPages: number[] = [];
      if (pages.length > 0) {
        // 2) read every page in its own request; limited concurrency so Google doesn't throttle many
        // calls on one key, with a couple of retries per page before it's counted as failed.
        setProgress({ done: 0, total: pages.length });
        const results: Extracted[][] = Array.from({ length: pages.length }, () => []);
        let nextIdx = 0, done = 0;
        const worker = async () => {
          for (;;) {
            const i = nextIdx++;
            if (i >= pages.length) return;
            let ok = false;
            for (let attempt = 0; attempt < 3 && !ok; attempt++) {
              try {
                const j = await call({ mode: 'page', pageText: pages[i] });
                results[i] = Array.isArray(j.rows) ? (j.rows as Extracted[]) : [];
                ok = true;
              } catch { /* transient — retry */ }
            }
            if (!ok) failedPages.push(i + 1);
            setProgress({ done: ++done, total: pages.length });
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, pages.length) }, worker));
        gathered = results.flat();
      } else {
        setProgress({ done: 0, total: 1 });
        const j = await call({ mode: 'vision', data, mimeType });
        gathered = Array.isArray(j.rows) ? (j.rows as Extracted[]) : [];
        setProgress({ done: 1, total: 1 });
      }

      // 3) merge + dedupe across pages (a tyre repeated at a page break)
      const seen = new Set<string>();
      const ex: Extracted[] = [];
      for (const e of gathered) {
        if (!e || !e.size || e.cost == null) continue; // brand may be blank on single-brand lists
        const k = `${e.brand}|${e.size}|${e.model}|${e.cost}`.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k); ex.push(e);
      }

      if (!ex.length) {
        setImportErr(failedPages.length
          ? `Couldn't read any pages (${failedPages.length} failed). Try again, or send a clearer PDF/photo.`
          : 'No tyres found in that file. Try a clearer PDF/photo.');
        return;
      }
      setRows(ex.map((e) => ({
        brand: e.brand, model: e.model, size: e.size,
        cost: e.cost != null ? String(e.cost) : '',
        retail: String(suggestedRetail(e.cost, e.retail)),
        origin: e.origin, load_speed: e.load_speed,
      })));
      if (failedPages.length) {
        setImportErr(`Read ${ex.length} tyres, but ${failedPages.length} page${failedPages.length === 1 ? '' : 's'} couldn't be read (page ${failedPages.sort((a, b) => a - b).join(', ')}). Review & Save below, then re-import the same file to pick up the missed pages.`);
      }
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false); setProgress(null);
    }
  }, [token]);

  const setRow = (i: number, patch: Partial<EditRow>) =>
    setRows((prev) => prev?.map((r, j) => (j === i ? { ...r, ...patch } : r)) ?? null);
  const dropRow = (i: number) => setRows((prev) => prev?.filter((_, j) => j !== i) ?? null);

  const saveImport = useCallback(async () => {
    if (!rows || !rows.length) return;
    if (!dealer.trim()) { setImportErr('Pick or type the supplier name first.'); return; }
    // Blank per-row brands fall back to the "Tyre brand" field (single-brand lists like Rovelo).
    const fb = brand.trim();
    if (!fb && rows.every((r) => !r.brand.trim())) {
      setImportErr('This list has no brand per row — type the tyre brand (e.g. Rovelo) in the Tyre brand field above.'); return;
    }
    setSaving(true); setImportErr(''); setSaveMsg('');
    const payload = rows
      .map((r) => ({ r, retail: cleanNum(r.retail), cost: cleanNum(r.cost) }))
      .filter((x) => (x.r.brand.trim() || fb) && x.r.size.trim() && x.retail != null)
      .map(({ r, retail, cost }) => ({
        brand: r.brand.trim() || fb, pattern: r.model.trim(), size: r.size.trim(),
        cost, retail, origin: r.origin.trim(), load_speed: r.load_speed.trim(),
      }));
    const { data, error } = await supabase.rpc('tyre_admin_save_import', {
      p_rows: payload, p_dealer: dealer.trim(), p_phone: phone.trim(), p_list_date: listDate, p_replace: replace,
    });
    setSaving(false);
    if (error) { setImportErr(error.message); return; }
    setSaveMsg(`Saved ${data} tyre${data === 1 ? '' : 's'} for ${dealer.trim()}${replace ? ' (replaced the old list)' : ''}.`);
    setRows(null); setReplace(false);
  }, [rows, dealer, brand, phone, listDate, replace]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const { data } = await supabase.rpc('tyre_admin_list', { q, include_hidden: true });
    setList((data ?? []) as ManageRow[]);
    setLoadingList(false);
  }, [q]);

  const patchRow = useCallback(async (id: number, patch: Record<string, unknown>) => {
    setEditMsg('');
    setList((prev) => prev?.map((r) => (r.id === id ? { ...r, ...patch } as ManageRow : r)) ?? null);
    const { error } = await supabase.rpc('tyre_admin_update', { p_id: id, p_patch: patch });
    if (error) { setEditMsg('Could not save that change — reverted. ' + error.message); setRev((v) => v + 1); await loadList(); }
  }, [loadList]);

  // Save a cost/retail cell: parse tolerantly; an unparseable value reverts the cell (no silent save).
  const saveCell = useCallback((r: ManageRow, field: 'cost' | 'retail', raw: string) => {
    const clean = cleanNum(raw);
    const cur = field === 'cost' ? r.cost : r.retail;
    if (clean === cur) return;
    if (clean == null) { setEditMsg('That price didn’t look like a number — not saved.'); setRev((v) => v + 1); return; }
    patchRow(r.id, { [field]: clean });
  }, [patchRow]);

  const deleteRow = useCallback(async (r: ManageRow) => {
    if (!window.confirm(`Delete ${[r.brand, r.pattern].filter(Boolean).join(' ')} ${r.size}? This can't be undone.`)) return;
    setList((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
    const { error } = await supabase.rpc('tyre_admin_delete', { p_ids: [r.id] });
    if (error) await loadList();
  }, [loadList]);

  const importTotal = useMemo(() => rows?.filter((r) => (r.brand.trim() || brand.trim()) && r.size.trim() && cleanNum(r.retail) != null).length ?? 0, [rows, brand]);

  if (isAdmin === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!isAdmin) return <div className="p-6 text-sm text-ink-2">Manage Tyres is for the owner/admin only.</div>;

  const inp = 'rounded-lg border border-line bg-card px-2 py-1 text-sm';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Manage Tyres</h1>
        <a href="/workshop" className="text-sm text-accent hover:underline">← Back to workshop</a>
      </div>

      {/* ---------- Service rates ---------- */}
      <section className="mb-6 rounded-xl border border-line bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">Service rates</h2>
        <p className="mb-3 text-xs text-ink-3">Used in every tyre quote. Valve & balancing are per tyre; alignment is once per job.</p>
        {rates ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ['Valve / tyre', 'valve_rate'], ['Balancing / tyre', 'balancing_rate'],
                ['Alignment — Sedan', 'alignment_sedan'], ['Alignment — SUV', 'alignment_suv'],
              ] as [string, keyof Rates][]).map(([label, k]) => (
                <label key={k} className="text-xs text-ink-2">
                  <span className="mb-1 block">{label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-ink-3">RM</span>
                    <input type="number" inputMode="decimal" value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: Number(e.target.value) })} className={`${inp} w-20`} />
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button onClick={saveRates} disabled={savingRates} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{savingRates ? 'Saving…' : 'Save rates'}</button>
              {ratesMsg && <span className="text-xs text-good">{ratesMsg}</span>}
            </div>
          </>
        ) : <div className="text-sm text-ink-3">Loading…</div>}
      </section>

      {/* ---------- Import a supplier list ---------- */}
      <section className="mb-6 rounded-xl border border-line bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">Import a supplier price list</h2>
        <p className="mb-3 text-xs text-ink-3">Upload the supplier's PDF (or a clear photo). The AI reads the tyres; you check the retail it works out, then Save. Send me COST prices — retail is computed for you.</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-xs text-ink-2 sm:col-span-2">
            <span className="mb-1 block">Supplier</span>
            <input list="dealers" value={dealer} onChange={(e) => { const v = e.target.value; setDealer(v); if (DEALER_PHONES[v]) setPhone(DEALER_PHONES[v]); }} placeholder="e.g. Siow" className={`${inp} w-full`} />
            <datalist id="dealers">{DEALERS.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <label className="text-xs text-ink-2">
            <span className="mb-1 block">Tyre brand</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Rovelo" className={`${inp} w-full`} />
          </label>
          <label className="text-xs text-ink-2">
            <span className="mb-1 block">Supplier phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0123456789" className={`${inp} w-full`} />
          </label>
          <label className="text-xs text-ink-2">
            <span className="mb-1 block">Price-list date</span>
            <input type="date" value={listDate} onChange={(e) => setListDate(e.target.value)} className={`${inp} w-full`} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            {extracting ? (progress ? `Reading… ${progress.done}/${progress.total}` : 'Reading…') : '📄 Choose PDF / photo'}
            <input type="file" accept="application/pdf,image/*" className="hidden" disabled={extracting} onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; onFile(f); }} />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-4 w-4 accent-rose-600" />
            Replace ALL existing {dealer.trim() || 'this supplier'} tyres with this list
          </label>
        </div>

        {importErr && <div className="mt-3 rounded-md border border-rose-200 bg-bad-soft p-2 text-sm text-bad">{importErr}</div>}
        {saveMsg && <div className="mt-3 rounded-md border border-emerald-200 bg-good-soft p-2 text-sm text-good">{saveMsg}</div>}

        {rows && (
          <div className="mt-4">
            <div className="mb-2 text-xs text-ink-3">{importTotal} tyre{importTotal === 1 ? '' : 's'} read — check & edit, then Save. Retail is the house markup; change any if you want.</div>
            {rows.some((r) => !r.brand.trim()) && (
              <div className="mb-2 rounded-md border border-amber-200 bg-warn-soft p-2 text-xs text-warn">
                This list shows no brand on each row — blank rows will be saved as “<b>{brand.trim() || '…'}</b>”. Set the <b>Tyre brand</b> field above if that’s not right.
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-ink/5 text-left text-xs text-ink-3">
                  <tr><th className="p-2">Brand</th><th className="p-2">Model</th><th className="p-2">Size</th><th className="p-2">Cost</th><th className="p-2">Retail</th><th className="p-2">Origin</th><th className="p-2"></th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r, i) => (
                    <tr key={i} className={(!r.brand.trim() && !brand.trim()) || !r.size.trim() || !r.retail.trim() ? 'bg-bad-soft/40' : ''}>
                      <td className="p-1"><input value={r.brand} onChange={(e) => setRow(i, { brand: e.target.value })} placeholder={brand.trim() || 'brand'} className={`${inp} w-24`} /></td>
                      <td className="p-1"><input value={r.model} onChange={(e) => setRow(i, { model: e.target.value })} placeholder="—" className={`${inp} w-28`} /></td>
                      <td className="p-1"><input value={r.size} onChange={(e) => setRow(i, { size: e.target.value })} className={`${inp} w-24 font-mono`} /></td>
                      <td className="p-1"><input value={r.cost} onChange={(e) => setRow(i, { cost: e.target.value })} inputMode="decimal" className={`${inp} w-16`} /></td>
                      <td className="p-1"><input value={r.retail} onChange={(e) => setRow(i, { retail: e.target.value })} inputMode="decimal" className={`${inp} w-16 font-semibold`} /></td>
                      <td className="p-1"><input value={r.origin} onChange={(e) => setRow(i, { origin: e.target.value })} placeholder="—" className={`${inp} w-20`} /></td>
                      <td className="p-1 text-right"><button onClick={() => dropRow(i)} className="rounded px-1.5 py-0.5 text-xs text-bad hover:bg-bad-soft" title="Remove this row">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button onClick={saveImport} disabled={saving || !importTotal} className="rounded-lg bg-good px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : `Save ${importTotal} tyre${importTotal === 1 ? '' : 's'}`}</button>
              <button onClick={() => { setRows(null); setImportErr(''); }} className="text-xs text-ink-3 hover:text-ink-2">Discard</button>
            </div>
          </div>
        )}
      </section>

      {/* ---------- Manage existing ---------- */}
      <section className="mb-6 rounded-xl border border-line bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">Find & edit tyres</h2>
        <p className="mb-3 text-xs text-ink-3">Search by size or brand. Edit cost/retail inline (saves on change), hide a discontinued tyre, or delete.</p>
        <div className="mb-3 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadList()} placeholder="e.g. 205/55R16, Goodyear, Oscar…" className={`${inp} flex-1`} />
          <button onClick={loadList} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">Search</button>
        </div>

        {editMsg && <div className="mb-3 rounded-md border border-amber-200 bg-warn-soft p-2 text-sm text-warn">{editMsg}</div>}
        {loadingList && <div className="py-4 text-sm text-ink-3">Loading…</div>}
        {list && !loadingList && (
          <>
            <div className="mb-2 text-xs text-ink-3">{list.length} tyre{list.length === 1 ? '' : 's'}{list.length === 500 ? ' (showing first 500 — narrow the search)' : ''}</div>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-ink/5 text-left text-xs text-ink-3">
                  <tr><th className="p-2">Tyre</th><th className="p-2">Size</th><th className="p-2">Supplier</th><th className="p-2">Cost</th><th className="p-2">Retail</th><th className="p-2">List date</th><th className="p-2">Show</th><th className="p-2"></th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-ink-3">No tyres match.</td></tr>}
                  {list.map((r) => (
                    <tr key={r.id} className={r.hidden ? 'opacity-50' : ''}>
                      <td className="p-2"><span className="font-medium text-ink-2">{[r.brand, r.pattern].filter(Boolean).join(' ')}</span>{r.origin ? <span className="ml-1 text-xs text-ink-3">{r.origin}</span> : null}</td>
                      <td className="p-2 font-mono text-xs">{r.size}</td>
                      <td className="p-2 text-xs text-ink-2">{r.dealer || '—'}</td>
                      <td className="p-1"><input key={`c${r.id}:${r.cost ?? ''}:${rev}`} defaultValue={r.cost ?? ''} onBlur={(e) => saveCell(r, 'cost', e.target.value)} inputMode="decimal" className={`${inp} w-16`} /></td>
                      <td className="p-1"><input key={`r${r.id}:${r.retail ?? ''}:${rev}`} defaultValue={r.retail ?? ''} onBlur={(e) => saveCell(r, 'retail', e.target.value)} inputMode="decimal" className={`${inp} w-16 font-semibold`} /></td>
                      <td className="p-2 text-xs text-ink-3">{r.price_list_date || '—'}</td>
                      <td className="p-2"><input type="checkbox" checked={!r.hidden} onChange={(e) => patchRow(r.id, { hidden: !e.target.checked })} className="h-4 w-4 accent-emerald-600" title={r.hidden ? 'Hidden — tick to show' : 'Shown — untick to hide'} /></td>
                      <td className="p-2 text-right"><button onClick={() => deleteRow(r)} className="rounded px-1.5 py-0.5 text-xs text-bad hover:bg-bad-soft">Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
