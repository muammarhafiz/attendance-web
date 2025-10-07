'use client';

import React, { useMemo, useState } from 'react';

type Payslip = {
  staff_email: string;
  staff_name: string;
  basic: number;
  additions: number;
  other_deduct: number;

  // employee (EE) deductions
  epf_ee: number;
  socso_ee: number;
  eis_ee: number;
  pcb: number;

  // employer (ER) contributions
  epf_er: number;
  socso_er: number;
  eis_er: number;
  hrd_er: number;

  gross: number;
  net: number;
};

type RunResponse = {
  ok: boolean;
  message?: string;
  count?: number;
  payslips?: Payslip[];
  totals?: {
    basic: number;
    additions: number;
    other_deduct: number;
    gross: number;
    pcb: number;
    epf_ee: number;
    socso_ee: number;
    eis_ee: number;
    epf_er: number;
    socso_er: number;
    eis_er: number;
    hrd_er: number;
    net: number;
  };
};

export default function PayrollPage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1); // 1-12
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<RunResponse | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const runPayroll = async () => {
    if (loading) return;
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch('/salary/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ year, month }),
      });

      const json: RunResponse = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.message || 'Payroll run failed');
      }
      setData(json);
      setLastRunAt(new Date().toLocaleString());
    } catch (e: any) {
      setErr(e?.message || 'Error running payroll');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(() => data?.totals, [data]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Salary System</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={selectStyle}
            aria-label="Month"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m.toString().padStart(2, '0')}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={selectStyle}
            aria-label="Year"
          >
            {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button onClick={runPayroll} disabled={loading} style={primaryBtn}>
            {loading ? 'Running…' : 'Run Payroll'}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>
          Error: {err}
        </div>
      )}
      {lastRunAt && (
        <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
          Last updated: {lastRunAt}
        </div>
      )}

      {data?.payslips && data.payslips.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thLeft}>Employee</th>
                <th style={th}>Basic</th>
                <th style={th}>Additions</th>
                <th style={th}>Other Deduct</th>
                <th style={th}>Gross</th>
                <th style={th}>PCB</th>
                <th style={th}>EPF (Emp)</th>
                <th style={th}>SOCSO (Emp)</th>
                <th style={th}>EIS (Emp)</th>
                <th style={thSep}>EPF (Er)</th>
                <th style={th}>SOCSO (Er)</th>
                <th style={th}>EIS (Er)</th>
                <th style={th}>HRD (Er)</th>
                <th style={thStrong}>Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {data.payslips.map((p) => (
                <tr key={p.staff_email} style={rowStyle}>
                  <td style={tdLeft}>
                    <div style={{ fontWeight: 600 }}>{p.staff_name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{p.staff_email}</div>
                  </td>
                  <td style={td}>{fmt(p.basic)}</td>
                  <td style={td}>{fmt(p.additions)}</td>
                  <td style={td}>{fmt(p.other_deduct)}</td>
                  <td style={td}>{fmt(p.gross)}</td>
                  <td style={td}>{fmt(p.pcb)}</td>
                  <td style={td}>{fmt(p.epf_ee)}</td>
                  <td style={td}>{fmt(p.socso_ee)}</td>
                  <td style={td}>{fmt(p.eis_ee)}</td>
                  <td style={tdSep}>{fmt(p.epf_er)}</td>
                  <td style={td}>{fmt(p.socso_er)}</td>
                  <td style={td}>{fmt(p.eis_er)}</td>
                  <td style={td}>{fmt(p.hrd_er)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(p.net)}</td>
                </tr>
              ))}

              {totals && (
                <tr>
                  <td style={{ ...tdLeft, fontWeight: 700 }}>TOTAL</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.basic)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.additions)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.other_deduct)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.gross)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.pcb)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.epf_ee)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.socso_ee)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.eis_ee)}</td>
                  <td style={{ ...tdSep, fontWeight: 700 }}>{fmt(totals.epf_er)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.socso_er)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.eis_er)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.hrd_er)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(totals.net)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
            Tip: select month &amp; year, then press “Run Payroll”.
          </p>
        </div>
      )}

      {!loading && !data?.payslips?.length && (
        <div style={{ color: '#6b7280' }}>No data yet — run payroll to see results.</div>
      )}
    </div>
  );
}

/* ---------- styles (kept small, similar to your other pages) ---------- */
const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  outline: 'none',
  fontSize: 14,
};

const primaryBtn: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14, // match adjustment box look
};

const thLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 8px',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
  fontWeight: 600,
};

const th: React.CSSProperties = {
  textAlign: 'right',
  padding: '10px 8px',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
  fontWeight: 600,
};

const thSep: React.CSSProperties = {
  ...th,
  borderLeft: '2px solid #e5e7eb', // subtle divider between EE and ER
};

const thStrong: React.CSSProperties = {
  ...th,
  fontWeight: 800,
};

const rowStyle: React.CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
};

const tdLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px',
  verticalAlign: 'top',
};

const td: React.CSSProperties = {
  textAlign: 'right',
  padding: '8px',
  verticalAlign: 'top',
};

const tdSep: React.CSSProperties = {
  ...td,
  borderLeft: '2px solid #f3f4f6',
};

/* ---------- helpers ---------- */
function fmt(n: number | undefined | null) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}