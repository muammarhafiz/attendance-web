// src/app/salary/payroll/page.tsx
'use client';

import React from 'react';

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

type RunOk = { ok: true; payslips: Payslip[]; totals?: { count: number } };
type RunErr = { ok: false; where?: string; error: string };
type RunApiRes = RunOk | RunErr;

export default function PayrollPage() {
  const [rows, setRows] = React.useState<Payslip[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      let j: RunApiRes;
      try {
        j = (await r.json()) as RunApiRes;
      } catch {
        j = { ok: false, error: 'Invalid JSON from server' };
      }

      // Proper union narrowing — do NOT touch j.error unless it's the error variant
      if (!r.ok || !j.ok) {
        const msg = !r.ok
          ? `HTTP ${r.status}`
          : ` ${(j as RunErr).where ? (j as RunErr).where + ': ' : ''}${
              (j as RunErr).error
            }`.trim();
        throw new Error(msg || 'Failed');
      }

      setRows(j.payslips);
      setLastRunAt(new Date().toLocaleString());
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'Failed';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // initial load
    void run();
  }, [run]);

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 12 }}>Payroll</h1>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={run} disabled={loading} style={{ padding: '8px 12px' }}>
          {loading ? 'Calculating…' : 'Recalculate'}
        </button>
        {lastRunAt && (
          <span style={{ opacity: 0.8 }}>Last calculated: {lastRunAt}</span>
        )}
      </div>

      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            border: '1px solid #f99',
            background: '#ffecec',
            color: '#a00',
          }}
        >
          {err}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
          }}
        >
          <thead>
            <tr>
              {[
                'Name',
                'Email',
                'Basic',
                'Additions',
                'Other Deduct',
                'Gross',
                'EPF (Emp)',
                'EPF (Er)',
                'SOCSO (Emp)',
                'SOCSO (Er)',
                'EIS (Emp)',
                'EIS (Er)',
                'HRD (Er)',
                'PCB',
                'Net Pay',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    borderBottom: '1px solid #ddd',
                    padding: '8px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={15} style={{ padding: 12, opacity: 0.8 }}>
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.email}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.email}</td>
                  <td style={tdNum}>{fmt(r.basic_pay)}</td>
                  <td style={tdNum}>{fmt(r.additions)}</td>
                  <td style={tdNum}>{fmt(r.other_deduct)}</td>
                  <td style={tdNum}>{fmt(r.gross_pay)}</td>
                  <td style={tdNum}>{fmt(r.epf_emp)}</td>
                  <td style={tdNum}>{fmt(r.epf_er)}</td>
                  <td style={tdNum}>{fmt(r.socso_emp)}</td>
                  <td style={tdNum}>{fmt(r.socso_er)}</td>
                  <td style={tdNum}>{fmt(r.eis_emp)}</td>
                  <td style={tdNum}>{fmt(r.eis_er)}</td>
                  <td style={tdNum}>{fmt(r.hrd_er)}</td>
                  <td style={tdNum}>{fmt(r.pcb)}</td>
                  <td style={tdNumBold}>{fmt(r.net_pay)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const td: React.CSSProperties = { padding: '8px 6px', borderBottom: '1px solid #f2f2f2' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
const tdNumBold: React.CSSProperties = { ...tdNum, fontWeight: 600 };

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}