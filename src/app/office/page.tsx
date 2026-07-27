'use client';
// The clerk/admin home — three summary cards (Daily / Weekly / Monthly). Each opens its own page.
// Daily is a point-by-point breakdown with a date navigator: each task is red when it has a backlog,
// green when settled, for the picked day.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
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

type DailySummary = {
  error?: string;
  day: string;
  pi_pending: number;
  zero_cogs: number;
  methods: Record<string, { total: number; checked: number; label?: string | null }>;
  cash: { system: number | string; counted: number | string | null };
};
type DState = 'ok' | 'bad';
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
    return { label, value: `${st.checked}/${st.total} checked`, state: st.checked >= st.total ? 'ok' : 'bad' };
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
  const backlog = rows.some((r) => r.state === 'bad');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl leading-none">📅</span>
        <h2 className="text-lg font-semibold text-gray-900">Daily</h2>
        {backlog && <span className="h-2 w-2 rounded-full bg-rose-500" title="Has backlog" />}
        <Link href="/office/daily" className="ml-auto text-xs font-medium text-blue-600 hover:underline">Open →</Link>
      </div>
      <div className="mb-3 flex items-center justify-center gap-3">
        <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50">◀</button>
        <span className="min-w-[72px] text-center text-sm font-semibold text-gray-800">{fmtDMY(day)}</span>
        <button onClick={() => shiftDay(1)} disabled={day >= klToday()} aria-label="Next day" className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50 disabled:opacity-40">▶</button>
      </div>
      {loading || !s ? (
        <div className="py-2 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.state === 'bad' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
              <span className="text-gray-600">{r.label}</span>
              <span className={`ml-auto font-medium ${r.state === 'bad' ? 'text-rose-600' : 'text-emerald-600'}`}>{r.value}</span>
            </li>
          ))}
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
  const monthlyAlert = d.eom.done < d.eom.total;
  return (
    <OfficeShell title="🗂️ Office" onRefresh={reload}>
      <p className="mb-2 text-sm text-gray-500"><span className="text-rose-600">Red</span> needs doing, <span className="text-emerald-600">green</span> is done. Use the arrows to change the day.</p>
      <div className="space-y-3">
        <DailyStatusCard />
        <BigCard href="/office/weekly" icon="🗒️" title="Weekly" alert={weeklyAlert}
          summary={d.po_pending > 0 ? `${d.po_pending} to re-order · POs due before Wed` : 'Purchase orders · Mon–Tue'} />
        <BigCard href="/month-end" icon="🗓️" title="Monthly" alert={monthlyAlert}
          summary={`End of month · ${d.eom.done}/${d.eom.total} done`} />
      </div>
    </OfficeShell>
  );
}
