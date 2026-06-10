'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
};

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
  sold_status: string | null;
  sold_on: string | null;
  in_niagawan: boolean | null;
  niagawan_category: string | null;
  code_verified: boolean | null;
};

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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
        sold_status: (r.sold_status as string) ?? null,
        sold_on: (r.sold_on as string) ?? null,
        in_niagawan: (r.in_niagawan as boolean | null) ?? null,
        niagawan_category: (r.niagawan_category as string) ?? null,
        code_verified: (r.code_verified as boolean | null) ?? null,
      }))
    );
    setLoading(false);
  }, [id]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const computedTotal = useMemo(() => round2(items.reduce((s, it) => s + lineAmount(it.qty, it.unit_price, it.discount), 0)), [items]);
  const totalMismatch = head?.total != null && Math.abs(round2(head.total) - computedTotal) > 0.01;

  const setItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addRow = () => setItems((prev) => [...prev, { line_no: prev.length + 1, item_code: '', codes: [], description: '', qty: 1, unit_price: 0, discount: 0, amount: 0, category: 'SPARE PARTS ITEM', will_create: true, sold_status: null, sold_on: null, in_niagawan: null, niagawan_category: null, code_verified: null }]);
  const removeRow = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, line_no: i + 1 })));

  const save = useCallback(async (approve: boolean) => {
    if (!id || !head) return;
    setBusy(true); setMsg(null);
    try {
      const cleaned = items
        .map((it, i) => ({ ...it, line_no: i + 1, amount: lineAmount(it.qty, it.unit_price, it.discount) }))
        .filter((it) => it.item_code.trim() || it.codes.length || it.description.trim());
      if (approve) {
        if (cleaned.length === 0) throw new Error('Add at least one line item before approving.');
        if (cleaned.some((it) => !it.item_code.trim() && it.codes.length === 0)) throw new Error('Every item needs at least one code before approving.');
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
        const rows = cleaned.map((it) => ({
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
          // matched / will_create are decided authoritatively by the NAS at create time
        }));
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
  }, [id, head, items, load, router]);

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

  if (isAdmin === null || loading) return <div className="text-sm text-gray-500">Loading…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;
  if (!head) return <div className="text-sm text-gray-600">Invoice not found. <button onClick={() => router.push('/niagawan/purchase')} className="text-blue-600 underline">Back</button></div>;

  const locked = head.status === 'approved' || head.status === 'creating' || head.status === 'created';
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
          {head.file_path && <button onClick={viewPdf} className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">View PDF</button>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{head.status === 'created' && head.niagawan_pi_no ? head.niagawan_pi_no : head.status}</span>
        </div>
      </div>

      {locked && (
        <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-2 text-sm text-indigo-800">
          This invoice is {head.status}. It can no longer be edited.
        </div>
      )}

      {/* Which AI read this — flag clearly when the backup model was used so codes get extra scrutiny */}
      {head.read_model && (
        head.read_model.includes('3.5')
          ? <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">Read by primary AI (<span className="font-mono">{head.read_model}</span>).</div>
          : <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠️ Read by <b>backup AI</b> (<span className="font-mono">{head.read_model}</span>) because the primary was overloaded. Please <b>double-check the part codes</b> against the PDF before approving.</div>
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
            ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">⚠ differs from PDF total {rm(head.total ?? 0)}</span>
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

      {/* Items */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Line items ({items.length}){resolving && <span className="ml-2 font-normal text-amber-600">· looking up Niagawan categories…</span>}</h2>
        {!locked && <button onClick={addRow} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">+ Add row</button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
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
              <th className="px-2 py-2 font-medium text-gray-600">Category <span className="font-normal text-gray-400">(Niagawan · or pick if new)</span></th>
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
                    <input disabled={locked} value={it.item_code} onChange={(e) => setItem(idx, { item_code: e.target.value, code_verified: null })}
                      className={`w-36 rounded border px-1.5 py-1 font-mono text-xs disabled:bg-transparent ${it.code_verified === false ? 'border-rose-400 bg-rose-50' : 'border-gray-200 disabled:border-transparent'}`} />
                    {it.code_verified === false && (
                      <div className="mt-0.5 max-w-[12rem] text-[10px] font-medium leading-tight text-rose-600" title="This code was NOT found in the invoice's text — the AI may have misread it. Check it against the PDF.">
                        ⚠ not found in PDF text — check it
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
                    {resolving
                      ? <span className="text-xs text-gray-400">looking up…</span>
                      : it.in_niagawan === true
                        ? <span className="inline-flex items-center gap-1.5" title="Already in Niagawan — its category is not changed">
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{it.niagawan_category || '—'}</span>
                            <span className="text-[10px] uppercase tracking-wide text-gray-400">in Niagawan</span>
                          </span>
                        : <select disabled={locked} value={cats.includes(it.category) ? it.category : ''} onChange={(e) => setItem(idx, { category: e.target.value })}
                            className="w-44 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-xs disabled:bg-transparent disabled:border-transparent" title="New item — pick the category it will be created in">
                            {!cats.includes(it.category) && <option value="">{it.category || '—'}</option>}
                            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>}
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
        When you approve, the system checks each item code against Niagawan directly: existing items are added as-is, and any code Niagawan doesn&rsquo;t have yet is created as a new product first (in the chosen <b>Category</b>, selling price RM 0 for you to set later). The category is only used for items that need creating. No duplicates.
      </p>

      {msg && <div className={`mt-3 rounded-md border p-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}

      {!locked && (
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => save(false)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={() => save(true)} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Working…' : 'Approve → create in Niagawan'}
          </button>
        </div>
      )}
    </div>
  );
}
