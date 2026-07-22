'use client';
// Home. Owners are sent to their dashboard on landing; everyone else gets Check-in.
// (Owners reach Check-in via the /checkin nav link, which doesn't redirect.)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import CheckinV2 from '@/components/CheckinV2';

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.rpc('my_access');
      if (!alive) return;
      if (data && (data as { owner?: boolean }).owner) { router.replace('/dashboard'); return; }
      setReady(true);
    })();
    return () => { alive = false; };
  }, [router]);

  if (!ready) return <div className="py-8 text-center text-sm text-slate-400">Loading…</div>;
  return (
    <div className="py-2">
      <CheckinV2 />
    </div>
  );
}
