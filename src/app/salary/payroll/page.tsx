'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type StaffRow = {
  email: string;
  name: string;
  base_salary: number | null;
  include_in_payroll: boolean;
};

export default function PayrollPage() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Create a stable Supabase client instance
  const supabase: SupabaseClient = useMemo(
    () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
        { auth: { persistSession: true, autoRefreshToken: true } }
      ),
    []
  );

  // Load staff list
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('staff')
        .select('email,name,base_salary,include_in_payroll')
        .order('name', { ascending: true });

      if (cancelled) return;

      if (error) {
        setErr(error.message);
      } else {
        const casted: StaffRow[] = (data ?? []).map((r) => ({
          email: r.email as string,
          name: r.name as string,
          base_salary:
            typeof r.base_salary === 'number'
              ? r.base_salary
              : r.base_salary == null
              ? null
              : Number(r.base_salary) || 0,
          include_in_payroll:
            typeof r.include_in_payroll === 'boolean'
              ? r.include_in_payroll
              : true,
        }));
        setRows(casted);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Save base salary
  const updateSalary = async (email: string, newValue: number) => {
    setSaving(email + ':salary');
    const { error } = await supabase
      .from('staff')
      .update({ base_salary: newValue })
      .eq('email', email);
    setSaving(null);

    if (error) {
      alert('Update failed: ' + error.message);
      return;
    }
    setRows((r) =>
      r.map((x) => (x.email === email ? { ...x, base_salary: newValue } : x))
    );
  };

  // Save include/exclude toggle
  const toggleInclude = async (email: string, nextVal: boolean) => {
    // optimistic update
    setRows((r) => r.map((x) => (x.email === email ? { ...x, include_in_payroll: nextVal } : x)));
    setSaving(email + ':toggle');

    const { error } = await supabase
      .from('staff')
      .update({ include_in_payroll: nextVal })
      .eq('email', email);

    setSaving(null);
    if (error) {
      alert('Failed to save toggle: ' + error.message);
      // revert if failed
      setRows((r) => r.map((x) => (x.email === email ? { ...x, include_in_payroll: !nextVal } : x)));
    }
  };

  const included = useMemo(() => rows.filter((r) => r.include_in_payroll), [rows]);
  const totalBasic = useMemo(
    () => included.reduce((s, r) => s + (Number(r.base_salary) || 0), 0),
    [included]
  );

  const handleGenerate = () => {
    alert(
      `Ready to generate payslips for ${included.length} staff.\n` +
        `Total basic (included only): RM ${totalBasic.toFixed(2)}`
    );
  };

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (err) return <div style={{ padding: 16, color: '#b91c1c' }}>Error: {err}</div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Payroll</h2>
        <span style={{ color: '#6b7280' }}>
          Included: <b>{included.length}</b> / {rows.length} &nbsp;·&nbsp; Total basic: <b>RM {totalBasic.toFixed(2)}</b>
        </span>
        <button onClick={handleGenerate} style={primaryBtn}>Generate Payslips (preview)</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <th style={thLeft}>Include</th>
              <th style={thLeft}>Name</th>
              <th style={thLeft}>Email</th>
              <th style={thRight}>Basic Salary (RM)</th>
              <th style={thLeft}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSaving = saving?.startsWith(r.email + ':');
              return (
                <tr key={r.email} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={tdLeft}>
                    <input
                      type="checkbox"
                      checked={r.include_in_payroll}
                      onChange={(e) => toggleInclude(r.email, e.target.checked)}
                    />
                  </td>
                  <td style={tdLeft}>{r.name}</td>
                  <td style={tdLeft}>{r.email}</td>
                  <td style={tdRight}>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={r.base_salary ?? ''}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) updateSalary(r.email, val);
                      }}
                      style={input}
                    />
                  </td>
                  <td style={tdLeft}>
                    {isSaving ? <span style={{ color: '#6b7280' }}>Saving…</span> : <span style={{ color: '#059669' }}>OK</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
        Tip: Uncheck “Include” to skip that staff for the payroll run. Salary updates save on blur.
      </p>
    </div>
  );
}

const thLeft: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const thRight: React.CSSProperties = { textAlign: 'right', padding: '10px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const tdLeft: React.CSSProperties = { textAlign: 'left', padding: '8px', verticalAlign: 'middle' };
const tdRight: React.CSSProperties = { textAlign: 'right', padding: '8px', verticalAlign: 'middle' };
const input: React.CSSProperties = { width: 120, textAlign: 'right', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 8px' };
const primaryBtn: React.CSSProperties = { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' };