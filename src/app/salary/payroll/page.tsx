// src/app/salary/payroll/page.tsx
'use client';

import React, { useEffect, useState } from 'react';

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

export default function PayrollPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Payslip[]>([]);

  async function run() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Run failed');
      setRows(j.payslips || []);
    } catch (e: any) {
      setErr(e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
  }, []);

  const total = (k: keyof Payslip) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={run}
          disabled={loading}
          style={{ padding: '8px 10px', border: '1px solid #111', borderRadius: 8 }}
        >
          {loading ? 'Running…' : 'Run Payroll'}
        </button>
        {err && <span style={{ color: '#b91c1c' }}>Error: {err}</span>}
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.4 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <th style={thLeft}>Employee</th>
              <th style={th}>Basic</th>
              <th style={th}>Additions</th>
              <th style={th}>Other Deduct</th>
              <th style={th}>Gross</th>
              <th style={th}>PCB</th>

              {/* Employee contributions */}
              <th style={th}>EPF (Emp)</th>
              <th style={th}>SOCSO (Emp)</th>
              <th style={th}>EIS (Emp)</th>

              {/* Employer contributions */}
              <th style={th}>EPF (Er)</th>
              <th style={th}>SOCSO (Er)</th>
              <th style={th}>EIS (Er)</th>
              <th style={th}>HRD (Er)</th>

              <th style={th}>Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.email} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={tdLeft}>
                  <div style={{ fontWeight: 600 }}>{p.name || '(No name)'}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{p.email}</div>
                </td>
                <td style={td}>{p.basic_pay.toFixed(2)}</td>
                <td style={td}>{p.additions.toFixed(2)}</td>
                <td style={td}>{p.other_deduct.toFixed(2)}</td>
                <td style={td}>{p.gross_pay.toFixed(2)}</td>
                <td style={td}>{p.pcb.toFixed(2)}</td>

                <td style={td}>{p.epf_emp.toFixed(2)}</td>
                <td style={td}>{p.socso_emp.toFixed(2)}</td>
                <td style={td}>{p.eis_emp.toFixed(2)}</td>

                <td style={td}>{p.epf_er.toFixed(2)}</td>
                <td style={td}>{p.socso_er.toFixed(2)}</td>
                <td style={td}>{p.eis_er.toFixed(2)}</td>
                <td style={td}>{p.hrd_er.toFixed(2)}</td>

                <td style={{ ...td, fontWeight: 700 }}>{p.net_pay.toFixed(2)}</td>
              </tr>
            ))}

            {rows.length > 0 && (
              <tr>
                <td style={{ ...tdLeft, fontWeight: 700 }}>TOTAL</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('basic_pay').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('additions').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('other_deduct').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('gross_pay').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('pcb').toFixed(2)}</td>

                <td style={{ ...td, fontWeight: 700 }}>{total('epf_emp').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('socso_emp').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('eis_emp').toFixed(2)}</td>

                <td style={{ ...td, fontWeight: 700 }}>{total('epf_er').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('socso_er').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('eis_er').toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{total('hrd_er').toFixed(2)}</td>

                <td style={{ ...td, fontWeight: 700 }}>{total('net_pay').toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 8px',
  whiteSpace: 'nowrap',
  fontWeight: 600,
};

const th: React.CSSProperties = {
  textAlign: 'right',
  padding: '10px 8px',
  whiteSpace: 'nowrap',
  fontWeight: 600,
};

const tdLeft: React.CSSProperties = {
  textAlign: 'left',
  padding: 8,
  verticalAlign: 'top',
};

const td: React.CSSProperties = {
  textAlign: 'right',
  padding: 8,
  verticalAlign: 'top',
};