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

type ManualItem = {
  id: string;
  staff_email: string;
  kind: 'EARN' | 'DEDUCT';
  amount: number;
  label: string | null;
  created_at: string;
  created_by: string | null;
};

export default function PayrollPage() {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  // adjustments state
  const [items, setItems] = useState<ManualItem[]>([]);
  const [aError, setAError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // form fields
  const [fEmail, setFEmail] = useState('');
  const [fKind, setFKind] = useState<'EARN' | 'DEDUCT'>('EARN');
  const [fAmount, setFAmount] = useState<string>('');
  const [fLabel, setFLabel] = useState<string>('');
  const [editId, setEditId] = useState<string | null>(null);

  // Run payroll (fetches from API)
  async function run() {
    if (loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/salary/api/run', { method: 'POST' });
      const j: ApiRes = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error('ok' in j ? 'Unknown error' : (j as ApiErr).error || 'Failed');
      }
      setRows((j as ApiOk).payslips);
      setLastRunAt(new Date().toLocaleString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function loadManual() {
    try {
      setAError(null);
      const r = await fetch('/salary/api/manual', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Failed to load manual items');
      setItems(j.items as ManualItem[]);
    } catch (e) {
      setAError(e instanceof Error ? e.message : 'Error');
    }
  }

  // Initial auto-run and load adjustments
  useEffect(() => {
    run().then(() => loadManual());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const sum = (k: keyof Payslip) => list.reduce((s, r) => s + Number(r[k] || 0), 0);
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

  // Build staff list from payroll rows (name/email)
  const staffOptions = useMemo(() => {
    const r = rows ?? [];
    return r
      .map(x => ({ email: x.email, name: x.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  function resetForm() {
    setFEmail('');
    setFKind('EARN');
    setFAmount('');
    setFLabel('');
    setEditId(null);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!fEmail || !fAmount) return;
    const amount = Number(fAmount);
    if (Number.isNaN(amount)) {
      setAError('Amount must be a number');
      return;
    }
    setSaving(true);
    setAError(null);
    try {
      const payload = { staff_email: fEmail, kind: fKind, amount, label: fLabel || undefined };
      let r: Response;
      if (editId) {
        r = await fetch('/salary/api/manual', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: editId, ...payload }),
        });
      } else {
        r = await fetch('/salary/api/manual', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Failed');
      resetForm();
      await loadManual();
      await run(); // refresh payroll totals so changes show immediately
    } catch (err2) {
      setAError(err2 instanceof Error ? err2.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this item?')) return;
    setSaving(true);
    setAError(null);
    try {
      const r = await fetch(`/salary/api/manual?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Failed to delete');
      await loadManual();
      await run();
    } catch (e) {
      setAError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  function onEdit(it: ManualItem) {
    setEditId(it.id);
    setFEmail(it.staff_email);
    setFKind(it.kind);
    setFAmount(String(it.amount));
    setFLabel(it.label ?? '');
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>
      {/* Adjustments box */}
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          background: '#f8fafc',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Adjustments (EARN / DEDUCT)</div>

        <form onSubmit={submitForm} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 1fr 120px', gap: 8 }}>
          <select value={fEmail} onChange={(e) => setFEmail(e.target.value)} required>
            <option value="">Select staff…</option>
            {staffOptions.map(s => (
              <option key={s.email} value={s.email}>{s.name} — {s.email}</option>
            ))}
          </select>

          <select value={fKind} onChange={(e) => setFKind(e.target.value as 'EARN' | 'DEDUCT')}>
            <option value="EARN">EARN</option>
            <option value="DEDUCT">DEDUCT</option>
          </select>

          <input
            value={fAmount}
            onChange={(e) => setFAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            required
          />

          <input
            value={fLabel}
            onChange={(e) => setFLabel(e.target.value)}
            placeholder="Label (optional)"
          />

          <button
            type="submit"
            disabled={saving}
            style={{ border: '1px solid #111827', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {editId ? 'Update' : 'Add'}
          </button>
        </form>

        {aError && <div style={{ color: '#b91c1c', marginTop: 8 }}>Error: {aError}</div>}

        {/* Manual items list */}
        {items.length > 0 && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #d1d5db' }}>
                  <th style={thLeft}>Staff</th>
                  <th style={th}>Kind</th>
                  <th style={th}>Amount</th>
                  <th style={thLeft}>Label</th>
                  <th style={thLeft}>Created</th>
                  <th style={thLeft}>By</th>
                  <th style={thLeft}>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const staff = staffOptions.find(s => s.email === it.staff_email);
                  return (
                    <tr key={it.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdLeft}>
                        <div style={{ fontWeight: 600 }}>{staff?.name ?? it.staff_email}</div>
                        <div style={{ color: '#6b7280', fontSize: 12 }}>{it.staff_email}</div>
                      </td>
                      <td style={td}>{it.kind}</td>
                      <td style={td}>{fmt(it.amount)}</td>
                      <td style={tdLeft}>{it.label ?? ''}</td>
                      <td style={tdLeft}>{new Date(it.created_at).toLocaleString()}</td>
                      <td style={tdLeft}>{it.created_by ?? ''}</td>
                      <td style={tdLeft}>
                        <button onClick={() => onEdit(it)} style={linkBtn}>Edit</button>
                        <button onClick={() => onDelete(it.id)} style={{ ...linkBtn, color: '#b91c1c' }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payroll run button */}
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

      {err && <div style={{ color: '#b91c1c', marginBottom: 12 }}>Error: {err}</div>}
      {lastRunAt && (
        <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
          Last updated: {lastRunAt}
        </div>
      )}

      {/* Payroll table */}
      {rows && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, overflowX: 'auto' }}>
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
                    <div style={{ color: '#6b7280', fontSize: 12 }}>{p.email}</div>
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
const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  marginRight: 8,
  color: '#111827',
};

/* ---------- helpers ---------- */
function fmt(n: number) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}