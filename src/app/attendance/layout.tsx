// src/app/attendance/layout.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/attendance/checkin', label: 'Check-in' },
  { href: '/attendance/today', label: 'Today' },
  { href: '/attendance/report', label: 'Report' },
  { href: '/attendance/offday', label: 'Off-day' },
  { href: '/attendance/leave', label: 'Off-day req' },
  { href: '/attendance/halfday-req', label: 'Half-day req' },
  { href: '/attendance/advance', label: 'Advance' },
  { href: '/attendance/mc', label: 'MC' },
];

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-900 no-print">Attendance</h1>
      <p className="mt-1 mb-4 text-sm text-gray-500 no-print">
        New attendance system (v2) — running in parallel. The old pages stay live until this is proven.
      </p>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-gray-200 no-print">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={`-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition ${
              active(t.href)
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}
