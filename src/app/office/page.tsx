'use client';
// The clerk/admin home — three summary cards (Daily / Weekly / Monthly). Each opens its own page.
import Link from 'next/link';
import { useClerkHome, Gate, OfficeShell, type Home } from '@/components/office/shared';

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
  const toCheck = d.daily_to_check || 0;
  const noCost = d.zero_cogs.items || 0;
  const piPending = d.pi_pending || 0;
  const dailyAlert = piPending > 0 || toCheck > 0 || noCost > 0;
  const dailyBits: string[] = [];
  if (piPending > 0) dailyBits.push(`${piPending} PI${piPending === 1 ? '' : 's'} to check in`);
  if (toCheck > 0) dailyBits.push(`${toCheck} payment${toCheck === 1 ? '' : 's'} to check`);
  if (noCost > 0) dailyBits.push(`${noCost} part${noCost === 1 ? '' : 's'} no cost`);
  const dailySummary = dailyBits.length ? dailyBits.join(' · ') : 'All caught up ✓';
  const weeklyAlert = d.po_pending > 0;
  const monthlyAlert = d.eom.done < d.eom.total;
  return (
    <OfficeShell title="🗂️ Office" onRefresh={reload}>
      <p className="mb-5 text-sm text-gray-500">Tap a section to see the tasks.</p>
      <div className="space-y-3">
        <BigCard href="/office/daily" icon="📅" title="Daily" alert={dailyAlert} summary={dailySummary} />
        <BigCard href="/office/weekly" icon="🗒️" title="Weekly" alert={weeklyAlert}
          summary={d.po_pending > 0 ? `${d.po_pending} to re-order · POs due before Wed` : 'Purchase orders · Mon–Tue'} />
        <BigCard href="/month-end" icon="🗓️" title="Monthly" alert={monthlyAlert}
          summary={`End of month · ${d.eom.done}/${d.eom.total} done`} />
      </div>
    </OfficeShell>
  );
}
