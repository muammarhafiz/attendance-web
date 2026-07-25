'use client';
// Office → Daily: yesterday's money (check the bank) + cash count.
import { useClerkHome, Gate, OfficeShell, YesterdayCard, CashCountCard } from '@/components/office/shared';

export default function DailyPage() {
  const { allowed, d, loading, reload } = useClerkHome();
  return (
    <Gate allowed={allowed} loading={loading} d={d}>
      <OfficeShell title="📅 Daily" back onRefresh={reload}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d && <YesterdayCard y={d.yesterday} />}
          <CashCountCard />
        </div>
      </OfficeShell>
    </Gate>
  );
}
