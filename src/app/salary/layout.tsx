// src/app/salary/layout.tsx
import React from 'react';
import PageShell from '@/components/PageShell';

export default function SalaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageShell
      title="Salary System"
      subtitle="Payroll & Employees"
      // actions can be added later if you want buttons on the right
    >
      <div style={{ padding: 16 }}>
        {children}
      </div>
    </PageShell>
  );
}