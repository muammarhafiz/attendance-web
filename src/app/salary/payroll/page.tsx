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

type ApiOk = { ok: true; payslips: Payslip[] };
type ApiErr = { ok: false; error: string };
type ApiRes = ApiOk | ApiErr;

type ManualOk = { ok: true };
type ManualErr = { ok: false; error: string };
type ManualRes = ManualOk | ManualErr;

type Kind = 'EARN' | 'DEDUCT';

/* ---------- Page ---------- */
export default function PayrollPage() {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  // adjustment box state
  const [selEmail, setSelEmail] = useState<string>('');
  const [kind, setKind] = useState<Kind>('EARN');
  const [amount, setAmount] = useState<string>(''); // keep as string for input UX
  const [label, setLabel] = useState<string>('');
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjErr, setAdjErr] = useState<string | null>(null);
  const [adjOk, setAdjOk] = useState<string | null>(null);

  // Load payroll
  async function run() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', {
        method: 'POST',
        credentials: 'include', // <<< carry Supabase session cookies
      });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Options for staff dropdown (derived from rows once loaded)
  const staffOptions = useMemo(() => {
    const list = rows ?? [];
    return list
      .map((r) => ({ email: r.email, name: r.name || r.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Totals row
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

  // Add manual adjustment
  async function addAdjustment() {
    setAdjErr(null);
    setAdjOk(null);

    const amt = Number(amount);
    if (!selEmail) return setAdjErr('Please select a staff.');
    if (!Number.isFinite(amt) || amt <= 0) return setAdjErr('Enter a valid amount.');

    setAdjBusy(true);
    try {
      const r = await fetch('/salary/api/manual', {
        method: 'POST',
        credentials: 'include', // <<< carry Supabase session cookies (fixes “Auth session missing!”)
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          staff_email: selEmail,
          kind, // 'EARN' | 'DEDUCT'
          amount: amt,
          label: label || null,
        }),
      });

      const j: ManualRes = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error('ok' in j ? 'Unknown error' : j.error || 'Failed');
      }

      // Clear inputs & refresh payroll
      setAmount('');
      setLabel('');
      setAdjOk('Added.');
      await run();
    } catch (e) {
      setAdjErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setAdjBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      {/* ---------- Adjustments box ---------- */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          background: '#fff',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>
          Adjustments (EARN / DEDUCT)
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 1fr) 100px 140px 1fr 100px',
            gap: 8,
            alignItems: 'center',
          }}
        >
          {/* staff select */}
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Select staff…
            </div>
            <select
              value={selEmail}
              onChange={(e) => setSelEmail(e.target.value)}
              style={input}
            >
              <option value="" disabled>
                — choose —
              </option>
              {staffOptions.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.name} — {s.email}
                </option>
              ))}
            </select>
          </div>

          {/* kind */}
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Type
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="radio"
                  name="kind"
                  value="EARN"
                  checked={kind === 'EARN'}
                  onChange={() => setKind('EARN')}
                />
                EARN
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="radio"
                  name="kind"
                  value="DEDUCT"
                  checked={kind === 'DEDUCT'}
                  onChange={() => setKind('DEDUCT')}
                />
                DEDUCT
              </label>
            </div>
          </div>

          {/* amount */}
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Amount
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={{ ...input, textAlign: 'right' }}
            />
          </div>

          {/* label */}
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              Label (optional)
            </div>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === 'EARN' ? 'Commission' : 'Advance'}
              style={input}
            />
          </div>

          {/* add button */}
          <div style={{ alignSelf: 'end' }}>
            <button
              onClick={addAdjustment}
              disabled={adjBusy || !rows}
              style={btnPrimary}
            >
              {adjBusy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>

        {/* inline error/success */}
        {adjErr && (
          <div style={{ color: '#b91c1c', marginTop: 8 }}>Error: {adjErr}</div>
        )}
        {adjOk && (
          <div style={{ color: '#047857', marginTop: 8 }}>{adjOk}</div>
        )}
      </div>

      {/* ---------- Run Payroll ---------- */}
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
          background: '#fff',
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
            background: '#fff',
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
  border: '1px solid #d1d5db',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 14,
  background: '#fff',
};

const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #111827',
  cursor: 'pointer',
  background: '#fff',
};

/* ---------- helpers ---------- */
function fmt(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}