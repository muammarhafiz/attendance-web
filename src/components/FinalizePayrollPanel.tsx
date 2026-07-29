'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Props = {
  year: number;
  month: number;
  onAfterFinalize?: () => Promise<void> | void; // (optional) refresh parent data
};

type GenResult = {
  summaryUrl: string;
  payslips: { email: string; url: string }[];
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export default function FinalizePayrollPanel({ year, month, onAfterFinalize }: Props) {
  const basePath = useMemo(() => `${year}-${pad2(month)}`, [year, month]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // links discovered from storage
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null);
  const [payslipUrls, setPayslipUrls] = useState<{ name: string; url: string }[]>([]);

  async function loadPdfLinks() {
    setError(null);
    setMsg('Loading generated PDFs…');
    try {
      // 1) summary at "<basePath>/Payroll_Summary_<basePath>.pdf"
      const summaryName = `Payroll_Summary_${basePath}.pdf`;
      const { data: sHead, error: sErr } = await supabase.storage
        .from('payroll')
        .list(basePath, { limit: 1, search: summaryName });
      if (sErr) throw sErr;
      if (sHead && sHead.some(x => x.name === summaryName)) {
        const { data: pub } = supabase.storage.from('payroll').getPublicUrl(`${basePath}/${summaryName}`);
        setSummaryUrl(pub.publicUrl);
      } else {
        setSummaryUrl(null);
      }

      // 2) payslips under "<basePath>/payslips/"
      const { data: list, error: listErr } = await supabase.storage
        .from('payroll')
        .list(`${basePath}/payslips`, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
      if (listErr) throw listErr;

      const files = (list ?? []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      const withUrls = files.map(f => {
        const { data: pub } = supabase.storage.from('payroll').getPublicUrl(`${basePath}/payslips/${f.name}`);
        return { name: f.name, url: pub.publicUrl };
      });
      setPayslipUrls(withUrls);
      setMsg(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
      setMsg(null);
    }
  }

  useEffect(() => {
    // auto-load whenever the month changes (so the panel shows what already exists)
    loadPdfLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  async function finalizeNow() {
    setBusy(true);
    setError(null);
    setMsg('Generating PDFs and finalizing…');
    try {
      const qs = new URLSearchParams({ year: String(year), month: String(month) }).toString();
      const res = await fetch(`/api/payroll/finalize?${qs}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to finalize');

      // json has: { summaryUrl, payslips: [{email,url}, ...] }
      const out = json as GenResult;
      setSummaryUrl(out.summaryUrl);
      setPayslipUrls(
        (out.payslips || []).map(p => {
          // filename is already safeName in route
          const name = decodeURIComponent(p.url.split('/').pop() || p.email);
          return { name, url: p.url };
        })
      );
      setMsg('Done. Period is now LOCKED.');
      if (onAfterFinalize) await onAfterFinalize();
    } catch (e: any) {
      setError(e.message ?? String(e));
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-card bg-card shadow-card p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Finalize & PDFs</h2>
        <span className="text-sm text-ink-2">Period {basePath}</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={loadPdfLinks}
            disabled={busy}
            className="rounded border border-line px-3 py-1.5 hover:bg-ink/5 disabled:opacity-50"
            title="Refresh the list of generated PDFs from storage"
          >
            Refresh list
          </button>
          <button
            onClick={finalizeNow}
            disabled={busy}
            className="rounded bg-btn px-3 py-1.5 text-btn-ink hover:opacity-90 disabled:opacity-50"
            title="Generate Summary + Payslips (and LOCK the period)"
          >
            {busy ? 'Working…' : 'Finalize & Generate PDFs'}
          </button>
        </div>
      </div>

      {msg && <div className="mb-3 rounded border border-sky-200 bg-sky-50 p-2 text-sm text-sky-800">{msg}</div>}
      {error && <div className="mb-3 rounded border border-rose-200 bg-bad-soft p-2 text-sm text-bad">{error}</div>}

      <div className="grid gap-3">
        <div>
          <div className="font-medium">Summary</div>
          {summaryUrl ? (
            <a href={summaryUrl} target="_blank" rel="noreferrer" className="text-accent underline">
              Download Payroll Summary ({basePath})
            </a>
          ) : (
            <div className="text-sm text-ink-2">No summary for this month yet.</div>
          )}
        </div>

        <div>
          <div className="font-medium">Payslips</div>
          {payslipUrls.length === 0 ? (
            <div className="text-sm text-ink-2">No payslips found for this month.</div>
          ) : (
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-ink/5 text-left">
                    <th className="border-b px-2 py-1">File</th>
                    <th className="border-b px-2 py-1">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {payslipUrls.map((f) => (
                    <tr key={f.url}>
                      <td className="border-b px-2 py-1">{f.name}</td>
                      <td className="border-b px-2 py-1">
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-accent underline">
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}