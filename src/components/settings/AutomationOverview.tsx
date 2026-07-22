'use client';
// Read-only map of EVERYTHING that runs by itself: Supabase cron (live), the NAS
// configurable tasks, the NAS background pollers, DB triggers, and in-app refreshers.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type CronJob = { jobname: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null };
type Task = { key: string; label: string; enabled: boolean; schedule: Record<string, unknown> };

const CRON_META: Record<string, { title: string; desc: string }> = {
  'push-dispatch': { title: 'Phone push notifications', desc: 'Checks the notification bell for new alerts and pushes them to subscribed phones.' },
  'daily-customers-refresh': { title: 'Customer list refresh', desc: 'Pulls the latest Niagawan customer list overnight so name lookups stay current.' },
};

const TASK_TITLE: Record<string, string> = {
  nightly_sync: 'Nightly data sync',
  hourly_sync: 'Hourly payment sync',
  auto_po: 'Auto-PO from sales',
  kiv_move: 'Move unpaid invoices (carry forward)',
  kiv_partial: 'Scan partial invoices',
};

const POLLERS = [
  { title: 'On-demand jobs', cadence: 'every ~20s', desc: 'Runs the buttons you tap — Update balances, Calculate average, refresh products/suppliers — as soon as they are queued.' },
  { title: 'Schedule checker', cadence: 'every ~60s', desc: 'Checks whether any of the configurable tasks above are due to run right now.' },
  { title: 'Approved-PO creator', cadence: 'every ~120s', desc: 'Creates any purchase order you approved into Niagawan and records its PO number.' },
  { title: 'Purchase-invoice pipeline', cadence: 'every ~120s', desc: 'Moves uploaded supplier invoices through extraction so they reach your review list.' },
  { title: 'Invoice “Billed?” re-check', cadence: 'every ~20s', desc: 'Re-runs the sales check on a purchase-invoice line whenever you ask it to.' },
];

const TRIGGERS = [
  { title: 'New staff request → you', cadence: 'instant', desc: 'When a staff member submits an off-day, half-day, advance or MC, you get an email (and a phone push) right away.' },
  { title: 'Customer pays → car moves to Done', cadence: 'instant', desc: 'When a sale invoice is marked paid in Niagawan, the matching workshop card moves itself to Done.' },
];

const INAPP = [
  { title: 'Notification bell', cadence: 'every 60s', desc: 'Refreshes the bell while a tab is open — pauses when the tab is hidden.' },
  { title: 'Workshop board', cadence: 'every 15s', desc: 'Keeps the job board fresh while you are watching it.' },
  { title: 'Attendance / Part arrived', cadence: 'every 30s', desc: 'Refreshes today’s attendance and the Part-Arrived queue.' },
  { title: 'Inventory', cadence: 'every 12s', desc: 'Refreshes stock and PO state while the inventory page is open.' },
];

function cronHuman(expr: string): string {
  if (expr === '* * * * *') return 'Every minute';
  const m = expr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) {
    const min = m[1].padStart(2, '0');
    const hUtc = Number(m[2]);
    const hMyt = String((hUtc + 8) % 24).padStart(2, '0');
    return `Daily ${String(hUtc).padStart(2, '0')}:${min} UTC · ${hMyt}:${min} Malaysia`;
  }
  return expr;
}

function relTime(iso: string | null): string {
  if (!iso) return 'no runs yet';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function taskCadence(t: Task): string {
  const s = (t.schedule || {}) as { period?: string; day?: string; time?: string; start?: string; end?: string };
  if (t.key === 'hourly_sync') return `Hourly ${s.start || '09:30'}–${s.end || '19:00'} (Mon–Sat)`;
  if (s.period === 'weekly') return `Weekly ${(s.day || 'monday')} ${s.time || ''}`.trim();
  if (s.time) return `Daily ${s.time}`;
  return 'Daily';
}

const Chip = ({ text }: { text: string }) => (
  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{text}</span>
);

const Card = ({ title, desc, cadence, children }: { title: string; desc: string; cadence: string; children?: React.ReactNode }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
      </div>
      <Chip text={cadence} />
    </div>
    {children}
  </div>
);

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <p className="mb-2 mt-0.5 text-xs text-gray-500">{subtitle}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function AutomationOverview() {
  const [cron, setCron] = useState<CronJob[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: t }] = await Promise.all([
      supabase.rpc('automation_cron_status'),
      supabase.from('automation_tasks').select('key,label,enabled,schedule'),
    ]);
    setCron(Array.isArray(c) ? (c as CronJob[]) : []);
    setTasks((t ?? []) as Task[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const taskOrder = ['nightly_sync', 'hourly_sync', 'auto_po', 'kiv_move', 'kiv_partial'];
  const orderedTasks = [...tasks].sort((a, b) => (taskOrder.indexOf(a.key) + 100) - (taskOrder.indexOf(b.key) + 100));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Automations</h2>
        <p className="mt-1 text-sm text-gray-500">
          Everything that runs by itself, and how often. This page is read-only — to turn the sync / PO tasks on or off or change
          their times, use the <span className="font-medium">Task schedules</span> tab.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          <Section title="Scheduled jobs (Supabase)" subtitle="Run on a fixed clock inside the database. Live status below.">
            {cron.length === 0 && <div className="text-xs text-gray-400">No scheduled jobs found.</div>}
            {cron.map((j) => {
              const meta = CRON_META[j.jobname];
              const ok = j.last_status === 'succeeded';
              return (
                <Card key={j.jobname} title={meta?.title ?? j.jobname} desc={meta?.desc ?? j.jobname} cadence={cronHuman(j.schedule)}>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-xs">
                    {!j.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-500">paused</span>}
                    <span className="text-gray-400">Last run {relTime(j.last_run)}</span>
                    {j.last_status && (
                      <span className={`rounded px-1.5 py-0.5 font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {ok ? '✓ ' : '⚠ '}{j.last_status}
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </Section>

          <Section title="Configurable tasks (NAS engine)" subtitle="You control these in the Automation tab — shown here for the full picture.">
            {orderedTasks.length === 0 && <div className="text-xs text-gray-400">No tasks configured.</div>}
            {orderedTasks.map((t) => (
              <Card key={t.key} title={TASK_TITLE[t.key] ?? t.label ?? t.key} desc="" cadence={t.enabled ? taskCadence(t) : 'off'}>
                {!t.enabled && <div className="mt-1 text-xs text-gray-400">Currently turned off.</div>}
              </Card>
            ))}
          </Section>

          <Section title="Background workers (NAS engine)" subtitle="Always-on loops on the shop’s scraper — they pick up work the moment it appears.">
            {POLLERS.map((p) => <Card key={p.title} title={p.title} desc={p.desc} cadence={p.cadence} />)}
          </Section>

          <Section title="Instant reactions (database triggers)" subtitle="No schedule — these fire the moment the event happens.">
            {TRIGGERS.map((p) => <Card key={p.title} title={p.title} desc={p.desc} cadence={p.cadence} />)}
          </Section>

          <Section title="In-app refresh" subtitle="Only while a page is open in your browser — nothing runs when every tab is closed.">
            {INAPP.map((p) => <Card key={p.title} title={p.title} desc={p.desc} cadence={p.cadence} />)}
          </Section>
        </>
      )}
    </div>
  );
}
