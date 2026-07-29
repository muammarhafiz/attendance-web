// src/app/niagawan/layout.tsx
import React from 'react';

// The Sales / COGS / Inventory / Purchase / KIV / P&L tabs now live in the sidebar
// (Niagawan expandable area), so this layout is just the area heading + the page.
export default function NiagawanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Niagawan</h1>
      <p className="mb-5 mt-1 text-sm text-ink-2">Workshop sales, cost &amp; stock — synced from Niagawan</p>
      {children}
    </div>
  );
}
