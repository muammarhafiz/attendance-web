'use client';
// Office → Weekly: chase unpaid invoices.
import { useClerkHome, Gate, OfficeShell, UnpaidCard } from '@/components/office/shared';

export default function WeeklyPage() {
  const { allowed, d, loading, reload } = useClerkHome();
  return (
    <Gate allowed={allowed} loading={loading} d={d}>
      <OfficeShell title="🗒️ Weekly" back onRefresh={reload}>
        <div className="grid grid-cols-1 gap-3">
          {d && <UnpaidCard unpaid={d.unpaid} />}
        </div>
      </OfficeShell>
    </Gate>
  );
}
