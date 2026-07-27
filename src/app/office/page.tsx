'use client';
// The clerk/admin home — three summary cards (Daily / Weekly / Monthly). Each opens its own page.
// Daily shows a point-by-point breakdown: each task is red when it has a backlog, green when settled.
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

type DState = 'ok' | 'bad';
type DRow = { label: string; value: string; state: DState };
const CANON_METHODS = [{ key: 'transfer', label: 'Bank transfer' }, { key: 'qr', label: 'QR' }, { key: 'card', label: 'Card' }];

function dailyRows(d: Home): DRow[] {
  const rows: DRow[] = [];
  const pi = d.pi_pending || 0;
  rows.push({ label: 'Purchase invoice pending', value: pi > 0 ? String(pi) : 'none', state: pi > 0 ? 'bad' : 'ok' });
  const nc = d.zero_cogs?.items || 0;
  rows.push({ label: 'COGS no cost', value: nc > 0 ? `${nc} item${nc === 1 ? '' : 's'}` : 'none', state: nc > 0 ? 'bad' : 'ok' });

  const m = d.daily_methods || {};
  const shown = new Set<string>();
  const methodRow = (key: string, label: string): DRow => {
    shown.add(key);
    const s = m[key];
    if (!s || s.total === 0) return { label, value: 'none', state: 'ok' };
    return { label, value: `${s.checked}/${s.total} checked`, state: s.checked >= s.total ? 'ok' : 'bad' };
  };
  for (const c of CANON_METHODS) rows.push(methodRow(c.key, c.label));
  for (const key of Object.keys(m)) {
    if (shown.has(key)) continue;
    rows.push(methodRow(key, m[key]?.label || key));
  }

  const sys = Number(d.daily_cash?.system || 0);
  const countedRaw = d.daily_cash?.counted;
  const counted = countedRaw != null;
  const matches = counted && Math.abs(Number(countedRaw) - sys) < 0.01;
  rows.push({
    label: 'Cash',
    value: sys === 0 && !counted ? 'none' : !counted ? 'not counted' : matches ? 'counted ✓' : 'mismatch',
    state: sys === 0 || (counted && matches) ? 'ok' : 'bad',
  });
  return rows;
}

function DailyStatusCard({ d }: { d: Home }) {
  const rows = dailyRows(d);
  const backlog = rows.some((r) => r.state === 'bad');
  return (
    <Link href="/office/daily" className="block">
      <div className="rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xl leading-none">📅</span>
          <h2 className="text-lg font-semibold text-gray-900">Daily</h2>
          {backlog && <span className="h-2 w-2 rounded-full bg-rose-500" title="Has backlog" />}
          <span className="ml-auto text-2xl text-gray-300">›</span>
        </div>
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.state === 'bad' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
              <span className="text-gray-600">{r.label}</span>
              <span className={`ml-auto font-medium ${r.state === 'bad' ? 'text-rose-600' : 'text-emerald-600'}`}>{r.value}</span>
            </li>
          ))}
        </ul>
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
  const weeklyAlert = d.po_pending > 0;
  const monthlyAlert = d.eom.done < d.eom.total;
  return (
    <OfficeShell title="🗂️ Office" onRefresh={reload}>
      <p className="mb-2 text-sm text-gray-500">Yesterday&rsquo;s tasks — <span className="text-rose-600">red</span> needs doing, <span className="text-emerald-600">green</span> is done.</p>
      <div className="space-y-3">
        <DailyStatusCard d={d} />
        <BigCard href="/office/weekly" icon="🗒️" title="Weekly" alert={weeklyAlert}
          summary={d.po_pending > 0 ? `${d.po_pending} to re-order · POs due before Wed` : 'Purchase orders · Mon–Tue'} />
        <BigCard href="/month-end" icon="🗓️" title="Monthly" alert={monthlyAlert}
          summary={`End of month · ${d.eom.done}/${d.eom.total} done`} />
      </div>
    </OfficeShell>
  );
}
