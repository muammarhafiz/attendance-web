'use client';
// Office → Weekly: purchase orders (create Mon/Tue, WhatsApp supplier, submit before Wed).
import { useClerkHome, Gate, OfficeShell, PurchaseOrderCard, WaitingDeliveryCard, WatchlistCard } from '@/components/office/shared';

export default function WeeklyPage() {
  const { allowed, d, loading, reload } = useClerkHome();
  return (
    <Gate allowed={allowed} loading={loading} d={d}>
      <OfficeShell title="🗒️ Weekly" back onRefresh={reload}>
        <div className="grid grid-cols-1 gap-3">
          {d && <PurchaseOrderCard list={d.po_list} />}
          {d && <WaitingDeliveryCard list={d.po_on_order} />}
          {d && <WatchlistCard list={d.watchlist ?? []} />}
        </div>
      </OfficeShell>
    </Gate>
  );
}
