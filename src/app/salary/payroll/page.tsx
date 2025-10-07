// src/app/salary/payroll/page.tsx
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

type StaffRow = {
  email: string;
  name: string;
  // if you've already added base_salary to attendance.public.staff, this will populate.
  base_salary?: number | null;
};

export default async function PayrollPage() {
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    }
  );

  // Pull from attendance DB -> public.staff
  // If base_salary column exists, it will come through; otherwise it's just undefined.
  const { data, error } = await supabase
    .from('staff')
    .select('email,name,base_salary')
    .order('name', { ascending: true });

  if (error) {
    return (
      <div style={{ padding: 16, color: '#b91c1c' }}>
        Failed to load staff: {error.message}
      </div>
    );
  }

  const rows: StaffRow[] = data || [];

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Payroll</h2>
      <p style={{ margin: '6px 0 16px', color: '#6b7280' }}>
        Staff list shown below is fetched directly from Attendance <code>public.staff</code>.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <th style={thLeft}>Name</th>
              <th style={thLeft}>Email</th>
              <th style={thRight}>Basic Salary (if any)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={tdLeft}>{r.name}</td>
                <td style={tdLeft}>{r.email}</td>
                <td style={tdRight}>
                  {typeof r.base_salary === 'number' ? r.base_salary.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} style={{ padding: 10, color: '#6b7280' }}>
                  No staff found.
                </td>
              </tr>
            )}
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