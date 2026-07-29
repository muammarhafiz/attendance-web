'use client';
// The clerk/admin home — three summary cards (Daily / Weekly / Monthly). Each opens its own page.
// Daily is a point-by-point breakdown with a date navigator: each task is red when it has a backlog,
// green when settled, for the picked day.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useClerkHome, Gate, OfficeShell, type Home } from '@/components/office/shared';
import { Icon, type IconName } from '@/components/icons';

function BigCard({ href, icon, title, summary, alert }: { href: string; icon: IconName; title: string; summary: string; alert?: boolean }) {
  return (
    <Link href={href} className="block">
      <div className="flex items-center gap-4 rounded-card bg-card shadow-card p-5 transition hover:-translate-y-px">
        <span className="text-ink-2"><Icon name={icon} size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {alert && <span className="h-2 w-2 rounded-full bg-warn" title="Needs attention" />}
          </div>
          <p className="mt-0.5 text-sm text-ink-2">{summary}</p>
        </div>
        <span className="shrink-0 text-2xl text-ink-3">›</span>
      </div>
    </Link>
  );
}

type DailySummary = {
  error?: string;
  day: string;
  pi_pending: number;
  zero_cogs: number;
  methods: Record<string, { total: number; checked: number; kiv: number; label?: string | null }>;
  cash: { system: number | string; counted: number | string | null };
};
type DState = 'ok' | 'bad' | 'kiv';
type DRow = { label: string; value: string; state: DState };
const CANON_METHODS = [{ key: 'transfer', label: 'Bank transfer' }, { key: 'qr', label: 'QR' }, { key: 'card', label: 'Card' }];

