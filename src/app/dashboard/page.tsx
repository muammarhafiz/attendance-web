'use client';
// Owner dashboard — the at-a-glance landing for owners. One owner_dashboard() RPC feeds every card.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Dash = {
  error?: string;
  today: string;
  attendance: { present: number; late: number; off: number; absent: number; not_in_yet: number; total: number; not_in_yet_names?: string[]; absent_names?: string[] };
  workshop: { in_shop: number; done_today: number; over_2_days: number; waiting_parts: number };
  sales: { today: number; today_invoices: number; mtd: number; series: { day: string; sales: number }[] };
  pnl: { net: number; profit: number; payroll: number; employer: number; bills: number; meals: number };
  attention: { requests: number; pinv: number; po: number; debt_count: number; debt_amount: number; lowstock: number };
  payables: { total: number; count: number; synced: string | null; top: { name: string; balance: number }[] };
};

const rm = (n: number) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rm2 = (n: number) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
// Drop the trailing SSM registration ("… (202001027469 (1383789-X))") for a clean supplier name.
const cleanSupplier = (name: string) => name.replace(/\s*\(\d{6,}.*$/, '').trim() || name;

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
  <div className="flex items-center justify-between gap-3 py-1 text-sm">
    <span className="min-w-0 truncate text-slate-600" title={k}>{k}</span>
    <span className={`shrink-0 ${
      tone === 'warn' ? 'rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'
      : tone === 'bad' ? 'rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700'
      : tone === 'ok' ? 'rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700'
      : 'font-semibold text-slate-900'
    }`}>{v}</span>
  </div>
);

