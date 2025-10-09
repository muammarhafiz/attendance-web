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
  pcb: number;
  epf_emp: number;
  socso_emp: number;
  eis_emp: number;
  epf_er: number;
  socso_er: number;
  eis_er: number;
  hrd_er: number;
  net_pay: number;
};

type RunApiRes =
  | { ok: true; payslips: Payslip[]; totals?: { count: number } }
  | { ok: false; error?: string; where?: string; code?: string };

type ManualApiRes =
  | { ok: true }
  | { ok: false; error?: string; where?: string; field?: string; code?: string };

type StaffPick = { email: string; name: string };

const currency = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollPage() {
  // UI state
  const [rows, setRows] = useState<Payslip[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  // adjustment form
  const [staff, setStaff] = useState<StaffPick[]>([]);
  const [selEmail, setSelEmail] = useState<string>('');
  const [kind, setKind] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [amount, setAmount] = useState<string>('100');
  const [label, setLabel] = useState<string>('');

  // load staff for selector (server already exposes staff via salary_staff_view)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/staff-for-salary', { credentials: 'include' });
        const j = await r.json();
        if (!cancelled && j?.ok && Array.isArray(j.data)) {
          setStaff(j.data as StaffPick[]);
          if (j.data.length && !selEmail) setSelEmail(j.data[0].email);
        }
      } catch {
        // ignore (selector can stay empty)
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // run payroll
  async function runPayroll() {
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', {
        method: 'POST',
        credentials: 'include', // <<< IMPORTANT: send cookies (Supabase session)
      });
      const j: RunApiRes = await r.json();
      if (!r.ok || !j.ok) {
        const msg =
          !r.ok ? `HTTP ${r.status}` :
          j.error ? `${j.where ? j.where + ': ' : ''}${j.error}` :
          'Failed';
        throw new Error(msg);
      }
      setRows(j.payslips);
      setLastRunAt(new Date().toLocaleString());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to run payroll');
    }
  }

  // add adjustment
  async function addAdjustment() {
    setErr(null);
    const amt = (amount || '').toString().trim();
    try {
      const r = await fetch('/salary/api/manual', {
        method: 'POST',
        credentials: 'include', // <<< IMPORTANT
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff_email: selEmail,
          kind,
          amount: amt,
          label: label?.trim() || null,
        }),
      });
      const j: ManualApiRes = await r.json();
      if (!r.ok || !j.ok) {
        const msg =
          !r.ok ? `HTTP ${r.status}` :
          j.error ? `${j.where ? j.where + ': ' : ''}${j.error}` :
          'Failed to add';
        throw new Error(msg);
      }
      // refresh table after successful insert
      await runPayroll();
      setAmount('100');
      setLabel('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to add adjustment');
    }
  }

  // optional: auto-run once when page opens so table isn’t empty
  useEffect(() => {
    runPayroll().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalRow = useMemo(() => {
    const init: Omit<Payslip, 'email' | 'name'> = {
      basic_pay: 0, additions: 0, other_deduct: 0, gross_pay: 0, pcb: 0,
      epf_emp: 0, socso_emp: 0, eis_emp: 0, epf_er: 0, socso_er: 0, eis_er: 0, hrd_er: 0, net_pay: 0
    };
    return rows.reduce((acc, r) => {
      acc.basic_pay   += r.basic_pay;
      acc.additions   += r.additions;
      acc.other_deduct+= r.other_deduct;
      acc.gross_pay   += r.gross_pay;
      acc.pcb         += r.pcb;
      acc.epf_emp     += r.epf_emp;
      acc.socso_emp   += r.socso_emp;
      acc.eis_emp     += r.eis_emp;
      acc.epf_er      += r.epf_er;
      acc.socso_er    += r.socso_er;
      acc.eis_er      += r.eis_er;
      acc.hrd_er      += r.hrd_er;
      acc.net_pay     += r.net_pay;
      return acc;
    }, { ...init });
  }, [rows]);

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ margin: '8px 0 2px' }}>Salary System</h2>
      <div style={{ color: '#666', marginBottom: 12 }}>Payroll & Employees</div>

      {/* Adjustment box */}
      <div style={{
        border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 16,
        background: '#fff'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Adjustment (EARN/DEDUCT)</div>

        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1.6fr 0.9fr 0.8fr 1.2fr 0.6fr' }}>
          {/* staff select */}
          <select value={selEmail} onChange={(e) => setSelEmail(e.target.value)} style={{ padding: 8 }}>
            {staff.map(s => (
              <option key={s.email} value={s.email}>
                {s.name ? `${s.name} — ${s.email}` : s.email}
              </option>
            ))}
          </select>

          {/* kind */}
          <select value={kind} onChange={(e) => setKind(e.target.value as 'EARN'|'DEDUCT')} style={{ padding: 8 }}>
            <option value="EARN">EARN</option>
            <option value="DEDUCT">DEDUCT</option>
          </select>

          {/* amount */}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            inputMode="decimal"
            style={{ padding: 8 }}
          />

          {/* label */}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (optional)"
            style={{ padding: 8 }}
          />

          <button onClick={addAdjustment} style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }}>
            Add
          </button>
        </div>

        {err && (
          <div style={{ color: '#dc2626', marginTop: 8 }}>
            Error: {err}
          </div>
        )}
      </div>

      {/* Run payroll */}
      <div style={{ marginBottom: 10 }}>
        <button
          onClick={runPayroll}
          style={{
            width: '100%', padding: '10px 12px',
            border: '1px solid #d1d5db', borderRadius: 8, background: '#fff'
          }}
        >
          Run Payroll
        </button>
      </div>

      <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
        {lastRunAt ? `Last updated: ${lastRunAt}` : '\u00A0'}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={th}>Employee</th>
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
            {rows.map((r) => (
              <tr key={r.email}>
                <td style={tdLeft}>
                  <div style={{ fontWeight: 600 }}>{r.name || r.email}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{r.email}</div>
                </td>
                <td style={td}>{currency(r.basic_pay)}</td>
                <td style={td}>{currency(r.additions)}</td>
                <td style={td}>{currency(r.other_deduct)}</td>
                <td style={td}>{currency(r.gross_pay)}</td>
                <td style={td}>{currency(r.pcb)}</td>
                <td style={td}>{currency(r.epf_emp)}</td>
                <td style={td}>{currency(r.socso_emp)}</td>
                <td style={td}>{currency(r.eis_emp)}</td>
                <td style={td}>{currency(r.epf_er)}</td>
                <td style={td}>{currency(r.socso_er)}</td>
                <td style={td}>{currency(r.eis_er)}</td>
                <td style={td}>{currency(r.hrd_er)}</td>
                <td style={tdBold}>{currency(r.net_pay)}</td>
              </tr>
            ))}
            <tr style={{ background: '#f8fafc' }}>
              <td style={{ ...tdLeft, fontWeight: 700 }}>TOTAL</td>
              <td style={td}>{currency(totalRow.basic_pay)}</td>
              <td style={td}>{currency(totalRow.additions)}</td>
              <td style={td}>{currency(totalRow.other_deduct)}</td>
              <td style={td}>{currency(totalRow.gross_pay)}</td>
              <td style={td}>{currency(totalRow.pcb)}</td>
              <td style={td}>{currency(totalRow.epf_emp)}</td>
              <td style={td}>{currency(totalRow.socso_emp)}</td>
              <td style={td}>{currency(totalRow.eis_emp)}</td>
              <td style={td}>{currency(totalRow.epf_er)}</td>
              <td style={td}>{currency(totalRow.socso_er)}</td>
              <td style={td}>{currency(totalRow.eis_er)}</td>
              <td style={td}>{currency(totalRow.hrd_er)}</td>
              <td style={tdBold}>{currency(totalRow.net_pay)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'right',
  padding: '10px 8px',
  fontWeight: 600,
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  textAlign: 'right',
  padding: '10px 8px',
  borderBottom: '1px solid #f1f5f9',
  whiteSpace: 'nowrap',
};

const tdBold: React.CSSProperties = {
  ...td,
  fontWeight: 700,
};

const tdLeft: React.CSSProperties = {
  ...td,
  textAlign: 'left',
};