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
      <h1 className="text-2xl font-semibold tracking-tight text-ink no-print">Attendance</h1>

      <div className="mb-6 mt-4 flex flex-wrap gap-1 border-b border-line no-print">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={`-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition ${
              active(t.href)
                ? 'border-b-2 border-accent text-ink'
                : 'text-ink-2 hover:text-ink'
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
