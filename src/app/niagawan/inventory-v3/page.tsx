// src/app/niagawan/inventory-v3/page.tsx
// Inventory v3 — a new inventory tracker built to the owner's weekly routine, step by step.
'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function InventoryV3Page() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        const { data: ok } = await supabase.rpc('is_admin');
        setIsAdmin(ok === true);
      } else setIsAdmin(false);
    })();
  }, []);

  if (isAdmin === null) return <div className="text-sm text-gray-500">Checking…</div>;
  if (!isAdmin) return <div className="text-sm text-gray-600">This page is for admins only.</div>;

  return (
    <div className="space-y-4">
      {/* PO CARD */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">PO CARD</h2>
      </div>
    </div>
  );
}
