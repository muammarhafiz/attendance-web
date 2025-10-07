// src/app/payroll/page.tsx
import React from 'react';
import AdjustmentsClient from '@/components/AdjustmentsClient';
import RunPayrollClient from '@/components/RunPayrollClient';

function getYearMonthFromNow() {
  const now = new Date();
  // Use local month/year (adjust if you need a specific period picker)
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  return { year, month };
}

export default async function Page() {
  const { year, month } = getYearMonthFromNow();

  return (
    <main style={pageWrap}>
      <div style={card}>
        <h1 style={h1}>Payroll — {year}/{String(month).padStart(2, '0')}</h1>

        {/* SECTION: Adjustments (inline) */}
        <section style={section}>
          <div style={sectionHeader}>
            <div style={sectionTitle}>Adjustments</div>
            <div style={sectionSub}>Commission (COMM) &nbsp;|&nbsp; Advance / Deduction (ADV)</div>
          </div>

          <div style={sectionBody}>
            {/* Adjustments box (client) */}
            <AdjustmentsClient year={year} month={month} />
          </div>
        </section>

        {/* Divider between employee (earnings/deductions) and employer (statutory) sections in the table
           is handled by the table itself (RunPayrollClient) */}
        <hr style={divider} />

        {/* SECTION: Payroll Preview/Table */}
        <section style={section}>
          <div style={sectionHeader}>
            <div style={sectionTitle}>Payroll</div>
            <div style={sectionSub}>Auto-updates after you save adjustments</div>
          </div>

          <div style={sectionBody}>
            <RunPayrollClient year={year} month={month} />
          </div>
        </section>
      </div>
    </main>
  );
}

/* ---------- Inline styles (consistent look for both boxes) ---------- */
const pageWrap: React.CSSProperties = {
  padding: '16px',
};

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#fff',
  padding: 16,
  maxWidth: 1200,
  margin: '0 auto',
  fontSize: 14,               // unify font size across the whole page
  color: '#111827',
};

const h1: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  margin: 0,
  paddingBottom: 8,
  borderBottom: '1px solid #e5e7eb',
  marginBottom: 12,
};

const section: React.CSSProperties = {
  marginBottom: 12,
};

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 8,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
};

const sectionSub: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
};

const sectionBody: React.CSSProperties = {
  // this keeps spacing consistent between the two components
};

const divider: React.CSSProperties = {
  border: 0,
  borderTop: '1px dashed #d1d5db', // subtle divider between sections
  margin: '12px 0',
};
