// src/app/payroll/settings/page.tsx
'use client';

import PayrollTabs from '@/components/PayrollTabs';
import PayrollItemsSettings from '@/components/settings/PayrollItemsSettings';

// Kept for the existing Payroll > Settings tab; the same panel also lives under the
// top-level Settings page (/settings). Both render the shared PayrollItemsSettings component.
export default function PayrollSettingsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PayrollTabs />
      <PayrollItemsSettings />
    </div>
  );
}