// Interactive 14-day sales trend: the big figure + date follow whichever bar you tap/hover.
function SalesTrend({ series, mtd, today }: { series: { day: string; sales: number }[]; mtd: number; today: number }) {
  const [sel, setSel] = useState<number | null>(null);
  if (!series.length) return <div className="text-sm text-slate-400">No sales data yet.</div>;
  const max = Math.max(1, ...series.map((x) => x.sales));
  const i = sel ?? series.length - 1;
  const cur = series[Math.min(i, series.length - 1)];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xl font-semibold text-slate-900">{rm(cur.sales)}</span>
        <span className="text-xs font-medium text-slate-500">{fmtDay(cur.day)}</span>
      </div>
      <div className="flex h-20 items-end gap-[3px]">
        {series.map((x, idx) => (
          <button
            key={x.day}
            type="button"
            onMouseEnter={() => setSel(idx)}
            onMouseLeave={() => setSel(null)}
            onFocus={() => setSel(idx)}
            onClick={() => setSel(idx)}
            aria-label={`${fmtDay(x.day)}: ${rm(x.sales)}`}
            className={`flex-1 rounded-t transition-colors ${idx === i ? 'bg-sky-500' : 'bg-sky-200 hover:bg-sky-300'}`}
            style={{ height: `${Math.max(4, Math.round((x.sales / max) * 100))}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{fmtDay(series[0].day)}</span>
        <span>{fmtDay(series[series.length - 1].day)}</span>
      </div>
      <div className="mt-2 border-t border-slate-100 pt-2">
        <Row k="Today" v={rm(today)} />
        <Row k="This month" v={rm(mtd)} />
      </div>
      <p className="mt-1 text-[10px] text-slate-400">Tap a bar to see that day’s sales.</p>
    </div>
  );
}

type UnpaidRow = { sale_id: string; inv: string; customer: string | null; balance: number | string; status?: string | null; age_days?: number | null };
type OwnerUnpaid = { error?: string; active_count: number; active_total: number | string; active: UnpaidRow[]; ignored: { sale_id: string; inv: string; customer: string | null; balance: number | string }[] };
const ageC = (n?: number | null) => (n == null ? 'text-slate-400' : n >= 60 ? 'text-rose-600' : n >= 30 ? 'text-amber-600' : 'text-slate-400');

// Owner-only Chase-unpaid monitor: watch the clerk's chasing + ignore won't-collect bills.
function ChaseUnpaidCard() {
  const [u, setU] = useState<OwnerUnpaid | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.rpc('owner_unpaid'); setU((data ?? null) as OwnerUnpaid); }, []);
  useEffect(() => { load(); }, [load]);
  const setIgnore = async (saleId: string, ignored: boolean) => {
    setBusy(true);
    await supabase.rpc('owner_ignore_unpaid', { p_sale_id: saleId, p_ignored: ignored });
    await load();
    setBusy(false);
  };
  const nPartial = u ? u.active.filter((r) => r.status === 'partial').length : 0;
  const nUnpaid = u ? u.active.length - nPartial : 0;
  return (
    <Card title="Unpaid & partial bills" icon="📞">
      {!u || u.error ? <div className="text-sm text-slate-400">—</div> : (
        <>
          <div className="mb-2 text-sm text-slate-600">Owed <span className="font-semibold text-slate-900">{rm2(Number(u.active_total))}</span> · {nUnpaid} unpaid · {nPartial} partial</div>
          {u.active.length === 0 ? <div className="text-sm text-emerald-700">Nothing to chase ✓</div> : (
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
              {u.active.map((r) => (
                <div key={r.sale_id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate text-slate-700">{r.customer || '—'}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-slate-400">{r.inv}</span>
                      <span className={ageC(r.age_days)}>{r.age_days == null ? '—' : `${r.age_days}d`}</span>
                      {r.status === 'partial' && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">partial</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-medium text-slate-800">{rm2(Number(r.balance))}</span>
                    <button onClick={() => setIgnore(r.sale_id, true)} disabled={busy} title="Ignore — stop chasing this bill" className="text-slate-300 hover:text-rose-500 disabled:opacity-40">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {u.ignored.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowIgnored((v) => !v)} className="text-xs text-slate-400 hover:text-slate-700">{showIgnored ? 'Hide' : 'Show'} {u.ignored.length} ignored</button>
              {showIgnored && (
                <div className="mt-1 space-y-0.5">
                  {u.ignored.map((r) => (
                    <div key={r.sale_id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                      <span className="min-w-0 truncate line-through">{r.customer || r.inv} · {r.inv}</span>
                      <button onClick={() => setIgnore(r.sale_id, false)} disabled={busy} className="shrink-0 text-blue-600 hover:underline">restore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-[10px] text-slate-400">Ignore = stop chasing (won&rsquo;t collect); it drops off the clerk&rsquo;s list.</p>
        </>
      )}
    </Card>
  );
}

type MethodStat = { total: number; checked: number };
type ClerkStatus = { error?: string; day: string | null; methods: Record<string, MethodStat>; cash_system: number | string; cash_counted: number | string | null; pi_pending: number; zero_cogs: number };
const CLERK_METHODS: { key: string; label: string }[] = [{ key: 'transfer', label: 'Transfer' }, { key: 'qr', label: 'QR' }, { key: 'card', label: 'Card' }];
const klYesterdayIso = () => new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const klTodayIso = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const fmtDMY = (iso: string) => { const [y, m, dd] = iso.split('-'); return `${Number(dd)}/${Number(m)}/${y.slice(2)}`; };

// Owner monitor of the clerk's daily work — pick a day.
function ClerkStatusCard() {
  const [day, setDay] = useState(klYesterdayIso());
  const [s, setS] = useState<ClerkStatus | null>(null);
  useEffect(() => { (async () => { const { data } = await supabase.rpc('owner_clerk_status', { p_day: day }); setS((data ?? null) as ClerkStatus); })(); }, [day]);
  const shiftDay = (delta: number) => { const [y, m, dd] = day.split('-').map(Number); setDay(new Date(Date.UTC(y, m - 1, dd + delta)).toISOString().slice(0, 10)); };
  const counted = s && s.cash_counted != null;
  const cashDiff = counted ? Number(s!.cash_counted) - Number(s!.cash_system) : 0;
  const cashMatches = counted && Math.abs(cashDiff) < 0.01;
  return (
    <Card title="Clerk" icon="🧑‍💼" href="/office">
      <div className="mb-2 flex items-center justify-center gap-3">
        <button onClick={() => shiftDay(-1)} aria-label="Previous day" className="rounded-md border border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50">◀</button>
        <span className="min-w-[80px] text-center text-sm font-semibold text-slate-800">{fmtDMY(day)}</span>
        <button onClick={() => shiftDay(1)} disabled={day >= klTodayIso()} aria-label="Next day" className="rounded-md border border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50 disabled:opacity-40">▶</button>
      </div>
      {!s || s.error ? <div className="text-sm text-slate-400">—</div> : (
        <>
          {CLERK_METHODS.map((m) => {
            const ms = s.methods?.[m.key] ?? { total: 0, checked: 0 };
            const done = ms.total > 0 && ms.checked === ms.total;
            return <Row key={m.key} k={m.label} v={ms.total === 0 ? 'none' : `${ms.checked}/${ms.total}`} tone={ms.total === 0 ? undefined : (done ? 'ok' : 'warn')} />;
          })}
          <Row k="Cash" v={counted ? (cashMatches ? 'matches ✓' : `${cashDiff > 0 ? 'over' : 'short'} ${rm2(Math.abs(cashDiff))}`) : 'not counted'} tone={counted ? (cashMatches ? 'ok' : 'bad') : 'warn'} />
          <Row k="Purchase invoices to check" v={s.pi_pending} tone={s.pi_pending > 0 ? 'warn' : 'ok'} />
          <Row k="COGS no cost" v={s.zero_cogs} tone={s.zero_cogs > 0 ? 'warn' : 'ok'} />
        </>
      )}
    </Card>
  );
}

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
          {d.attendance.absent_names && d.attendance.absent_names.length > 0 && (
            <div className="-mt-0.5 pb-1 text-xs leading-relaxed text-rose-600">{d.attendance.absent_names.join(', ')}</div>
          )}
          {d.attendance.not_in_yet > 0 && <Row k="Not clocked in yet" v={d.attendance.not_in_yet} tone="warn" />}
          {d.attendance.not_in_yet_names && d.attendance.not_in_yet_names.length > 0 && (
            <div className="-mt-0.5 pb-1 text-xs leading-relaxed text-slate-500">{d.attendance.not_in_yet_names.join(', ')}</div>
          )}
        </Card>

        {/* Workshop */}
        <Card title="Workshop" icon="🔧" href="/workshop">
          <Row k="In shop now" v={d.workshop.in_shop} />
          <Row k="Done today" v={d.workshop.done_today} tone="ok" />
          <Row k="In shop over 2 days" v={d.workshop.over_2_days} tone={d.workshop.over_2_days > 0 ? 'warn' : undefined} />
          {d.workshop.waiting_parts > 0 && <Row k="Waiting for parts" v={d.workshop.waiting_parts} />}
        </Card>

        {/* Sales trend */}
        <Card title="Sales trend · 14 days" icon="📈" href="/niagawan/sales">
          <SalesTrend series={d.sales.series} mtd={d.sales.mtd} today={d.sales.today} />
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
                <Row key={s.name} k={cleanSupplier(s.name)} v={rm2(s.balance)} />
              ))}
            </>
          ) : d.payables.synced ? (
            <div className="text-sm text-emerald-700">All suppliers paid up ✓</div>
          ) : (
            <div className="text-sm text-slate-400">Supplier balances haven’t synced yet — this fills in after the next supplier sync.</div>
          )}
        </Card>

        {/* Clerk monitor */}
        <ClerkStatusCard />

        {/* Chase unpaid (owner monitor + ignore) */}
        <ChaseUnpaidCard />
      </div>
    </div>
  );
}
