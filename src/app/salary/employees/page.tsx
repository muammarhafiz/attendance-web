'use client';

import React, { useEffect, useMemo, useState } from 'react';

type StaffRow = {
  email: string;
  name: string;
  basic_salary: number;
  skip_payroll: boolean;
};

type LoadRes = { ok: true; rows: StaffRow[] } | { ok: false; error: string };
type SaveRes = { ok: true } | { ok: false; error: string };

export default function SalaryEmployeesPage() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, { basic_salary: string; skip_payroll: boolean }>>({});

  // load staff from our API (which reads attendance DB)
  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch('/salary/api/staff-list', { cache: 'no-store' });
        const j: LoadRes = await r.json();
        if (!r.ok || !('ok' in j) || !j.ok) throw new Error(('error' in j && j.error) || 'Failed to load');
        setRows(j.rows);
        const d: Record<string, { basic_salary: string; skip_payroll: boolean }> = {};
        for (const s of j.rows) {
          d[s.email] = { basic_salary: (Number(s.basic_salary || 0).toFixed(2)), skip_payroll: !!s.skip_payroll };
        }
        setDraft(d);
        setDirty({});
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    return rows.reduce((sum, r) => sum + Number(draft[r.email]?.basic_salary ?? r.basic_salary ?? 0), 0);
  }, [rows, draft]);

  const onChange = (email: string, key: 'basic_salary' | 'skip_payroll', value: string | boolean) => {
    setDraft(prev => ({
      ...prev,
      [email]: {
        basic_salary: key === 'basic_salary'
          ? String(value)
          : (prev[email]?.basic_salary ?? '0.00'),
        skip_payroll: key === 'skip_payroll'
          ? Boolean(value)
          : (prev[email]?.skip_payroll ?? false),
      },
    }));
    setDirty(prev => ({ ...prev, [email]: true }));
  };

  const saveOne = async (email: string) => {
    const d = draft[email];
    if (!d) return;
    setSaving(prev => ({ ...prev, [email]: true }));
    try {
      const body = {
        email,
        basic_salary: Number(d.basic_salary || 0),
        skip_payroll: Boolean(d.skip_payroll),
      };
      const r = await fetch('/salary/api/staff-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j: SaveRes = await r.json();
      if (!r.ok || !j.ok) throw new Error(('error' in j && j.error) || 'Save failed');
      setDirty(prev => ({ ...prev, [email]: false }));
      setRows(prev =>
        prev.map(x => (x.email === email ? { ...x, basic_salary: body.basic_salary, skip_payroll: body.skip_payroll } : x)),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(prev => ({ ...prev, [email]: false }));
    }
  };

  const saveAll = async () => {
    // save sequentially to keep it simple
    for (const r of rows) {
      if (dirty[r.email]) {
        // eslint-disable-next-line no-await-in-loop
        await saveOne(r.email);
      }
    }
  };

  if (loading) return <div style={{ padding: 16, color: '#6b7280' }}>Loading…</div>;
  if (err) return <div style={{ padding: 16, color: '#b91c1c' }}>Error: {err}</div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Employees</h1>
          <div style={{ color: '#6b7280', fontSize: 12 }}>{rows.length} staff • Total Basic: {fmt(totals)}</div>
        </div>
        <div>
          <button onClick={saveAll} style={primaryBtn}>Save All</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={thLeft}>Name</th>
              <th style={thLeft}>Email</th>
              <th style={th}>Basic Salary (RM)</th>
              <th style={th}>Skip Payroll?</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = draft[r.email];
              const isSaving = !!saving[r.email];
              const isDirty = !!dirty[r.email];
              return (
                <tr key={r.email}>
                  <td style={tdLeft}>{r.name}</td>
                  <td style={tdLeft}><span style={{ color: '#6b7280' }}>{r.email}</span></td>
                  <td style={td}>
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={d?.basic_salary ?? Number(r.basic_salary || 0).toFixed(2)}
                      onChange={(e) => onChange(r.email, 'basic_salary', e.target.value)}
                      style={input}
                    />
                  </td>
                  <td style={td}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={!!(d?.skip_payroll ?? r.skip_payroll)}
                        onChange={(e) => onChange(r.email, 'skip_payroll', e.target.checked)}
                      />
                      <span style={{ fontSize: 12, color: '#374151' }}>Exclude from payroll run</span>
                    </label>
                  </td>
                  <td style={td}>
                    <button onClick={() => saveOne(r.email)} disabled={isSaving} style={secondaryBtn}>
                      {isSaving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
        Tip: set a basic salary and toggle “Skip Payroll” for staff you don’t want included this month.
      </p>
    </div>
  );
}

/* ---------- styles ---------- */
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const thLeft: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', fontWeight: 600 };
const th: React.CSSProperties = { textAlign: 'right', padding: '10px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', fontWeight: 600 };
const tdLeft: React.CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const td: React.CSSProperties = { textAlign: 'right', padding: '8px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, width: 160, outline: 'none' };
const primaryBtn: React.CSSProperties = { padding: '9px 12px', borderRadius: 8, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#111827', cursor: 'pointer' };

/* ---------- helpers ---------- */
function fmt(n: number): string {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}