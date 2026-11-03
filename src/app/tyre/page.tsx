'use client';
// Staff tyre page — the same finder as the Workshop → Tyre tab, on its own route so a staff with
// only the 'tyre' permission (not full 'workshop') can reach just this. Gated tyre OR workshop.
// Owners also get a "Sales & profit" tab (TyreTracker) — tyre-service sales/profit + booked-wrong list.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import TyreFinder from '@/components/workshop/TyreFinder';
import TyreTracker from '@/components/tyre/TyreTracker';

export default function TyrePage() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<'quote' | 'sales'>('quote');

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setOk(false); return; }
      const { data } = await supabase.rpc('my_access');
      const a = (data ?? {}) as Record<string, boolean>;
      setOk(!!a.tyre || !!a.workshop);
      setIsAdmin(!!a.owner);
    })();
  }, []);

  if (ok === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!ok) return <div className="p-6 text-sm text-ink-2">You don&apos;t have access to the tyre page.</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Tyre</h1>
        {isAdmin && <a href="/tyres-admin" className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-ink/5">⚙️ Manage tyres</a>}
        <a href="/tayar" target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">Open customer page ↗</a>
      </div>

      {isAdmin && (
        <div className="mb-4 inline-flex rounded-lg border border-line bg-card p-0.5 text-sm">
          <button
            onClick={() => setTab('quote')}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === 'quote' ? 'bg-ink/10 text-ink' : 'text-ink-2 hover:text-ink'}`}
          >Quote</button>
          <button
            onClick={() => setTab('sales')}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === 'sales' ? 'bg-ink/10 text-ink' : 'text-ink-2 hover:text-ink'}`}
          >Sales &amp; profit</button>
        </div>
      )}

      {(!isAdmin || tab === 'quote') ? <TyreFinder /> : <TyreTracker />}
    </div>
  );
}
