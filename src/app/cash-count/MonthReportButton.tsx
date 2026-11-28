'use client';
// Month-end Cash Book report → PDF → native Share sheet (WhatsApp), with a download fallback.
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const klMonth = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);

export default function MonthReportButton() {
  const [month, setMonth] = useState(klMonth());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setErr('Please sign in again.');
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/cash-report?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = 'Could not generate the report.';
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        setErr(msg);
        setBusy(false);
        return;
      }
      const blob = await res.blob();
      const fname = `cash-report-${month}.pdf`;
      const file = new File([blob], fname, { type: 'application/pdf' });

      type Sharer = {
        canShare?: (d: { files?: File[] }) => boolean;
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      const nav = navigator as unknown as Sharer;
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: 'Cash report', text: `Cash reconciliation — ${month}` });
        } catch {
          /* user dismissed the share sheet — not an error */
        }
      } else {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 4000);
        setNote('PDF downloaded — share it from your Files / WhatsApp.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-sm font-semibold text-ink">Month-end report</h2>
      <p className="mt-1 text-xs text-ink-2">
        A PDF of each day&rsquo;s bill count beside the Niagawan cash book — to check before banking. Share it straight to WhatsApp.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="month"
          value={month}
          max={klMonth()}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink"
        />
        <button
          onClick={run}
          disabled={busy}
          className="flex-1 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Preparing…' : '📄 Report & share'}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      {note && <p className="mt-2 text-xs text-ink-2">{note}</p>}
    </div>
  );
}
