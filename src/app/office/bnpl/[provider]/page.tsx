'use client';
// Office → BNPL → one service (e.g. ATOME): the tracker scoped to a single provider (from the URL).
// Sales with the fee taken out + settled/pending status, payouts to tick against the bank, and totals.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { OfficeShell, rm, fmtDay } from '@/components/office/shared';

type Provider = { provider: string; display_name: string; mdr_pct: number; flat_fee: number; sst_pct: number; enabled: boolean };
type Sale = { day: string; method: string; invoice_no: string | null; vehicle: string | null; gross: number | string; est_fee: number | string; est_net: number | string; status: string | null };
type Payout = {
  payout_id: string; payout_date: string | null;
  gross_total: number | string; payout_total: number | string; fee_total: number | string; txn_count: number;
  bank_confirmed: boolean; confirmed_by: string | null; confirmed_at: string | null; note: string | null; status: string | null;
};
type Overview = {
  range: { from: string; to: string };
  providers: Provider[];
  sales: Sale[];
  sales_total: { count: number; gross: number | string; est_fee: number | string; est_net: number | string };
  payouts: Payout[];
  payouts_total: { count: number; payout: number | string; confirmed_count: number; unconfirmed_count: number; unconfirmed_amount: number | string };
  fees_all_time: number | string;
  settled_all_time: number | string;
};

const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const klDaysAgo = (n: number) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const fmtDT = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—';

