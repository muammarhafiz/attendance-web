'use client';
// Office → Weekly: chase unpaid + parts with no cost.
import { useClerkHome, Gate, OfficeShell, UnpaidCard, ZeroCogsCard } from '@/components/office/shared';

export default function WeeklyPage() {
  const { allowed, d, loading, reload } = useClerkHome();
  return (
    <Gate allowed={allowed} loading={loading} d={d}>
      <OfficeShell title="🗒️ Weekly" back onRefresh={reload}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d && <UnpaidCard unpaid={d.unpaid} />}
          {d && <ZeroCogsCard zero_cogs={d.zero_cogs} />}
        </div>
      </OfficeShell>
    </Gate>
  );
}
