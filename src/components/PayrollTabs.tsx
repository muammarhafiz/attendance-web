// src/components/PayrollTabs.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Sub-tabs for the payroll section (same pattern as the Niagawan tabs). The navbar shows a
// single "Payroll" entry; Records lives here instead of being a separate top-level item.
const TABS = [
  { href: '/payroll/v3', label: 'Payroll' },
  { href: '/payroll/records', label: 'Records' },
];

export default function PayrollTabs() {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <div className="no-print mb-4 flex flex-wrap gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          prefetch={false}
          className={`-mb-px rounded-t-md px-3 py-2 text-sm font-medium transition ${
            active(t.href) ? 'border-b-2 border-gray-900 text-gray-900' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
