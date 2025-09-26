'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

export default function AuthCallbackPage() {
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const hasParams =
        typeof window !== 'undefined' &&
        (window.location.search.includes('code=') ||
         window.location.hash.includes('access_token='));

      if (!hasParams) {
        window.location.replace('/login');
        return;
      }
      const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if (error) { setErr(error.message); return; }
      if (data.session) { window.location.replace('/'); return; }
      setErr('No session returned from provider.');
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>Signing you in…</h2>
      {err && <div style={{ marginTop: 12, color: '#b91c1c' }}>{err}</div>}
    </main>
  );
}