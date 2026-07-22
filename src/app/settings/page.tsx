// src/app/settings/page.tsx
'use client';

import { useEffect, useState } from 'react';
import AutomationSettings from '@/components/settings/AutomationSettings';
import PayrollItemsSettings from '@/components/settings/PayrollItemsSettings';
import AttendanceSettings from '@/components/settings/AttendanceSettings';
import WorkshopSettings from '@/components/settings/WorkshopSettings';
import EmailSettings from '@/components/settings/EmailSettings';
import NotificationsSettings from '@/components/settings/NotificationsSettings';
import AutomationOverview from '@/components/settings/AutomationOverview';

type TabKey = 'automation' | 'payroll' | 'attendance' | 'workshop' | 'email' | 'notifications' | 'system';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'system', label: 'Automations' },
  { key: 'automation', label: 'Task schedules' },
  { key: 'payroll', label: 'Payroll items' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'workshop', label: 'Workshop' },
  { key: 'email', label: 'Email' },
  { key: 'notifications', label: 'Notifications' },
];

// One place for every admin setting, with a sub nav bar switching between the panels.
// Each panel is the same shared component used by its section's own settings page.
export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('system');
  // Open the tab named in ?tab= — used by the old /niagawan|payroll|attendance/settings redirects.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'automation' || t === 'payroll' || t === 'attendance' || t === 'workshop' || t === 'email' || t === 'notifications' || t === 'system') setTab(t);
  }, []);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
      <p className="mt-1 mb-4 text-sm text-gray-500">Admin controls for how the system runs — automation, payroll &amp; attendance.</p>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'automation' && <AutomationSettings />}
      {tab === 'payroll' && <PayrollItemsSettings />}
      {tab === 'attendance' && <AttendanceSettings />}
      {tab === 'workshop' && <WorkshopSettings />}
      {tab === 'email' && <EmailSettings />}
      {tab === 'notifications' && <NotificationsSettings />}
      {tab === 'system' && <AutomationOverview />}
    </div>
  );
}
