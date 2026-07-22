'use client';
// Owner dashboard — the at-a-glance landing for owners. One owner_dashboard() RPC feeds every card.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Dash = {
  error?: string;
  today: string;
  attendance: { present: number; late: number; off: number; absent: number; not_in_yet: number; total: number };
  workshop: { in_shop: number; done_today: number; over_2_days: number; waiting_parts: number };
  sales: { today: number; today_invoices: number; mtd: number; series: { day: string; sales: number }[] };
  pnl: { net: number; profit: number; payroll: number; employer: number; bills: number; meals: number };
  attention: { requests: number; pinv: number; po: number; debt_count: number; debt_amount: number; lowstock: number };
  payables: { total: number; count: number; synced: string | null; top: { name: string; balance: number }[] };
};

const rm = (n: number) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rm2 = (n: number) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Kpi({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-slate-300">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Card({ title, icon, href, children }: { title: string; icon: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base leading-none">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {href && <Link href={href} className="ml-auto text-xs text-slate-400 hover:text-slate-700">Open →</Link>}
      </div>
      {children}
    </div>
  );
}

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' }) => (
  <div className="flex items-center justify-between py-1 text-sm">
    <span className="text-slate-600">{k}</span>
    <span className={
      tone === 'warn' ? 'rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'
      : tone === 'bad' ? 'rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700'
      : tone === 'ok' ? 'rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700'
      : 'font-semibold text-slate-900'
    }>{v}</span>
  </div>
);

export default function DashboardPage() {
  const [d, setD] = useState<Dash | null>(null);
  const [status, setStatus] = useState<'loading' | 'denied' | 'ready'>('loading');

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('owner_dashboard');
    const dd = (data ?? {}) as Dash;
    if (!data || dd.error) { setStatus('denied'); return; }
    setD(dd); setStatus('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  if (status === 'loading') return <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-400">Loading your shop…</div>;
  if (status === 'denied' || !d) return <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-600">This dashboard is for owners.</div>;

  const dateLabel = new Date(d.today + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' });
  const maxSales = Math.max(1, ...d.sales.series.map((x) => x.sales));

  return (
    <div className="mx-auto max-w-6xl px-4 py-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
        <button onClick={load} className="text-xs text-slate-400 hover:text-slate-700">{dateLabel} · refresh</button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Sales today" value={rm(d.sales.today)} sub={`${d.sales.today_invoices} invoices`} href="/niagawan/sales" />
        <Kpi label="Cars in shop" value={String(d.workshop.in_shop)} sub={`${d.workshop.done_today} done today`} href="/workshop" />
        <Kpi label="Staff present" value={`${d.attendance.present} / ${d.attendance.total}`} sub={d.attendance.late > 0 ? `${d.attendance.late} late` : 'all on time'} href="/attendance/today" />
        <Kpi label="Net this month" value={rm(d.pnl.net)} sub={`sales ${rm(d.sales.mtd)}`} href="/niagawan/pnl" />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Attendance */}
        <Card title="Attendance" icon="🧑‍🔧" href="/attendance/today">
          <Row k="Present" v={d.attendance.present} tone="ok" />
          <Row k="Late" v={d.attendance.late} tone={d.attendance.late > 0 ? 'warn' : undefined} />
          <Row k="Off / leave / MC" v={d.attendance.off} />
          <Row k="Absent" v={d.attendance.absent} tone={d.attendance.absent > 0 ? 'bad' : undefined} />
          {d.attendance.not_in_yet > 0 && <Row k="Not clocked in yet" v={d.attendance.not_in_yet} />}
        </Card>

        {/* Workshop */}
        <Card title="Workshop" icon="🔧" href="/workshop">
          <Row k="In shop now" v={d.workshop.in_shop} />
          <Row k="Done today" v={d.workshop.done_today} tone="ok" />
          <Row k="In shop over 2 days" v={d.workshop.over_2_days} tone={d.workshop.over_2_days > 0 ? 'warn' : undefined} />
          {d.workshop.waiting_parts > 0 && <Row k="Waiting for parts" v={d.workshop.waiting_parts} />}
        </Card>

        {/* Sales trend */}
        <Card title="Sales trend" icon="📈" href="/niagawan/sales">
          <div className="flex h-16 items-end gap-1">
            {d.sales.series.map((x) => (
              <div key={x.day} title={`${x.day}: ${rm(x.sales)}`} className="flex-1 rounded-t bg-sky-400/80"
                   style={{ height: `${Math.max(3, Math.round((x.sales / maxSales) * 100))}%` }} />
            ))}
          </div>
          <div className="mt-2">
            <Row k="This month" v={rm(d.sales.mtd)} />
            <Row k="Today" v={rm(d.sales.today)} />
          </div>
        </Card>

        {/* Needs attention */}
        <Card title="Needs attention" icon="🔔">
          <Link href="/attendance/checkin" className="block hover:opacity-80"><Row k="Requests to approve" v={d.attention.requests} tone={d.attention.requests > 0 ? 'warn' : undefined} /></Link>
          <Link href="/niagawan/purchase" className="block hover:opacity-80"><Row k="Purchase invoices to review" v={d.attention.pinv} tone={d.attention.pinv > 0 ? 'warn' : undefined} /></Link>
          <Link href="/niagawan/inventory-v4" className="block hover:opacity-80"><Row k="Purchase orders to approve" v={d.attention.po} tone={d.attention.po > 0 ? 'warn' : undefined} /></Link>
          <Link href="/workshop" className="block hover:opacity-80"><Row k="Overdue bills" v={d.attention.debt_count > 0 ? `${d.attention.debt_count} · ${rm(d.attention.debt_amount)}` : 0} tone={d.attention.debt_count > 0 ? 'bad' : undefined} /></Link>
          <Link href="/niagawan/inventory-v4" className="block hover:opacity-80"><Row k="Items to restock" v={d.attention.lowstock} tone={d.attention.lowstock > 0 ? 'bad' : undefined} /></Link>
        </Card>

        {/* Supplier payments due */}
        <Card title="Supplier payments due" icon="🧾">
          {d.payables.count > 0 ? (
            <>
              <div className="mb-2 text-sm text-slate-600">You owe <span className="font-semibold text-slate-900">{rm2(d.payables.total)}</span> across {d.payables.count} supplier{d.payables.count !== 1 ? 's' : ''}</div>
              {d.payables.top.map((s) => (
                <Row key={s.name} k={s.name} v={rm2(s.balance)} />
              ))}
            </>
          ) : d.payables.synced ? (
            <div className="text-sm text-emerald-700">All suppliers paid up ✓</div>
          ) : (
            <div className="text-sm text-slate-400">Supplier balances haven’t synced yet — this fills in after the next supplier sync.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
