// src/app/salary/payroll/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

/* ---------- Types ---------- */
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
type RunErr = { ok: false; error: string; where?: string; code?: string; details?: string };
type RunRes = RunOk | RunErr;

type ManualOk = { ok: true };
type ManualErr = { ok: false; error: string; where?: string; code?: string; details?: string };
type ManualRes = ManualOk | ManualErr;

/* ---------- Component ---------- */
export default function PayrollPage() {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  // Adjustment form
  const [adjEmail, setAdjEmail] = useState('');
  const [adjKind, setAdjKind] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjLabel, setAdjLabel] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjMsg, setAdjMsg] = useState<string | null>(null);

  async function run() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', {
        method: 'POST',
        credentials: 'include', // IMPORTANT for RLS-authenticated calls
      });
      const j: RunRes = await r.json();
      if (!r.ok) {
        throw new Error((j as RunErr)?.error || `HTTP ${r.status}`);
      }
      if (!j.ok) {
        const e = j as RunErr;
        throw new Error(e.error || 'Failed');
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

  const onAddAdjustment = async () => {
    setAdjMsg(null);
    setErr(null);
    if (!adjEmail || !adjEmail.includes('@')) {
      setAdjMsg('Enter a valid email (staff_email).');
      return;
    }
    if (!adjAmount.trim()) {
      setAdjMsg('Enter an amount.');
      return;
    }

    setAdjBusy(true);
    try {
      const r = await fetch('/salary/api/manual', {
        method: 'POST',
        credentials: 'include', // IMPORTANT for admin-only insert
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff_email: adjEmail,
          kind: adjKind,
          amount: adjAmount,
          label: adjLabel || null,
        }),
      });
      const j: ManualRes = await r.json();
      if (!r.ok) {
        const msg = (j as ManualErr)?.error || `HTTP ${r.status}`;
        throw new Error(msg);
      }
      if (!j.ok) {
        const e = j as ManualErr;
        throw new Error(e.error || 'Insert failed');
      }

      // success: clear inputs, re-run payroll
      setAdjLabel('');
      setAdjAmount('');
      setAdjMsg('Saved ✔ — refreshing payroll…');
      await run();
      setAdjMsg('Saved ✔');
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Error';
      setAdjMsg(`Error: ${m}`);
    } finally {
      setAdjBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      {/* ---------- Adjustment box ---------- */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Adjustment (EARN/DEDUCT)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 140px 1fr 120px', gap: 8 }}>
          <input
            placeholder="staff email"
            value={adjEmail}
            onChange={(e) => setAdjEmail(e.target.value)}
            style={input}
            list="staff-emails"
          />
          <select
            value={adjKind}
            onChange={(e) => setAdjKind(e.target.value as 'EARN' | 'DEDUCT')}
            style={select}
          >
            <option value="EARN">EARN</option>
            <option value="DEDUCT">DEDUCT</option>
          </select>
          <input
            placeholder="amount"
            value={adjAmount}
            onChange={(e) => setAdjAmount(e.target.value)}
            style={input}
            inputMode="decimal"
          />
          <input
            placeholder="label (optional)"
            value={adjLabel}
            onChange={(e) => setAdjLabel(e.target.value)}
            style={input}
          />
          <button
            onClick={onAddAdjustment}
            disabled={adjBusy}
            style={{
              ...button,
              opacity: adjBusy ? 0.6 : 1,
              cursor: adjBusy ? 'default' : 'pointer',
            }}
          >
            {adjBusy ? 'Saving…' : 'Add'}
          </button>
        </div>
        {!!rows?.length && (
          <datalist id="staff-emails">
            {rows.map((r) => (
              <option key={r.email} value={r.email}>
                {r.name}
              </option>
            ))}
          </datalist>
        )}
        {adjMsg && (
          <div style={{ marginTop: 8, color: adjMsg.startsWith('Error') ? '#b91c1c' : '#065f46' }}>
            {adjMsg}
          </div>
        )}
      </div>

      {/* ---------- Run Payroll button ---------- */}
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

      {/* ---------- Table ---------- */}
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
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
};
const select: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: 'white',
};
const button: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #111827',
  borderRadius: 6,
  background: 'white',
  fontWeight: 600,
};

/* ---------- helpers ---------- */
function fmt(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}