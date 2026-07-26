'use client';
// Owner-only bank reconciliation: upload a Maybank PDF statement; for every transfer Niagawan recorded
// as paid, confirm the money reached the bank (matched by date + amount only). The PDF is sent to an
// owner-gated server route, read there, reconciled, and DISCARDED — it is never stored.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { ReconResult } from '@/lib/maybank';

type Result = {
  valid: { chainOk: boolean; endMatch: boolean; crMatch: boolean; drMatch: boolean; ok: boolean };
  txnCount: number;
  transfersIn: number;
  recon: ReconResult;
  synced: { days: number; span: number };
};

const rm = (x: unknown) => 'RM ' + Number(x || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string) => { const [y, m, d] = String(iso).split('-'); return d && m && y ? `${Number(d)}/${Number(m)}/${y.slice(2)}` : iso; };

function readBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export default function BankReconPage() {
  const [owner, setOwner] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [showMatched, setShowMatched] = useState(false);

  useEffect(() => { (async () => { const { data } = await supabase.rpc('my_access'); setOwner(!!(data as Record<string, boolean>)?.owner); })(); }, []);

  const onFile = useCallback(async (file: File) => {
    setErr(null); setRes(null); setFileName(file.name); setBusy(true);
    try {
      const base64 = await readBase64(file);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { setErr('Please sign in again.'); setBusy(false); return; }
      const resp = await fetch('/api/bank/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ base64 }),
      });
      const json = await resp.json();
      if (!resp.ok) { setErr(json?.error || `Failed (${resp.status})`); setBusy(false); return; }
      setRes(json as Result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }, []);

  if (owner === null) return <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-gray-400">Checking…</div>;
  if (!owner) return <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-gray-600">This page is for the owner.</div>;

  const recon = res?.recon;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900">🏦 Bank reconciliation</h1>
      <p className="mt-1 text-sm text-gray-500">Upload your Maybank statement — it checks every transfer Niagawan marked as paid against what actually reached the bank, by date &amp; amount.</p>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <span className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Choose statement PDF</span>
          <input type="file" accept="application/pdf,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
          <span className="text-sm text-gray-500">{fileName || 'No file chosen'}</span>
        </label>
        <p className="mt-2 text-[11px] text-gray-400">🔒 The statement is read to reconcile it and then discarded — it is never stored.</p>
      </div>

      {busy && <div className="mt-4 text-sm text-gray-500">Reading statement…</div>}
      {err && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div>}

      {res && recon && !busy && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {res.valid.ok
              ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">Statement verified ✓ balances reconcile</span>
              : <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">⚠ Could not fully verify the statement — read the figures with care</span>}
            <span className="text-gray-400">{res.txnCount} transactions · {res.transfersIn} transfers in</span>
          </div>
          {res.synced.days < res.synced.span && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Niagawan is only synced for {res.synced.days} of the {res.synced.span} days in this statement — some &ldquo;not received&rdquo; rows below may just be un-synced days. Re-sync that period in the Niagawan tab for a complete check.
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Received ✓" value={recon.matched.length} tone="ok" />
            <Stat label="Not received" value={recon.niaOnly.length} tone={recon.niaOnly.length ? 'bad' : 'ok'} />
            <Stat label="In bank, not in Niagawan" value={recon.bankOnly.length} tone={recon.bankOnly.length ? 'warn' : 'ok'} />
          </div>

          <Section title="🔴 Marked paid in Niagawan, but not found in the bank" subtitle="These transfers were recorded as received but no matching deposit (date + amount) is in the statement.">
            {recon.niaOnly.length === 0
              ? <Empty text="Every transfer Niagawan recorded was found in the bank ✓" />
              : recon.niaOnly.map((r, i) => <Row key={i} left={fmtDay(r.day)} main={r.descp || 'Transfer'} amount={r.amount} tone="bad" />)}
          </Section>

          {recon.bankOnly.length > 0 && (
            <Section title="🔵 In the bank, but not recorded in Niagawan" subtitle="Money that came in via transfer with no matching Niagawan receipt — recorded elsewhere, a non-customer deposit, or missed.">
              {recon.bankOnly.map((r, i) => <Row key={i} left={fmtDay(r.date)} main={r.detail || 'Transfer in'} amount={r.amount} tone="warn" />)}
            </Section>
          )}

          <div className="mt-4">
            <button onClick={() => setShowMatched((s) => !s)} className="text-xs font-medium text-gray-500 underline hover:text-gray-700">
              {showMatched ? 'Hide' : 'Show'} {recon.matched.length} received ✓
            </button>
            {showMatched && (
              <div className="mt-2 divide-y divide-gray-50 rounded-lg border border-gray-100">
                {recon.matched.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-gray-700">{r.descp || 'Transfer'}</div>
                      <div className="mt-0.5 text-[11px] text-gray-400">Niagawan {fmtDay(r.day)} · bank {r.bankDate ? fmtDay(r.bankDate) : '—'}</div>
                    </div>
                    <span className="shrink-0 font-medium text-emerald-700">{rm(r.amount)} ✓</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'bad' | 'warn' }) {
  const c = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-emerald-600';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <p className="mb-2 mt-0.5 text-[11px] text-gray-400">{subtitle}</p>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  );
}

function Row({ left, main, amount, tone }: { left: string; main: string; amount: number; tone: 'bad' | 'warn' }) {
  const c = tone === 'bad' ? 'text-rose-600' : 'text-amber-600';
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate text-gray-700">{main}</div>
        <div className="mt-0.5 text-[11px] text-gray-400">{left}</div>
      </div>
      <span className={`shrink-0 font-semibold ${c}`}>{rm(amount)}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-1 text-sm text-emerald-700">{text}</div>;
}