export default function BnplProviderPage() {
  const params = useParams();
  const provider = String((params?.provider as string) || 'atome').toLowerCase();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(klDaysAgo(90));
  const [to, setTo] = useState(klToday());
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('can_access', { p_feature: 'month_end' });
      setAllowed(data === true);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('bnpl_overview', { p_from: from, p_to: to, p_provider: provider });
    setD((data ?? null) as Overview);
    setLoading(false);
  }, [from, to, provider]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const name = d?.providers?.[0]?.display_name || provider.toUpperCase();

  const onFile = useCallback(async (file: File) => {
    setUploading(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setMsg({ ok: false, text: 'Please sign in again.' }); return; }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('provider', provider);
      const res = await fetch('/api/bnpl/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error || 'Import failed.' }); return; }
      const r = (j.result ?? {}) as { rows?: number; payouts?: number; transactions?: number };
      const n = r.payouts ?? r.rows ?? r.transactions ?? 0;
      setMsg({ ok: true, text: `Imported ${n} record${n === 1 ? '' : 's'}.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [load, provider]);

  const confirmPayout = useCallback(async (p: Payout, confirmed: boolean) => {
    setD((prev) => (prev ? { ...prev, payouts: prev.payouts.map((x) => (x.payout_id === p.payout_id ? { ...x, bank_confirmed: confirmed } : x)) } : prev));
    const { error } = await supabase.rpc('bnpl_confirm_payout', { p_provider: provider, p_payout_id: p.payout_id, p_confirmed: confirmed, p_note: p.note ?? null });
    if (error) load();
  }, [load, provider]);

  if (allowed === null) return <div className="p-6 text-sm text-ink-2">Checking…</div>;
  if (!allowed) return <div className="p-6 text-sm text-ink-2">This page is for the office clerk, managers and the owner.</div>;

  const pt = d?.payouts_total;
  const st = d?.sales_total;

  return (
    <OfficeShell title={name} back backHref="/office/bnpl" backLabel="← BNPL" onRefresh={load}>
      <p className="mb-4 text-sm text-ink-2">
        When a customer pays with {name}, you get the sale now but {name} keeps a fee and pays you the rest a few days later,
        bundled into one bank deposit. Import the settlement file {name} emails you, then tick each payout once you see it in the bank.
      </p>

      {/* Import the settlement report */}
      <div className="mb-4 rounded-card bg-card shadow-card p-4">
        <div className="mb-1 text-sm font-semibold text-ink">Import {name} payout report</div>
        <p className="mb-3 text-[13px] text-ink-2">
          Open the email {name} sent, download the <span className="font-medium">settlement / payout</span> spreadsheet, then drop it here.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? 'Reading…' : 'Choose settlement file'}
          </button>
          {msg && <span className={`text-[13px] font-medium ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.ok ? '✓ ' : '⚠ '}{msg.text}</span>}
        </div>
      </div>

      {/* Date range */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-2">Showing</span>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" />
        <span className="text-ink-3">to</span>
        <input type="date" value={to} max={klToday()} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" />
      </div>

      {loading || !d ? (
        <div className="py-6 text-center text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="space-y-4">
          {/* Totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Paid out (period)" value={rm(pt?.payout)} sub={`${pt?.count ?? 0} payout${pt?.count === 1 ? '' : 's'}`} />
            <Stat label="Awaiting bank check" value={rm(pt?.unconfirmed_amount)} sub={`${pt?.unconfirmed_count ?? 0} to confirm`} tone={(pt?.unconfirmed_count ?? 0) > 0 ? 'warn' : 'good'} />
            <Stat label="Fees (period)" value={rm(st?.est_fee)} sub="estimated on sales" />
            <Stat label="Fees all-time" value={rm(d.fees_all_time)} sub="for the P&L" />
          </div>

          {/* Payouts */}
          <div className="rounded-card bg-card shadow-card p-4">
            <div className="mb-1 text-sm font-semibold text-ink">Payouts — check against the bank</div>
            <p className="mb-3 text-[12px] text-ink-3">Each row is one deposit {name} made. Tick it once you see the matching amount in the bank statement on that date.</p>
            {d.payouts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">
                No payouts imported for this period yet. Import the settlement file above.
              </div>
            ) : (
              <div className="space-y-2">
                {d.payouts.map((p) => (
                  <div key={p.payout_id} className={`rounded-lg border p-3 ${p.bank_confirmed ? 'border-emerald-200 bg-good-soft' : 'border-line'}`}>
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => confirmPayout(p, !p.bank_confirmed)}
                        aria-label={p.bank_confirmed ? 'Un-confirm' : 'Confirm received in bank'}
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-xs font-bold transition ${p.bank_confirmed ? 'border-good bg-good text-white' : 'border-line text-transparent hover:border-good'}`}
                      >✓</button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{fmtDT(p.payout_date)}</span>
                          {p.bank_confirmed
                            ? <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good">confirmed</span>
                            : <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">to check</span>}
                        </div>
                        <div className="mt-0.5 text-[12px] text-ink-3">
                          {p.txn_count} settled{p.status ? ` · ${p.status}` : ''}
                          <span className="ml-1 font-mono">· {p.payout_id}</span>
                        </div>
                        {p.bank_confirmed && p.confirmed_by && (
                          <div className="mt-0.5 text-[11px] text-ink-3">by {p.confirmed_by}{p.confirmed_at ? ` · ${fmtDT(p.confirmed_at)}` : ''}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-base font-semibold text-ink">{rm(p.payout_total)}</div>
                        <div className="text-[11px] text-ink-3">into bank</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sales feed */}
          <div className="rounded-card bg-card shadow-card p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-sm font-semibold text-ink">{name} sales</div>
              {st && <div className="text-[12px] text-ink-3">{st.count} sale{st.count === 1 ? '' : 's'} · {rm(st.gross)} gross</div>}
            </div>
            <p className="mb-3 text-[12px] text-ink-3">Every {name} receipt from the cash book. &ldquo;You get&rdquo; is after the estimated fee. Status comes from the {name} transaction report when you import it.</p>
            {Number(d.settled_all_time) > 0 && (
              <p className="mb-3 text-[12px] text-good">{rm(d.settled_all_time)} fully settled by {name} to date — includes sales paid out before the email records began.</p>
            )}
            {d.sales.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">No {name} sales in this period.</div>
            ) : (
              <div className="divide-y divide-line">
                {d.sales.map((s, i) => (
                  <div key={`${s.invoice_no ?? 'x'}-${i}`} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-ink-2">{s.vehicle || '—'}</span>
                        <SaleStatusPill status={s.status} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
                        <span className="font-mono">{s.invoice_no || '—'}</span>
                        <span>·</span>
                        <span>{fmtDay(s.day)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-ink">{rm(s.est_net)}</div>
                      <div className="text-[11px] text-ink-3">of {rm(s.gross)} · fee {rm(s.est_fee)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {d.providers[0] && (
            <p className="px-1 text-[11px] text-ink-3">
              Fee — {d.providers.map((p) => `${p.display_name}: ${p.mdr_pct}% + RM${p.flat_fee} (+${p.sst_pct}% SST)`).join(' · ')}.
            </p>
          )}
        </div>
      )}
    </OfficeShell>
  );
}

function SaleStatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'FULLY_SETTLED') return <span className="shrink-0 rounded-full bg-good-soft px-1.5 py-0.5 text-[10px] font-medium text-good">settled</span>;
  if (s === 'CONFIRMED') return <span className="shrink-0 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">pending payout</span>;
  return <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">{status.replace(/_/g, ' ').toLowerCase()}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  const vc = tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : 'text-ink';
  return (
    <div className="rounded-card bg-card shadow-card p-4">
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${vc}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}