const klYesterday = () => new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const klToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const fmtDMY = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}/${y.slice(2)}`; };

function dailyRows(s: DailySummary): DRow[] {
  const rows: DRow[] = [];
  const pi = s.pi_pending || 0;
  rows.push({ label: 'Purchase invoice pending', value: pi > 0 ? String(pi) : 'none', state: pi > 0 ? 'bad' : 'ok' });
  const nc = s.zero_cogs || 0;
  rows.push({ label: 'COGS no cost', value: nc > 0 ? `${nc} item${nc === 1 ? '' : 's'}` : 'none', state: nc > 0 ? 'bad' : 'ok' });

  const m = s.methods || {};
  const shown = new Set<string>();
  const methodRow = (key: string, label: string): DRow => {
    shown.add(key);
    const st = m[key];
    if (!st || st.total === 0) return { label, value: 'none', state: 'ok' };
    const kiv = st.kiv || 0;
    const backlog = st.total - st.checked - kiv;
    if (backlog > 0) return { label, value: `${st.checked}/${st.total} checked${kiv > 0 ? ` · ${kiv} KIV` : ''}`, state: 'bad' };
    if (kiv > 0) return { label, value: `${kiv} KIV (checking)`, state: 'kiv' };
    return { label, value: `${st.checked}/${st.total} checked`, state: 'ok' };
  };
  for (const c of CANON_METHODS) rows.push(methodRow(c.key, c.label));
  for (const key of Object.keys(m)) {
    if (shown.has(key)) continue;
    rows.push(methodRow(key, m[key]?.label || key));
  }

  const sys = Number(s.cash?.system || 0);
  const countedRaw = s.cash?.counted;
  const counted = countedRaw != null;
  const matches = counted && Math.abs(Number(countedRaw) - sys) < 0.01;
  rows.push({
    label: 'Cash',
    value: sys === 0 && !counted ? 'none' : !counted ? 'not counted' : matches ? 'counted ✓' : 'mismatch',
    state: sys === 0 || (counted && matches) ? 'ok' : 'bad',
  });
  return rows;
}

function DailyStatusCard() {
  const [day, setDay] = useState(klYesterday());
  const [s, setS] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('clerk_daily_summary', { p_day: day });
    setS((data ?? null) as DailySummary);
    setLoading(false);
  }, [day]);
  useEffect(() => { load(); }, [load]);

  const shiftDay = (delta: number) => {
    const [y, m, d] = day.split('-').map(Number);
    setDay(new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10));
  };

  const rows = s && !s.error ? dailyRows(s) : [];
  const hasBad = rows.some((r) => r.state === 'bad');
  const hasKiv = rows.some((r) => r.state === 'kiv');

  return (
    <div className="rounded-card bg-card shadow-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ink-2"><Icon name="calendar" size={22} /></span>
        <h2 className="text-lg font-semibold text-ink">Daily</h2>
        {hasBad ? <span className="h-2 w-2 rounded-full bg-bad" title="Has backlog" />
          : hasKiv ? <span className="h-2 w-2 rounded-full bg-warn" title="Items in KIV" /> : null}
        <Link href="/office/daily" className="ml-auto text-xs font-medium text-accent hover:underline">Open →</Link>
      </div>
      <div className="mb-3 flex items-center justify-center gap-3">
        <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="rounded-md border border-line px-2.5 py-1 text-sm hover:bg-ink/5">◀</button>
        <span className="min-w-[72px] text-center text-sm font-semibold text-ink-2">{fmtDMY(day)}</span>
        <button onClick={() => shiftDay(1)} disabled={day >= klToday()} aria-label="Next day" className="rounded-md border border-line px-2.5 py-1 text-sm hover:bg-ink/5 disabled:opacity-40">▶</button>
      </div>
      {loading || !s ? (
        <div className="py-2 text-center text-sm text-ink-3">Loading…</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => {
            const dot = r.state === 'bad' ? 'bg-bad' : r.state === 'kiv' ? 'bg-warn' : 'bg-good';
            const txt = r.state === 'bad' ? 'text-bad' : r.state === 'kiv' ? 'text-warn' : 'text-good';
            return (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                <span className="text-ink-2">{r.label}</span>
                <span className={`ml-auto font-medium ${txt}`}>{r.value}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
  const onOrder = d.po_on_order?.length || 0;
  const weeklySummary = d.po_pending > 0
    ? (d.po_pending === 1 && d.po_list?.[0]
        ? `Send PO to ${d.po_list[0].supplier} (${d.po_list[0].n_items} item${d.po_list[0].n_items === 1 ? '' : 's'})`
        : `${d.po_pending} purchase orders ready · before Wed`)
    : onOrder > 0 ? `${onOrder} PO${onOrder === 1 ? '' : 's'} awaiting delivery` : 'Purchase orders · Mon–Tue';
  return (
    <OfficeShell title="Office" onRefresh={reload}>
      <p className="mb-2 text-sm text-ink-2"><span className="text-bad">Red</span> needs doing, <span className="text-good">green</span> is done. Use the arrows to change the day.</p>
      <div className="space-y-3">
        <DailyStatusCard />
        <BigCard href="/office/weekly" icon="clipboard" title="Weekly" alert={weeklyAlert} summary={weeklySummary} />
        <MonthlyStatusCard d={d} />
      </div>
    </OfficeShell>
  );
}

// Month-end at a glance: what's SETTLED (green) vs PENDING (red) for the current month.
function MonthlyStatusCard({ d }: { d: Home }) {
  const e = d.eom;
  const ticks = e.ticks || {};
  const rows: DRow[] = [
    { label: 'Pay suppliers', state: (ticks.suppliers_paid || e.suppliers_owed === 0) ? 'ok' : 'bad',
      value: ticks.suppliers_paid ? 'paid ✓' : e.suppliers_owed > 0 ? `${e.suppliers_owed} owed` : 'none owed' },
    { label: 'Fix MC / off-days', state: (ticks.fix_absent || e.absents === 0) ? 'ok' : 'bad',
      value: ticks.fix_absent ? 'done ✓' : e.absents > 0 ? `${e.absents} absent` : 'none' },
    { label: 'Payroll', state: ticks.payroll ? 'ok' : 'bad',
      value: ticks.payroll ? 'done ✓' : 'pending' },
    { label: 'Bills', state: e.bills_unpaid > 0 ? 'bad' : 'ok',
      value: e.bills_total === 0 ? 'none' : e.bills_unpaid > 0 ? `${e.bills_unpaid} unpaid` : 'all paid ✓' },
  ];
  const hasBad = rows.some((r) => r.state === 'bad');
  return (
    <div className="rounded-card bg-card shadow-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ink-2"><Icon name="calendar" size={22} /></span>
        <h2 className="text-lg font-semibold text-ink">Monthly</h2>
        {hasBad ? <span className="h-2 w-2 rounded-full bg-bad" title="Pending items" />
          : <span className="h-2 w-2 rounded-full bg-good" title="All settled" />}
        <Link href="/month-end" className="ml-auto text-xs font-medium text-accent hover:underline">Open →</Link>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const dot = r.state === 'bad' ? 'bg-bad' : 'bg-good';
          const txt = r.state === 'bad' ? 'text-bad' : 'text-good';
          return (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span className="text-ink-2">{r.label}</span>
              <span className={`ml-auto font-medium ${txt}`}>{r.value}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
