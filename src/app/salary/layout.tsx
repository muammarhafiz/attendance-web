// src/app/salary/layout.tsx
import React from 'react';
import PageShell from '@/components/PageShell';

export const metadata = {
  title: 'Salary • Attendance',
};

export default function SalaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      <div style={{ padding: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Salary System</h1>
        <p style={{ margin: '6px 0 16px', color: '#6b7280' }}>
          Internal module embedded inside the Attendance app.
        </p>

        {/* simple local nav for the salary module */}
        <div style={{
          display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap'
        }}>
          <a href="/salary/payroll" style={{
            padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, textDecoration: 'none'
          }}>Payroll</a>
          {/* we can add more tabs later, e.g. /salary/employees */}
        </div>

        {children}
      </div>
    </PageShell>
  );
}