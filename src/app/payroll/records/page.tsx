'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* -------------------------------- Types -------------------------------- */

type Row = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: string | number; // display gross (all EARN)
  base_wage: string | number;  // BASE-only (statutory wage)
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  epf_er: string | number;
  socso_er: string | number;
  eis_er: string | number;
  manual_deduct: string | number;
  net_pay: string | number;
};

type PayslipFile = { name: string; url: string };

/* ------------------------------- Helpers ------------------------------- */

function n(x: string | number | null | undefined) {
  const v = typeof x === 'string' ? Number(x) : x ?? 0;
  return Number.isFinite(v as number) ? (v as number) : 0;
}
function rm(x: number) {
  return `RM ${x.toFixed(2)}`;
}
function pad2(m: number) {
  return String(m).padStart(2, '0');
}

/* -------------------------------- Page -------------------------------- */

export default function PayrollRecordsPage() {
  const now = useMemo(() => new Date(), []);
  const [authed, setAuthed] = useState<boolean | null>(null);

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const yyyymm = `${year}-${pad2(month)}`;
  const basePath = `${year}-${pad2(month)}`;

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // finalize/PDFs box
  const [busy, setBusy] = useState(false);
  const [finMsg, setFinMsg] = useState<string | null>(null);
  const [finErr, setFinErr] = useState<string | null>(null);
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null);
  const [payslips, setPayslips] = useState<PayslipFile[]>([]);

  // auth
  useEffect(() => {
    let unsub: { data: { subscription: { unsubscribe: () => void } } } | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      const ret = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
      unsub = ret;
    })();
    return () => unsub?.data.subscription.unsubscribe();
  }, []);

  /* ------------------------------ Data loads ---------------------------- */

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const { data, error } = await supabase
      .schema('pay_v2')
      .from('v_payslip_admin_summary')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .order('staff_name', { ascending: true });

    if (error) {
      setRows([]);
      setMsg(`Failed to load: ${error.message}`);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, [year, month]);

  // list PDFs already generated for this month
  const loadPdfLinks = useCallback(async () => {
    setFinErr(null);
    setFinMsg('Loading generated PDFs…');
    try {
      // Summary name is deterministic
      const summaryName = `Payroll_Summary_${basePath}.pdf`;
      const { data: lsSummary, error: lsSErr } = await supabase.storage
        .from('payroll')
        .list(basePath, { limit: 100, search: 'Payroll_Summary_' });
      if (lsSErr) throw lsSErr;
      const hasSummary = (lsSummary ?? []).some(f => f.name === summaryName);
      if (hasSummary) {
        const { data: pub } = supabase.storage.from('payroll').getPublicUrl(`${basePath}/${summaryName}`);
        setSummaryUrl(pub.publicUrl);
      } else {
        setSummaryUrl(null);
      }

      // Payslips folder
      const { data: ls, error: lsErr } = await supabase.storage
        .from('payroll')
        .list(`${basePath}/payslips`, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
      if (lsErr) throw lsErr;

      const files = (ls ?? []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      const withUrls: PayslipFile[] = files.map(f => {
        const { data: pub } = supabase.storage.from('payroll').getPublicUrl(`${basePath}/payslips/${f.name}`);
        return { name: f.name, url: pub.publicUrl };
      });
      setPayslips(withUrls);
      setFinMsg(null);
    } catch (e: any) {
      setFinErr(e.message ?? String(e));
      setFinMsg(null);
      setPayslips([]);
      setSummaryUrl(null);
    }
  }, [basePath]);

  useEffect(() => {
    if (authed) {
      loadSummary();
      loadPdfLinks();
    }
  }, [authed, loadSummary, loadPdfLinks]);

  /* ------------------------------ Finalize ------------------------------ */

  async function finalizeAndGenerate() {
    setBusy(true);
    setFinErr(null);
    setFinMsg('Generating PDFs & finalizing…');
    try {
      const qs = new URLSearchParams({ year: String(year), month: String(month) }).toString();
      const res = await fetch(`/api/payroll/finalize?${qs}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to finalize');

      // update links using API response for speed
      setSummaryUrl(json.summaryUrl || null);
      setPayslips(
        (json.payslips ?? []).map((p: { email: string; url: string }) => {
          const name = decodeURIComponent(p.url.split('/').pop() || p.email);
          return { name, url: p.url };
        })
      );
      setFinMsg('Done. Period is now LOCKED.');
      // refresh table to reflect LOCK status effects (if you add any UI lock later)
      await loadSummary();
    } catch (e: any) {
      setFinErr(e.message ?? String(e));
      setFinMsg(null);
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------- Totals ------------------------------ */

  const totals = useMemo(() => {
    const sum = (k: keyof Row) => rows.reduce((a, r) => a + n(r[k]), 0);
    const gross = sum('total_earn');
    const baseWage = sum('base_wage');
    const epfEmp = sum('epf_emp');
    const socsoEmp = sum('socso_emp');
    const eisEmp = sum('eis_emp');
    const epfEr = sum('epf_er');
    const socsoEr = sum('socso_er');
    const eisEr = sum('eis_er');
    const manual = sum('manual_deduct');
    const net = sum('net_pay');
    const employerCost = gross + epfEr + socsoEr + eisEr;
    return { gross, baseWage, epfEmp, socsoEmp, eisEmp, epfEr, socsoEr, eisEr, manual, net, employerCost };
  }, [rows]);

  /* ------------------------------- Rendering ---------------------------- */

  if (authed === false) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll Records</h1>
        <p className="text-sm text-gray-600">Please sign in to view records.</p>
      </main>
    );
  }
  if (authed === null) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="text-sm text-gray-600">Checking session…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payroll Records</h1>
          <p className="text-sm text-gray-500">Period {yyyymm}</p>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Month</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              min={1}
              max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>
          <button
            onClick={() => { loadSummary(); loadPdfLinks(); }}
            disabled={loading || busy}
            className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Finalize & PDFs panel */}
      <section className="mb-6 rounded border bg-white p-4">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-lg font-semibold">Finalize & PDFs</h2>
          <span className="text-sm text-gray-500">Period {basePath}</span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={loadPdfLinks}
              disabled={busy}
              className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              Refresh list
            </button>
            <button
              onClick={finalizeAndGenerate}
              disabled={busy}
              className="rounded bg-black px-3 py-1.5 text-white hover:bg-gray-800 disabled:opacity-50"
              title="Generate Summary + Payslips (and LOCK the period)"
            >
              {busy ? 'Working…' : 'Finalize & Generate PDFs'}
            </button>
          </div>
        </div>

        {finMsg && <div className="mb-3 rounded border border-sky-200 bg-sky-50 p-2 text-sm text-sky-800">{finMsg}</div>}
        {finErr && <div className="mb-3 rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{finErr}</div>}

        <div className="grid gap-3">
          <div>
            <div className="font-medium">Summary</div>
            {summaryUrl ? (
              <a href={summaryUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                Download Payroll Summary ({basePath})
              </a>
            ) : (
              <div className="text-sm text-gray-500">No summary for this month yet.</div>
            )}
          </div>

          <div>
            <div className="font-medium">Payslips</div>
            {payslips.length === 0 ? (
              <div className="text-sm text-gray-500">No payslips found for this month.</div>
            ) : (
              <div className="max-h-72 overflow-auto rounded border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="border-b px-2 py-1">File</th>
                      <th className="border-b px-2 py-1">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map((f) => (
                      <tr key={f.url}>
                        <td className="border-b px-2 py-1">{f.name}</td>
                        <td className="border-b px-2 py-1">
                          <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
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

      {msg && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {msg}
        </div>
      )}

      {/* Records table */}
      <section>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b px-3 py-2 bg-white text-left">Employee</th>
                  <th className="border-b px-3 py-2 text-right bg-white">Gross (All EARN)</th>
                  <th className="border-b px-3 py-2 text-right bg-white">Base (Statutory)</th>

                  <th className="border-b px-3 py-2 text-center bg-rose-50 text-rose-700 font-semibold" colSpan={4}>
                    Employee Deductions
                  </th>

                  <th className="border-b px-3 py-2 text-right bg-white">Net Pay</th>

                  <th className="border-b px-3 py-2 text-center bg-emerald-50 text-emerald-700 font-semibold" colSpan={3}>
                    Employer Contributions
                  </th>

                  <th className="border-b px-3 py-2 text-right bg-white">Employer Cost</th>
                </tr>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Employee</th>
                  <th className="border-b px-3 py-2 text-right">Gross</th>
                  <th className="border-b px-3 py-2 text-right">Base</th>

                  <th className="border-b px-3 py-2 text-right bg-rose-50">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">Manual Deduct</th>

                  <th className="border-b px-3 py-2 text-right">Net</th>

                  <th className="border-b px-3 py-2 text-right bg-emerald-50">EPF (Er)</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">SOCSO (Er)</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">EIS (Er)</th>

                  <th className="border-b px-3 py-2 text-right">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const gross = n(r.total_earn);
                  const base = n(r.base_wage);
                  const epfEmp = n(r.epf_emp);
                  const socsoEmp = n(r.socso_emp);
                  const eisEmp = n(r.eis_emp);
                  const manual = n(r.manual_deduct);
                  const net = n(r.net_pay);
                  const epfEr = n(r.epf_er);
                  const socsoEr = n(r.socso_er);
                  const eisEr = n(r.eis_er);
                  const employerCost = gross + epfEr + socsoEr + eisEr;

                  return (
                    <tr key={r.staff_email}>
                      <td className="border-b px-3 py-2">{r.staff_name ?? r.staff_email}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(gross)}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(base)}</td>

                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(epfEmp)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(socsoEmp)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(eisEmp)}</td>
                      <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(manual)}</td>

                      <td className="border-b px-3 py-2 text-right font-medium">{rm(net)}</td>

                      <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(epfEr)}</td>
                      <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(socsoEr)}</td>
                      <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(eisEr)}</td>

                      <td className="border-b px-3 py-2 text-right">{rm(employerCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="border-t px-3 py-2 text-right">Totals:</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.gross)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.baseWage)}</td>

                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.epfEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.socsoEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.eisEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.manual)}</td>

                  <td className="border-t px-3 py-2 text-right">{rm(totals.net)}</td>

                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.epfEr)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.socsoEr)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.eisEr)}</td>

                  <td className="border-t px-3 py-2 text-right">{rm(totals.employerCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}