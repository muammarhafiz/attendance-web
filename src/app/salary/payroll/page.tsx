'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

type StaffRow = {
  email: string;
  name: string;
  base_salary?: number | null;
};

export default function PayrollPage() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );

  // Load staff list
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('staff')
        .select('email,name,base_salary')
        .order('name', { ascending: true });
      if (error) setErr(error.message);
      else setRows(data || []);
      setLoading(false);
    })();
  }, []);

  // Handle salary edit
  const updateSalary = async (email: string, newValue: number) => {
    const { error } = await supabase
      .from('staff')
      .update({ base_salary: newValue })
      .eq('email', email);

    if (error) alert('Update failed: ' + error.message);
    else {
      setRows((r) =>
        r.map((x) => (x.email === email ? { ...x, base_salary: newValue } : x))
      );
    }
  };

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (err) return <div style={{ padding: 16, color: '#b91c1c' }}>Error: {err}</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Payroll</h2>
      <p style={{ margin: '6px 0 16px', color: '#6b7280' }}>
        Tap a salary value to edit and save.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <th style={thLeft}>Name</th>
              <th style={thLeft}>Email</th>
              <th style={thRight}>Basic Salary (RM)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email} style={{ borderBottom: '1px solid #f3f4f6' }}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thLeft: React.CSSProperties = { textAlign: 'left', padding: '10px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const thRight: React.CSSProperties = { textAlign: 'right', padding: '10px 8px', fontWeight: 600, whiteSpace: 'nowrap' };
const tdLeft: React.CSSProperties = { textAlign: 'left', padding: '8px' };
const tdRight: React.CSSProperties = { textAlign: 'right', padding: '8px' };
const input: React.CSSProperties = {
  width: 100,
  textAlign: 'right',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '4px 6px',
};