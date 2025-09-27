'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<string>('Signing you in…');

  useEffect(() => {
    (async () => {
      try {
        // 1) If a session already exists, just go home.
        const s0 = await supabase.auth.getSession();
        if (s0.data.session) {
          redirectHome();
          return;
        }

        // 2) Try to exchange the code/hash for a session (covers OAuth + magic link)
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);

        if (data?.session) {
          redirectHome();
          return;
        }

        // 3) Sometimes providers attach ?error=… even though the session was set via a previous redirect.
        // Double-check again after a short tick.
        const s1 = await supabase.auth.getSession();
        if (s1.data.session) {
          redirectHome();
          return;
        }

        // 4) If we’re here, we truly don’t have a session.
        setStatus(`Error: ${error?.message || 'No session returned.'}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`Exception: ${msg}`);
      }
    })();

    function redirectHome() {
      // Clean query/hash then go home
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      window.history.replaceState({}, '', url.toString());
      window.location.replace('/');
    }
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>{status}</h2>
    </main>
  );
}