// src/app/salary/page.tsx
import Link from 'next/link';

export default function SalaryHome() {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Salary</h2>
      <p style={{ margin: '6px 0 16px', color: '#6b7280' }}>
        Go to Payroll to view staff pulled from the Attendance database.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/salary/payroll" style={btn}>Open Payroll</Link>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  textDecoration: 'none',
  color: '#111827',
};