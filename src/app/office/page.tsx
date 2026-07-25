'use client';
// The clerk/admin home — three summary cards (Daily / Weekly / Monthly). Each opens its own page.
import Link from 'next/link';
import { useClerkHome, Gate, OfficeShell, rm0, moneyIn, type Home } from '@/components/office/shared';

function BigCard({ href, icon, title, summary, alert }: { href: string; icon: string; title: string; summary: string; alert?: boolean }) {
  return (
    <Link href={href} className="block">
      <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300">
        <span className="text-3xl leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {alert && <span className="h-2 w-2 rounded-full bg-amber-500" title="Needs attention" />}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">{summary}</p>
        </div>
        <span className="shrink-0 text-2xl text-gray-300">›</span>
      </div>
    </Link>
  );
}

export default function OfficePage() {
  const { allowed, d, loading, reload } = useClerkHome();
  return (
    <Gate allowed={allowed} loading={loading} d={d}>
      {d && <OfficeHome d={d} reload={reload} />}
    </Gate>
  );
}

function OfficeHome({ d, reload }: { d: Home; reload: () => void }) {
  const yIn = moneyIn(d.yesterday);
  const weeklyAlert = d.unpaid.count > 0 || d.zero_cogs.items > 0;
  const monthlyAlert = d.eom.blockers > 0 || d.eom.done < d.eom.total;
  return (
    <OfficeShell title="🗂️ Office" onRefresh={reload}>
      <p className="mb-5 text-sm text-gray-500">Tap a section to see the tasks.</p>
      <div className="space-y-3">
        <BigCard href="/office/daily" icon="📅" title="Daily"
          summary={d.yesterday ? `Yesterday ${rm0(yIn)} in · check the bank + count cash` : 'Check the bank + count cash'} />
        <BigCard href="/office/weekly" icon="🗒️" title="Weekly" alert={weeklyAlert}
          summary={`${d.unpaid.count} unpaid (${rm0(d.unpaid.total)}) · ${d.zero_cogs.items} part${d.zero_cogs.items === 1 ? '' : 's'} no cost`} />
        <BigCard href="/month-end" icon="🗓️" title="Monthly" alert={monthlyAlert}
          summary={`End of month · ${d.eom.done}/${d.eom.total} done${d.eom.blockers > 0 ? ` · ${d.eom.blockers} day${d.eom.blockers === 1 ? '' : 's'} to clear` : ''}`} />
      </div>
    </OfficeShell>
  );
}
