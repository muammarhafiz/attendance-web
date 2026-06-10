// src/app/niagawan/settings/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Schedule = { period?: 'daily' | 'weekly'; day?: string; time?: string; window_days?: number };
type Task = { key: string; label: string; enabled: boolean; schedule: Schedule };

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const META: Record<string, { title: string; desc: string; fields: Array<'period' | 'day' | 'time' | 'window'> }> = {
  nightly_sync: {
    title: 'Nightly data sync',
    desc: "Pulls sales, COGS and stock from Niagawan into the dashboard every night. The re-sync window also refreshes recent past days, so invoices that get carried forward (job delayed, no parts) stay accurate without manual fixing.",
    fields: ['time', 'window'],
  },
  auto_po: {
    title: 'Auto-PO from sales',
    desc: 'Drafts purchase orders for the items that sold (only the ones you ticked “Auto-PO” on the Inventory page), grouped by supplier, and posts them for your approval before anything is created in Niagawan.',
    fields: ['period', 'day', 'time'],
  },
  kiv_move: {
    title: 'Move unpaid sale invoices (carry forward)',
    desc: 'Every morning, any sale invoice from the previous working day that is still fully unpaid is marked delivered (dated the day the car came in) and moved to today (Monday picks up Saturday), so each day’s final sales/COGS shows only completed, paid work. Runs in the morning because Niagawan does not accept future invoice dates. Every move is listed on the KIV Invoices tab and emailed to you.',
    fields: ['time'],
  },
};

function summarise(t: Task): string {
  const s = t.schedule || {};
  const time = s.time || '—';
  if (t.key === 'nightly_sync') {
    const w = Number(s.window_days) || 0;
    const win = w >= 1 ? ` · re-syncs last ${w === 30 ? '1 month' : w + ' days'}` : ' · yesterday only';
    return `Runs daily at ${time}${win}`;
  }
  if (META[t.key]?.fields.includes('period') && s.period === 'weekly') {
    const d = (s.day || 'monday');
    return `Runs every ${d.charAt(0).toUpperCase() + d.slice(1)} at ${time}`;
  }
  if (s.period === 'daily' || !META[t.key]?.fields.includes('period')) return `Runs daily at ${time}`;
  return `Runs at ${time}`;
}

export default function NiagawanSettingsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('automation_tasks').select('key,label,enabled,schedule').order('key');
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const persist = useCallback(async (key: string, patch: Partial<Task>) => {
    setTasks((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));
    const t = tasks.find((x) => x.key === key);
    const next = { ...t, ...patch } as Task;
    await supabase.from('automation_tasks').update({ enabled: next.enabled, schedule: next.schedule, updated_at: new Date().toISOString() }).eq('key', key);
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
  }, [tasks]);

  const setSchedule = useCallback((key: string, sp: Partial<Schedule>) => {
    const t = tasks.find((x) => x.key === key);
    persist(key, { schedule: { ...(t?.schedule || {}), ...sp } });
  }, [tasks, persist]);

  const ordered = useMemo(() => {
    const order = ['nightly_sync', 'auto_po', 'kiv_move'];
    return [...tasks].sort((a, b) => (order.indexOf(a.key) + 100) - (order.indexOf(b.key) + 100) || a.key.localeCompare(b.key));
  }, [tasks]);

  if (authed === null || isAdmin === null) return <div className="text-sm text-gray-500">Checking session…</div>;
  if (authed === false) return <div className="text-sm text-gray-600">Please sign in to view this page.</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Automation</h2>
        <p className="mt-1 text-xs text-gray-500">
          Control the tasks that run by themselves. Turn each on/off and set when it runs. The scheduled engine on the
          NAS reads these settings — changes you make here drive what it does.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="space-y-4">
          {ordered.map((t) => {
            const meta = META[t.key] || { title: t.label, desc: '', fields: [] as Array<'period' | 'day' | 'time'> };
            const weekly = t.schedule?.period === 'weekly';
            return (
              <div key={t.key} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{meta.title}</h3>
                      {savedKey === t.key && <span className="text-[10px] font-medium text-emerald-600">saved ✓</span>}
                    </div>
                    <p className="mt-1 max-w-2xl text-xs text-gray-500">{meta.desc}</p>
                  </div>
                  {/* on/off switch */}
                  <button
                    role="switch"
                    aria-checked={t.enabled}
                    onClick={() => persist(t.key, { enabled: !t.enabled })}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${t.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${t.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {t.enabled && (
                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
                    {meta.fields.includes('period') && (
                      <label className="text-xs text-gray-600">
                        How often
                        <select
                          value={t.schedule?.period || 'weekly'}
                          onChange={(e) => setSchedule(t.key, { period: e.target.value as 'daily' | 'weekly' })}
                          className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="daily">Daily (yesterday&rsquo;s sales)</option>
                          <option value="weekly">Weekly (last week&rsquo;s sales)</option>
                        </select>
                      </label>
                    )}
                    {meta.fields.includes('day') && weekly && (
                      <label className="text-xs text-gray-600">
                        On day
                        <select
                          value={t.schedule?.day || 'monday'}
                          onChange={(e) => setSchedule(t.key, { day: e.target.value })}
                          className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm capitalize"
                        >
                          {DAYS.map((d) => <option key={d} value={d} className="capitalize">{d}</option>)}
                        </select>
                      </label>
                    )}
                    {meta.fields.includes('time') && (
                      <label className="text-xs text-gray-600">
                        At time
                        <input
                          type="time"
                          value={t.schedule?.time || '08:00'}
                          onChange={(e) => setSchedule(t.key, { time: e.target.value })}
                          className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    )}
                    {meta.fields.includes('window') && (
                      <label className="text-xs text-gray-600">
                        Re-sync window
                        <select
                          value={String(t.schedule?.window_days ?? 0)}
                          onChange={(e) => setSchedule(t.key, { window_days: Number(e.target.value) })}
                          className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="0">Auto — yesterday only</option>
                          <option value="7">Last 7 days</option>
                          <option value="14">Last 14 days</option>
                          <option value="30">Last 1 month</option>
                        </select>
                      </label>
                    )}
                    <div className="ml-auto text-xs font-medium text-gray-400">{summarise(t)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        The NAS automation engine reads these settings on its next run — changes take effect from the next scheduled time.
      </p>
    </div>
  );
}
