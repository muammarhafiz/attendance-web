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

type RunOk = { ok: true; payslips: Payslip[]; totals?: { count: number } };
type RunErr = { ok: false; where?: string; error: string; code?: string };
type RunApiRes = RunOk | RunErr;

type AddBody = {
  staff_email: string;
  kind: 'EARN' | 'DEDUCT';
  amount: string | number;
  label?: string | null;
};

const fmt = (n: number) =>
  n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollPage() {
  const [rows, setRows] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errMsg, setErrMsg] = useState<string>('');
  const [lastRunAt, setLastRunAt] = useState<string>('');

  // Adjustment form state
  const [selEmail, setSelEmail] = useState<string>('');
  const [kind, setKind] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [amount, setAmount] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [adding, setAdding] = useState<boolean>(false);
  const [addErr, setAddErr] = useState<string>('');
  const [addOk, setAddOk] = useState<string>('');

  // Build staff options from current rows
  const staffOptions = useMemo(() => {
    const dedup = new Map<string, string>();
    for (const r of rows) {
      const name = r.name?.trim() || r.email;
      dedup.set(r.email, name);
    }
    return Array.from(dedup.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  async function runPayroll() {
    setLoading(true);
    setErrMsg('');
    try {
      const r = await fetch('/salary/api/run', {
        method: 'POST',
        credentials: 'include', // IMPORTANT: send Supabase auth cookie
      });
      let j: RunApiRes;
      try {
        j = (await r.json()) as RunApiRes;
      } catch {
        throw new Error(!r.ok ? `HTTP ${r.status}` : 'Invalid JSON from /salary/api/run');
      }

      if (!r.ok || !j.ok) {
        const msg = !r.ok
          ? `HTTP ${r.status}`
          : j.error
            ? `${j.where ? j.where + ': ' : ''}${j.error}`
            : 'Failed';
        throw new Error(msg);
      }

      setRows(j.payslips);
      setLastRunAt(new Date().toLocaleString());
      // Preselect first staff on first load if none selected yet
      if (!selEmail && j.payslips.length > 0) {
        setSelEmail(j.payslips[0].email);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErrMsg(m || 'Failed to run payroll');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial load
    runPayroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAddAdjustment() {
    setAddErr('');
    setAddOk('');
    if (!selEmail) {
      setAddErr('Please choose a staff.');
      return;
    }
    const amt = Number(String(amount).replace(/[, ]/g, ''));
    if (!isFinite(amt) || amt < 0) {
      setAddErr('Amount must be a non-negative number.');
      return;
    }
    setAdding(true);
    try {
      const body: AddBody = {
        staff_email: selEmail,
        kind,
        amount: Math.round(amt * 100) / 100,
        label: label.trim() ? label.trim() : null,
      };
      const r = await fetch('/salary/api/manual', {
        method: 'POST',
        credentials: 'include', // IMPORTANT: send Supabase auth cookie
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // The manual API always returns JSON (ok true/false)
      const j = await r.json().catch(() => null as unknown as { ok?: boolean; error?: string; where?: string });

      if (!r.ok || !j?.ok) {
        const msg = !r.ok
          ? `HTTP ${r.status}`
          : j?.error
            ? `${j.where ? j.where + ': ' : ''}${j.error}`
            : 'Failed to add adjustment';
        throw new Error(msg);
      }

      setAddOk('Saved!');
      setAmount('');
      setLabel('');
      // re-run payroll to refresh table numbers
      await runPayroll();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setAddErr(m || 'Failed to add adjustment');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Payroll</h1>

      {/* Adjustment Box */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Adjustment</div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) 140px 160px minmax(200px, 1fr) 120px',
            gap: 12,
            alignItems: 'end',
          }}
        >
          {/* Staff */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Staff
            </label>
            <select
              value={selEmail}
              onChange={(e) => setSelEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
              }}
            >
              <option value="" disabled>
                {staffOptions.length === 0 ? 'No options (run payroll first)' : 'Choose staff'}
              </option>
              {staffOptions.map((o) => (
                <option key={o.email} value={o.email}>
                  {o.name} — {o.email}
                </option>
              ))}
            </select>
          </div>

          {/* Kind */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Kind
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'EARN' | 'DEDUCT')}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
              }}
            >
              <option value="EARN">Addition</option>
              <option value="DEDUCT">Deduction</option>
            </select>
          </div>

          {/* Amount */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Amount (RM)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
              }}
            />
          </div>

          {/* Label */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Label (optional)
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Commission, Advance, etc."
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
              }}
            />
          </div>

          {/* Add button */}
          <div>
            <button
              onClick={onAddAdjustment}
              disabled={adding}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #111827',
                background: '#111827',
                color: '#fff',
                fontWeight: 600,
                cursor: adding ? 'not-allowed' : 'pointer',
              }}
            >
              {adding ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>

        {/* Add feedback */}
        {(addErr || addOk) && (
          <div style={{ marginTop: 10 }}>
            {addErr && (
              <div style={{ color: '#b91c1c', fontSize: 13 }}>
                {addErr}
              </div>
            )}
            {addOk && (
              <div style={{ color: '#065f46', fontSize: 13 }}>
                {addOk}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button
          onClick={runPayroll}
          disabled={loading}
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #111827',
            background: '#111827',
            color: '#fff',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Running…' : 'Run'}
        </button>
        {lastRunAt && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>Last run: {lastRunAt}</span>
        )}
      </div>

      {errMsg && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            background: '#fef2f2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            borderRadius: 8,
          }}
        >
          {errMsg}
        </div>
      )}

      {/* Payroll table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Staff</th>
              <th style={thRight}>Basic</th>
              <th style={thRight}>Additions</th>
              <th style={thRight}>Other Deduct</th>
              <th style={thRight}>Gross</th>
              <th style={thRight}>EPF Emp</th>
              <th style={thRight}>SOCSO Emp</th>
              <th style={thRight}>EIS Emp</th>
              <th style={thRight}>PCB</th>
              <th style={thRight}>Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>
                  {loading ? 'Loading…' : 'No data'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.email} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={td}>{r.name || r.email}<div style={{ fontSize: 12, color: '#6b7280' }}>{r.email}</div></td>
                  <td style={tdRight}>{fmt(r.basic_pay)}</td>
                  <td style={tdRight}>{fmt(r.additions)}</td>
                  <td style={tdRight}>{fmt(r.other_deduct)}</td>
                  <td style={tdRight}>{fmt(r.gross_pay)}</td>
                  <td style={tdRight}>{fmt(r.epf_emp)}</td>
                  <td style={tdRight}>{fmt(r.socso_emp)}</td>
                  <td style={tdRight}>{fmt(r.eis_emp)}</td>
                  <td style={tdRight}>{fmt(r.pcb)}</td>
                  <td style={{ ...tdRight, fontWeight: 700 }}>{fmt(r.net_pay)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  borderBottom: '1px solid #e5e7eb',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

const thRight: React.CSSProperties = { ...th, textAlign: 'right' };

const td: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };