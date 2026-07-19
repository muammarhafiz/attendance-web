// src/app/niagawan/layout.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/niagawan/sales', label: 'Sales' },
  { href: '/niagawan/cogs', label: 'COGS' },
  { href: '/niagawan/inventory', label: 'Inventory' },
  { href: '/niagawan/inventory-v2', label: 'Inventory v2' },
  { href: '/niagawan/inventory-v3', label: 'Inventory v3' },
  { href: '/niagawan/inventory-v4', label: 'Inventory v4' },
  { href: '/niagawan/purchase', label: 'Purchase Invoice' },
  { href: '/niagawan/kiv', label: 'KIV Invoices' },
  { href: '/niagawan/pnl', label: 'P&L' },
];

export default function NiagawanLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-900">Niagawan</h1>
      <p className="mt-1 mb-4 text-sm text-gray-500">Workshop sales, cost &amp; stock — synced from Niagawan</p>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
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
