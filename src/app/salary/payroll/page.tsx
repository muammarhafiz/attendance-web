// src/app/salary/payroll/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Payslip = {
  email: string;
  name: string;
  basic_pay: number;
  additions: number;
  other_deduct: number;
  gross_pay: number;
  epf_emp: number;
  epf_er: number;
  socso_emp: number;
  socso_er: number;
  eis_emp: number;
  eis_er: number;
  hrd_er: number;
  pcb: number;
  net_pay: number;
};

type ApiOk = { ok: true; payslips: Payslip[] };
type ApiErr = { ok: false; error: string };
type ApiRes = ApiOk | ApiErr;

export default function PayrollPage() {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  // Run payroll (fetches from our API)
  async function run() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', { method: 'POST' });
      const j: ApiRes = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error('ok' in j ? 'Unknown error' : j.error || 'Failed');
      }
      setRows(j.payslips);
      setLastRunAt(new Date().toLocaleString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  // Initial auto-run once
  useEffect(() => {
    run();
    // intentionally not adding `run` to deps to avoid ref churn; run is stable in this component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const sum = (k: keyof Payslip) =>
      list.reduce((s, r) => s + Number(r[k] || 0), 0);
    return {
      basic: sum('basic_pay'),
      adds: sum('additions'),
      otherDed: sum('other_deduct'),
      gross: sum('gross_pay'),
      pcb: sum('pcb'),
      epfEmp: sum('epf_emp'),
      socsoEmp: sum('socso_emp'),
      eisEmp: sum('eis_emp'),
      epfEr: sum('epf_er'),
      socsoEr: sum('socso_er'),
      eisEr: sum('eis_er'),
      hrdEr: sum('hrd_er'),
      net: sum('net_pay'),
    };
  }, [rows]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      <button
        onClick={run}
        disabled={loading}
        style={{
          padding: '10px 12px',
          border: '1px solid #111827',
          borderRadius: 8,
          marginBottom: 12,
          width: '100%',
          opacity: loading ? 0.6 : 1,
          cursor: 'pointer',
        }}
      >
        {loading ? 'Running…' : 'Run Payroll'}
      </button>

      {err && (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>Error: {err}</div>
      )}
      {lastRunAt && (
        <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
          Last updated: {lastRunAt}
        </div>
      )}

      {rows && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #d1d5db' }}>
                <th style={thLeft}>Employee</th>
                <th style={th}>Basic</th>
                <th style={th}>Additions</th>
                <th style={th}>Other Deduct</th>
                <th style={th}>Gross</th>
                <th style={th}>PCB</th>
                <th style={th}>EPF (Emp)</th>
                <th style={th}>SOCSO (Emp)</th>
                <th style={th}>EIS (Emp)</th>
                <th style={th}>EPF (Er)</th>
                <th style={th}>SOCSO (Er)</th>
                <th style={th}>EIS (Er)</th>
                <th style={th}>HRD (Er)</th>
                <th style={th}>Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((p) => (
                <tr key={p.email} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdLeft}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                      {p.email}
                    </div>
                  </td>
                  <td style={td}>{fmt(p.basic_pay)}</td>
                  <td style={td}>{fmt(p.additions)}</td>
                  <td style={td}>{fmt(p.other_deduct)}</td>
                  <td style={td}>{fmt(p.gross_pay)}</td>
                  <td style={td}>{fmt(p.pcb)}</td>
                  <td style={td}>{fmt(p.epf_emp)}</td>
                  <td style={td}>{fmt(p.socso_emp)}</td>
                  <td style={td}>{fmt(p.eis_emp)}</td>
                  <td style={td}>{fmt(p.epf_er)}</td>
                  <td style={td}>{fmt(p.socso_er)}</td>
                  <td style={td}>{fmt(p.eis_er)}</td>
                  <td style={td}>{fmt(p.hrd_er)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{fmt(p.net_pay)}</td>
                </tr>
              ))}

              <tr>
                <td style={{ ...tdLeft, fontWeight: 700 }}>TOTAL</td>
                <td style={tdBold}>{fmt(totals.basic)}</td>
                <td style={tdBold}>{fmt(totals.adds)}</td>
                <td style={tdBold}>{fmt(totals.otherDed)}</td>
                <td style={tdBold}>{fmt(totals.gross)}</td>
                <td style={tdBold}>{fmt(totals.pcb)}</td>
                <td style={tdBold}>{fmt(totals.epfEmp)}</td>
                <td style={tdBold}>{fmt(totals.socsoEmp)}</td>
                <td style={tdBold}>{fmt(totals.eisEmp)}</td>
                <td style={tdBold}>{fmt(totals.epfEr)}</td>
                <td style={tdBold}>{fmt(totals.socsoEr)}</td>
                <td style={tdBold}>{fmt(totals.eisEr)}</td>
                <td style={tdBold}>{fmt(totals.hrdEr)}</td>
                <td style={tdBold}>{fmt(totals.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
const thLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: 6,
  whiteSpace: 'nowrap',
  fontWeight: 600,
  fontSize: 14,
  borderBottom: '1px solid #e5e7eb',
};
const th: React.CSSProperties = {
  textAlign: 'right',
  padding: 6,
  whiteSpace: 'nowrap',
  fontWeight: 600,
  fontSize: 14,
  borderBottom: '1px solid #e5e7eb',
};
const tdLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: 6,
  verticalAlign: 'top',
  fontSize: 14,
};
const td: React.CSSProperties = {
  textAlign: 'right',
  padding: 6,
  verticalAlign: 'top',
  fontSize: 14,
};
const tdBold: React.CSSProperties = { ...td, fontWeight: 700 };

/* ---------- helpers ---------- */
function fmt(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}