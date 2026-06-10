// src/app/niagawan/kiv/layout.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SUBTABS = [
  { href: '/niagawan/kiv/sale-invoice', label: 'Sale Invoice' },
];

export default function KivLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {SUBTABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              active(t.href) ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
