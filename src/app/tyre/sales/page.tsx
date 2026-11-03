'use client';
// Owner-only tyre Sales & profit page — the tracker on its own route (moved out of the /tyre finder).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import TyreTracker from '@/components/tyre/TyreTracker';

export default function TyreSalesPage() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setOk(false); return; }
      const { data } = await supabase.rpc('my_access');
      const a = (data ?? {}) as Record<string, boolean>;
      setOk(!!a.owner);
    })();
  }, []);

  if (ok === null) return <div className="p-6 text-sm text-ink-3">Checking…</div>;
  if (!ok) return <div className="p-6 text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Tyre &mdash; sales &amp; profit</h1>
        <a href="/tyre" className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-ink/5">&larr; Tyre quote</a>
      </div>
      <TyreTracker />
    </div>
  );
}
