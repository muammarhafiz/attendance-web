'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  created_at: string;
};

type MailSupplier = { id: string; name: string; match_terms: string[]; enabled: boolean; note: string | null; folder_id: string | null; folder_name: string | null };
type DriveFolder = { folder_id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  uploaded: 'bg-gray-100 text-gray-600',
  extracting: 'bg-amber-100 text-amber-700',
  extracted: 'bg-blue-100 text-blue-700',
  approved: 'bg-indigo-100 text-indigo-700',
  creating: 'bg-amber-100 text-amber-700',
  created: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  dismissed: 'bg-gray-200 text-gray-500',
};
const fmtD = (d: string | null) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const rm = (n: number | null) => (n == null ? '—' : `RM ${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function PurchaseInvoicePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Pinv[]>([]);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [readSecs, setReadSecs] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [mailCheck, setMailCheck] = useState<'idle' | 'running'>('idle');
  const [showDismissed, setShowDismissed] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  // self-service auto-import supplier list (read live by the mailbox script)
  const [suppliers, setSuppliers] = useState<MailSupplier[]>([]);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [supName, setSupName] = useState('');
  const [supTerms, setSupTerms] = useState('');
  const [supFolder, setSupFolder] = useState(''); // picked Drive folder id for the new supplier (required)
  const [supBusy, setSupBusy] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]); // DOWNLOAD-SHARED subfolders, reported by the mailbox script

  // Tick a live elapsed-seconds counter while a read is in progress, so the user can see the
  // system is actively working (an AI read can take 15–50s) and isn't frozen.
  useEffect(() => {
    if (!readingId) { setReadSecs(0); return; }
    setReadSecs(0);
    const t = setInterval(() => setReadSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [readingId]);

  const readingRow = rows.find((r) => r.id === readingId) ?? null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: ok } = await supabase.rpc('is_admin'); setIsAdmin(ok === true); }
      else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('pinv').select('*').order('created_at', { ascending: false }).limit(100);
    if (!showDismissed) q = q.neq('status', 'dismissed');
    if (supplierFilter) q = q.eq('supplier_name', supplierFilter);
    const { data } = await q;
    setRows((data ?? []) as Pinv[]);
    setLoading(false);
  }, [showDismissed, supplierFilter]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const upload = useCallback(async () => {
    if (!file) { setMsg({ kind: 'err', text: 'Choose a PDF first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const email = sess.session?.user?.email ?? 'unknown';
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const up = await supabase.storage.from('pinv').upload(path, file, { upsert: false, contentType: ext === 'pdf' ? 'application/pdf' : undefined });
      if (up.error) throw up.error;
      const { error } = await supabase.from('pinv').insert({ file_path: path, status: 'uploaded', created_by: email });
      if (error) throw error;
      setMsg({ kind: 'ok', text: 'Uploaded ✓ — ready to read.' });
      setFile(null);
      await load();
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [file, load]);

  const readInvoice = useCallback(async (id: string) => {
    setReadingId(id); setMsg(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      const res = await fetch('/api/pinv/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Read failed (${res.status})`);
      const backup = typeof j?.model === 'string' && !j.model.includes('3.5');
      const flagged = Number(j?.flagged) || 0;
      setMsg({ kind: flagged ? 'err' : 'ok', text: `Read ✓ — found ${j.items ?? 0} line item${j.items === 1 ? '' : 's'}.${backup ? ` (backup AI ${j.model})` : ''}${flagged ? ` ⚠ ${flagged} code${flagged === 1 ? '' : 's'} not found in the PDF text — check on Review.` : ''}` });
      await load();
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
      await load();
    } finally {
      setReadingId(null);
    }
  }, [load]);

  // Ask the workshop mailbox (zordaqputrajaya@gmail.com) to fetch supplier invoice PDFs NOW.
  // Queued via sync_requests -> the NAS calls the mailbox script (token stays server-side).
  const checkEmail = useCallback(async () => {
    if (mailCheck === 'running') return;
    setMailCheck('running'); setMsg(null);
    const { data, error } = await supabase.from('sync_requests').insert({ which: 'email-check', source: 'website' }).select('id').single();
    if (error || !data) { setMailCheck('idle'); setMsg({ kind: 'err', text: 'Could not start the email check: ' + (error?.message ?? 'unknown') }); return; }
    const id = data.id as number;
    const startedAt = Date.now();
    const t = setInterval(async () => {
      const { data: row } = await supabase.from('sync_requests').select('status,result').eq('id', id).single();
      if (row?.status === 'done' || row?.status === 'error') {
        clearInterval(t);
        setMailCheck('idle');
        if (row.status === 'done') {
          const m = (row.result || '').match(/saved=(\d+)\s+unknown-sender=(\d+)/);
          const saved = m ? Number(m[1]) : 0, unknown = m ? Number(m[2]) : 0;
          setMsg({
            kind: 'ok',
            text: saved
              ? `📧 Email checked — ${saved} invoice(s) saved to the “Supplier Invoices” folder in Drive (details emailed).${unknown ? ` ${unknown} PDF(s) from unknown senders were skipped.` : ''}`
              : `📧 Email checked — no new supplier invoices found.${unknown ? ` ${unknown} PDF(s) from unknown senders were skipped (see email).` : ''}`,
          });
        } else {
          setMsg({ kind: 'err', text: 'Email check failed — make sure the v2 mailbox script is deployed (see email/NAS log).' });
        }
      } else if (Date.now() - startedAt > 3 * 60 * 1000) {
        clearInterval(t); setMailCheck('idle');
        setMsg({ kind: 'err', text: 'Email check is taking long — it may still finish in the background.' });
      }
    }, 4000);
  }, [mailCheck]);

  // Dismiss = hide an invoice we won't process (e.g. it's already keyed into Niagawan manually).
  // Nothing in Niagawan is touched and the PDF stays in Drive; reversible via "Show dismissed".
  const dismiss = useCallback(async (r: Pinv) => {
    if (!window.confirm(`Dismiss ${r.ref_no || 'this invoice'}? It will be hidden from this list — nothing is changed in Niagawan. You can restore it with "Show dismissed".`)) return;
    const { error } = await supabase.from('pinv').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) setMsg({ kind: 'err', text: error.message });
    else { setMsg({ kind: 'ok', text: `Dismissed ${r.ref_no || 'invoice'} ✓ — tick "Show dismissed" if you need it back.` }); await load(); }
  }, [load]);

  const restore = useCallback(async (r: Pinv) => {
    // Back to 'extracted' if it has been read before (supplier/total present), else back to 'uploaded'.
    const back = r.supplier_name || r.total != null ? 'extracted' : 'uploaded';
    const { error } = await supabase.from('pinv').update({ status: back, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) setMsg({ kind: 'err', text: error.message });
    else { setMsg({ kind: 'ok', text: `Restored ${r.ref_no || 'invoice'} ✓` }); await load(); }
  }, [load]);

  const viewPdf = useCallback(async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from('pinv').createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }, []);

  // --- self-service auto-import suppliers (the mailbox script reads this list live) ---
  const loadSuppliers = useCallback(async () => {
    const { data } = await supabase.from('mail_suppliers').select('id,name,match_terms,enabled,note,folder_id,folder_name').order('name');
    setSuppliers((data ?? []) as MailSupplier[]);
  }, []);
  const loadFolders = useCallback(async () => {
    const { data } = await supabase.from('drive_folders').select('folder_id,name').order('name');
    setFolders((data ?? []) as DriveFolder[]);
  }, []);
  useEffect(() => { if (isAdmin) { loadSuppliers(); loadFolders(); } }, [isAdmin, loadSuppliers, loadFolders]);

  const addSupplier = useCallback(async () => {
    const name = supName.trim();
    const terms = supTerms.split(/[,\n]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!name) { setMsg({ kind: 'err', text: 'Enter the supplier name.' }); return; }
    if (!terms.length) { setMsg({ kind: 'err', text: 'Enter at least one word that identifies them (e.g. their name).' }); return; }
    if (!supFolder) { setMsg({ kind: 'err', text: 'Pick the folder where this supplier’s invoices save (and are watched).' }); return; }
    const folder = folders.find((f) => f.folder_id === supFolder) || null;
    setSupBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const { error } = await supabase.from('mail_suppliers').insert({
      name, match_terms: terms, folder_id: supFolder, folder_name: folder?.name ?? null,
      created_by: sess.session?.user?.email ?? null,
    });
    setSupBusy(false);
    if (error) { setMsg({ kind: 'err', text: error.message }); return; }
    setSupName(''); setSupTerms(''); setSupFolder('');
    setMsg({ kind: 'ok', text: `Added ${name} ✓ — emailed invoices auto-import, and PDFs dropped into ${folder?.name ?? 'the folder'} import too.` });
    await loadSuppliers();
  }, [supName, supTerms, supFolder, folders, loadSuppliers]);

  const setSupplierFolder = useCallback(async (s: MailSupplier, folderId: string) => {
    const folder = folders.find((f) => f.folder_id === folderId) || null;
    await supabase.from('mail_suppliers').update({ folder_id: folderId || null, folder_name: folder?.name ?? null, updated_at: new Date().toISOString() }).eq('id', s.id);
    await loadSuppliers();
  }, [folders, loadSuppliers]);

  const toggleSupplier = useCallback(async (s: MailSupplier) => {
    await supabase.from('mail_suppliers').update({ enabled: !s.enabled, updated_at: new Date().toISOString() }).eq('id', s.id);
    await loadSuppliers();
  }, [loadSuppliers]);

  const deleteSupplier = useCallback(async (s: MailSupplier) => {
    if (!window.confirm(`Remove ${s.name} from auto-import?`)) return;
    await supabase.from('mail_suppliers').delete().eq('id', s.id);
    await loadSuppliers();
  }, [loadSuppliers]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!authed) return <div className="text-sm text-gray-600">Please sign in.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div>
      {/* Upload */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-800">Upload a supplier purchase invoice (PDF)</div>
        <div className="mt-0.5 text-xs text-gray-400">
          Upload the PDF → click <b>Read</b> so the system extracts it → <b>Review</b> &amp; fix → approve to create it in Niagawan.
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            📎 Choose PDF
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
          </label>
          <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{file ? file.name : 'No file chosen'}</span>
          <button onClick={upload} disabled={busy || !file} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Uploading…' : 'Upload'}
          </button>
          <button onClick={checkEmail} disabled={mailCheck === 'running'} title="Pull supplier invoices now — scans the workshop email AND your watched supplier folders (PDFs dropped into them)"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {mailCheck === 'running' ? 'Checking…' : '📧 Check email & folders now'}
          </button>
        </div>
        {msg && <div className={`mt-2 rounded-md border p-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}
      </div>

      {/* Auto-import suppliers — self-service list the mailbox reads to recognise senders */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white">
        <button onClick={() => setShowSuppliers((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-sm font-medium text-gray-800">📥 Auto-import suppliers <span className="text-gray-400">({suppliers.length})</span></span>
          <span className="text-xs text-gray-400">{showSuppliers ? 'hide' : 'manage'}</span>
        </button>
        {showSuppliers && (
          <div className="border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">
              Invoices emailed from these suppliers are picked up &amp; read automatically. Add one by name + a word
              that appears in their email, and pick the <b>folder</b> where their invoices save — that folder is also
              <b> watched</b>, so any PDF you drop into it imports too.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600">Supplier name</span>
                <input value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="e.g. Tat Seng"
                  className="mt-0.5 w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="block min-w-0 flex-1">
                <span className="block text-xs font-medium text-gray-600">Recognise by (comma-separated)</span>
                <input value={supTerms} onChange={(e) => setSupTerms(e.target.value)} placeholder="e.g. tat seng, tatseng"
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600">Folder (save + watch) *</span>
                <select value={supFolder} onChange={(e) => setSupFolder(e.target.value)}
                  className="mt-0.5 w-48 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
                  <option value="">— pick folder —</option>
                  {folders.map((f) => <option key={f.folder_id} value={f.folder_id}>{f.name}</option>)}
                </select>
              </label>
              <button onClick={addSupplier} disabled={supBusy}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {supBusy ? 'Adding…' : 'Add'}
              </button>
            </div>
            {folders.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                Folder list is empty — it fills in after the next email check (runs every 15 min, or click &ldquo;📧 Check email now&rdquo; above), then pick a folder.
              </p>
            )}
            <div className="mt-3 space-y-1.5">
              {suppliers.length === 0 ? (
                <div className="text-xs text-gray-400">No custom suppliers added yet.</div>
              ) : suppliers.map((s) => (
                <div key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm ${s.enabled ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <span className="ml-2 text-xs text-gray-400">{(s.match_terms || []).join(', ')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={s.folder_id ?? ''} onChange={(e) => setSupplierFolder(s, e.target.value)}
                      title="Folder where invoices save & are watched"
                      className={`rounded-md border px-2 py-0.5 text-xs ${s.folder_id ? 'border-gray-300 bg-white text-gray-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                      <option value="">⚠ pick folder</option>
                      {folders.map((f) => <option key={f.folder_id} value={f.folder_id}>{f.name}</option>)}
                    </select>
                    <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-500">
                      <input type="checkbox" checked={s.enabled} onChange={() => toggleSupplier(s)} className="h-3.5 w-3.5" /> on
                    </label>
                    <button onClick={() => deleteSupplier(s)} title="Remove" className="rounded border border-gray-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50">✕</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-gray-400">
              Built-in (always recognised): Grand Auto, Liqui Moly, Mannol, Gulf, Atomlubes — no need to add these.
            </p>
          </div>
        )}
      </div>

      {/* Live processing banner — shows the AI read is actively working (not stuck) */}
      {readingId && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <svg className="h-5 w-5 shrink-0 animate-spin text-amber-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          <div className="min-w-0 text-sm">
            <div className="font-semibold text-amber-900">
              Reading {readingRow?.ref_no ? <span className="font-mono">{readingRow.ref_no}</span> : 'invoice'} with AI… <span className="tabular-nums">({readSecs}s)</span>
            </div>
            <div className="text-xs text-amber-700">
              This usually takes 15–50 seconds (up to ~60s for big invoices). Please keep this page open — don&apos;t press Read again.
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Uploaded invoices</h2>
          {supplierFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {supplierFilter}
              <button onClick={() => setSupplierFilter(null)} title="Clear supplier filter" className="text-blue-500 hover:text-blue-800">✕</button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="h-3.5 w-3.5" />
            Show dismissed
          </label>
          <button onClick={load} disabled={loading} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">{loading ? '…' : 'Refresh'}</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-gray-600">Uploaded</th>
              <th className="px-3 py-2 font-medium text-gray-600">Supplier</th>
              <th className="px-3 py-2 font-medium text-gray-600">Ref#</th>
              <th className="px-3 py-2 font-medium text-gray-600">Date</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Total</th>
              <th className="px-3 py-2 font-medium text-gray-600">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No invoices uploaded yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-500">{new Date(r.created_at).toLocaleDateString('en-MY')}</td>
                <td className="px-3 py-2 text-gray-900">
                  {r.supplier_name ? (
                    <button
                      onClick={() => setSupplierFilter(r.supplier_name)}
                      title={`Show only invoices from ${r.supplier_name}`}
                      className="text-left text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {r.supplier_name}
                    </button>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-700">{r.ref_no ?? '—'}</td>
                <td className="px-3 py-2 text-gray-700">{fmtD(r.invoice_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rm(r.total)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {r.status === 'created' && r.niagawan_pi_no ? r.niagawan_pi_no : r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {(r.status === 'uploaded' || r.status === 'error') && (
                      <button onClick={() => readInvoice(r.id)} disabled={readingId === r.id} className="rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        {readingId === r.id ? 'Reading…' : 'Read'}
                      </button>
                    )}
                    {(r.status === 'extracted' || r.status === 'approved' || r.status === 'creating' || r.status === 'created') && (
                      <button onClick={() => router.push(`/niagawan/purchase/${r.id}`)} className="rounded bg-gray-900 px-2 py-0.5 text-xs font-semibold text-white hover:bg-gray-700">
                        {r.status === 'extracted' ? 'Review' : 'View'}
                      </button>
                    )}
                    {r.status === 'extracted' && (
                      <button onClick={() => readInvoice(r.id)} disabled={readingId === r.id} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        {readingId === r.id ? 'Reading…' : 'Re-read'}
                      </button>
                    )}
                    {r.file_path && <button onClick={() => viewPdf(r.file_path)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">View PDF</button>}
                    {(r.status === 'uploaded' || r.status === 'extracted' || r.status === 'error') && (
                      <button onClick={() => dismiss(r)} title="Hide this invoice (e.g. it's already in Niagawan). Nothing is changed in Niagawan." className="rounded border border-gray-200 px-2 py-0.5 text-xs text-rose-500 hover:bg-rose-50">
                        ✕ Dismiss
                      </button>
                    )}
                    {r.status === 'dismissed' && (
                      <button onClick={() => restore(r)} className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">
                        ↩ Restore
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
