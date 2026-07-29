'use client';
// Owner-only reconciliation. Upload either a Maybank PDF (checks TRANSFERS) or a DuitNow QR settlement
// CSV (checks QR) — each is matched against what Niagawan recorded, by date + amount only. The file is
// read on an owner-gated server route and DISCARDED — never stored.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { ReconResult } from '@/lib/maybank';

type Result = {
  kind: 'bank' | 'qr';
  verified: boolean;
  summary: string;
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

const LABELS = {
  bank: {
    verified: 'balances reconcile',
    notRecv: 'Not received',
    extra: 'In bank, not in Niagawan',
    sec1: '🔴 Marked paid in Niagawan, but not found in the bank',
    sec1sub: 'Recorded as received, but no matching deposit (date + amount) is in the statement.',
    sec2: '🔵 In the bank, but not recorded in Niagawan',
    sec2sub: 'Money in via transfer with no matching Niagawan receipt — recorded elsewhere, a non-customer deposit, or missed.',
    other: 'bank',
  },
  qr: {
    verified: 'totals reconcile',
    notRecv: 'Not in QR report',
    extra: 'In QR report, not in Niagawan',
    sec1: '🔴 Recorded as QR in Niagawan, but not in the QR report',
    sec1sub: 'Recorded as a QR receipt, but no matching payment (date + amount) is in the QR report.',
    sec2: '🔵 In the QR report, but not recorded in Niagawan',
    sec2sub: 'A QR payment the provider settled with no matching Niagawan receipt — recorded under another method or missed.',
    other: 'report',
  },
} as const;

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
      const kind = file.name.toLowerCase().endsWith('.csv') ? 'qr' : 'bank';
      const base64 = await readBase64(file);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { setErr('Please sign in again.'); setBusy(false); return; }
      const resp = await fetch('/api/bank/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, base64 }),
      });
      const json = await resp.json();
      if (!resp.ok) { setErr(json?.error || `Failed (${resp.status})`); setBusy(false); return; }
      setRes(json as Result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }, []);

  if (owner === null) return <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-ink-3">Checking…</div>;
  if (!owner) return <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-ink-2">This page is for the owner.</div>;

  const recon = res?.recon;
  const L = res ? LABELS[res.kind] : LABELS.bank;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold text-ink">🏦 Bank reconciliation</h1>
      <p className="mt-1 text-sm text-ink-2">Upload your <strong>Maybank statement (PDF)</strong> to check transfers, or your <strong>DuitNow QR report (CSV)</strong> to check QR — each is matched to what Niagawan recorded, by date &amp; amount.</p>

      <div className="mt-4 rounded-card bg-card shadow-card p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <span className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Choose PDF or CSV</span>
          <input type="file" accept="application/pdf,.pdf,text/csv,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
          <span className="text-sm text-ink-2">{fileName || 'No file chosen'}</span>
        </label>
        <p className="mt-2 text-[11px] text-ink-3">🔒 The file is read to reconcile it and then discarded — it is never stored.</p>
      </div>

      {busy && <div className="mt-4 text-sm text-ink-2">Reading file…</div>}
      {err && <div className="mt-4 rounded-lg border border-rose-200 bg-bad-soft p-3 text-sm text-bad">{err}</div>}

      {res && recon && !busy && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {res.verified
              ? <span className="rounded-full bg-good-soft px-2 py-0.5 font-medium text-good">Verified ✓ {L.verified}</span>
              : <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn">⚠ Could not fully verify — read the figures with care</span>}
            <span className="text-ink-3">{res.summary}</span>
          </div>
          {res.synced.days < res.synced.span && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-warn-soft p-3 text-xs text-warn">
              Niagawan is only synced for {res.synced.days} of the {res.synced.span} days in this period — some &ldquo;{L.notRecv.toLowerCase()}&rdquo; rows below may just be un-synced days.
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Received ✓" value={recon.matched.length} tone="ok" />
            <Stat label={L.notRecv} value={recon.niaOnly.length} tone={recon.niaOnly.length ? 'bad' : 'ok'} />
            <Stat label={L.extra} value={recon.bankOnly.length} tone={recon.bankOnly.length ? 'warn' : 'ok'} />
          </div>

          <Section title={L.sec1} subtitle={L.sec1sub}>
            {recon.niaOnly.length === 0
              ? <Empty text="Everything Niagawan recorded was found ✓" />
              : recon.niaOnly.map((r, i) => <Row key={i} left={fmtDay(r.day)} main={r.descp || 'Payment'} amount={r.amount} tone="bad" />)}
          </Section>

          {recon.bankOnly.length > 0 && (
            <Section title={L.sec2} subtitle={L.sec2sub}>
              {recon.bankOnly.map((r, i) => <Row key={i} left={fmtDay(r.date)} main={r.detail || 'Payment in'} amount={r.amount} tone="warn" />)}
            </Section>
          )}

          <div className="mt-4">
            <button onClick={() => setShowMatched((s) => !s)} className="text-xs font-medium text-ink-2 underline hover:text-ink-2">
              {showMatched ? 'Hide' : 'Show'} {recon.matched.length} received ✓
            </button>
            {showMatched && (
              <div className="mt-2 divide-y divide-line rounded-lg border border-line">
                {recon.matched.map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-ink-2">{r.descp || 'Payment'}</div>
                      <div className="mt-0.5 text-[11px] text-ink-3">Niagawan {fmtDay(r.day)} · {L.other} {r.bankDate ? fmtDay(r.bankDate) : '—'}</div>
                    </div>
                    <span className="shrink-0 font-medium text-good">{rm(r.amount)} ✓</span>
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
  const c = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-good';
  return (
    <div className="rounded-card bg-card shadow-card p-3 text-center">
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-2">{label}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-card bg-card shadow-card p-4">
      <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
      <p className="mb-2 mt-0.5 text-[11px] text-ink-3">{subtitle}</p>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function Row({ left, main, amount, tone }: { left: string; main: string; amount: number; tone: 'bad' | 'warn' }) {
  const c = tone === 'bad' ? 'text-bad' : 'text-warn';
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate text-ink-2">{main}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">{left}</div>
      </div>
      <span className={`shrink-0 font-semibold ${c}`}>{rm(amount)}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-1 text-sm text-good">{text}</div>;
}
