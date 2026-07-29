// src/app/niagawan/layout.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/niagawan/sales', label: 'Sales' },
  { href: '/niagawan/cogs', label: 'COGS' },
  { href: '/niagawan/inventory-v4', label: 'Inventory' },
  { href: '/niagawan/purchase', label: 'Purchase Invoice' },
  { href: '/niagawan/kiv', label: 'KIV Invoices' },
  { href: '/niagawan/pnl', label: 'P&L' },
];

export default function NiagawanLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Niagawan</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">Workshop sales, cost &amp; stock — synced from Niagawan</p>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
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
