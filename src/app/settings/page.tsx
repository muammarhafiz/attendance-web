// src/app/settings/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import AutomationSettings from '@/components/settings/AutomationSettings';
import PayrollItemsSettings from '@/components/settings/PayrollItemsSettings';
import AttendanceSettings from '@/components/settings/AttendanceSettings';
import WorkshopSettings from '@/components/settings/WorkshopSettings';
import EmailSettings from '@/components/settings/EmailSettings';
import NotificationsSettings from '@/components/settings/NotificationsSettings';
import AutomationOverview from '@/components/settings/AutomationOverview';
import AccessSettings from '@/components/settings/AccessSettings';

type TabKey = 'access' | 'system' | 'automation' | 'payroll' | 'attendance' | 'workshop' | 'email' | 'notifications';
type Tab = { key: TabKey; label: string; req: 'owner' | 'access_admin' };

// 'access' is open to Owner + Manager; everything else is Owner-only.
const ALL_TABS: Tab[] = [
  { key: 'access', label: 'Access', req: 'access_admin' },
  { key: 'system', label: 'Automations', req: 'owner' },
  { key: 'automation', label: 'Task schedules', req: 'owner' },
  { key: 'payroll', label: 'Payroll items', req: 'owner' },
  { key: 'attendance', label: 'Attendance', req: 'owner' },
  { key: 'workshop', label: 'Workshop', req: 'owner' },
  { key: 'email', label: 'Email', req: 'owner' },
  { key: 'notifications', label: 'Notifications', req: 'owner' },
];

const tabAllowed = (t: Tab, acc: Record<string, boolean>) =>
  t.req === 'access_admin' ? !!(acc.access_admin || acc.owner) : !!acc.owner;

export default function SettingsPage() {
  const [acc, setAcc] = useState<Record<string, boolean> | null>(null);
  const [tab, setTab] = useState<TabKey | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('my_access');
      setAcc((data ?? {}) as Record<string, boolean>);
    })();
  }, []);

  // Choose the active tab once we know the caller's access: honour ?tab= if visible, else first visible.
  useEffect(() => {
    if (!acc) return;
    const vis = ALL_TABS.filter((t) => tabAllowed(t, acc)).map((t) => t.key);
    const param = new URLSearchParams(window.location.search).get('tab') as TabKey | null;
    setTab((cur) => {
      if (cur && vis.includes(cur)) return cur;
      if (param && vis.includes(param)) return param;
      return vis[0] ?? null;
    });
  }, [acc]);

  if (acc === null) return <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-400">Checking…</div>;
  const visible = ALL_TABS.filter((t) => tabAllowed(t, acc));
  if (visible.length === 0) return <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-gray-600">You don&apos;t have access to Settings.</div>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
      <p className="mt-1 mb-4 text-sm text-gray-500">Admin controls for how the system runs.</p>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
        {visible.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition ${
              tab === t.key ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'access' && <AccessSettings />}
      {tab === 'system' && <AutomationOverview />}
      {tab === 'automation' && <AutomationSettings />}
      {tab === 'payroll' && <PayrollItemsSettings />}
      {tab === 'attendance' && <AttendanceSettings />}
      {tab === 'workshop' && <WorkshopSettings />}
      {tab === 'email' && <EmailSettings />}
      {tab === 'notifications' && <NotificationsSettings />}
    </div>
  );
}
