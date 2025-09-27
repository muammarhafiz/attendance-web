'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// Supabase magic-link/token-hash flows use one of these types
type OtpLinkType = 'magiclink' | 'recovery' | 'invite' | 'email_change';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<string>('Signing you in…');

  useEffect(() => {
    (async () => {
      try {
        // If we already have a session, go home immediately.
        const s0 = await supabase.auth.getSession();
        if (s0.data.session) return goHome();

        const url = new URL(window.location.href);
        const params = url.searchParams;

        // --- 1) Handle magic-link style callbacks (token_hash + type) ---
        const tokenHash = params.get('token_hash');
        const typeParam = params.get('type');

        if (tokenHash && typeParam) {
          // Narrow to allowed link types (fallback to 'magiclink')
          const t: OtpLinkType = (['magiclink', 'recovery', 'invite', 'email_change'] as const)
            .includes(typeParam as OtpLinkType)
              ? (typeParam as OtpLinkType)
              : 'magiclink';

          const { data, error } = await supabase.auth.verifyOtp({
            type: t,
            token_hash: tokenHash,
          });

          if (data?.session) return goHome();
          if (error) {
            setStatus('Error (magic link): ' + error.message);
            return;
          }
        }

        // --- 2) Handle OAuth/PKCE style callbacks (Google) ---
        const ex = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (ex.data?.session) return goHome();

        // Some browsers may have set the session already but still append ?error=...
        const s1 = await supabase.auth.getSession();
        if (s1.data.session) return goHome();

        setStatus('Sign-in failed: ' + (ex.error?.message || 'no session returned'));
      } catch (e) {
        setStatus('Exception: ' + (e instanceof Error ? e.message : String(e)));
      }
    })();

    function goHome() {
      const clean = new URL(window.location.href);
      clean.search = '';
      clean.hash = '';
      window.history.replaceState({}, '', clean.toString());
      window.location.replace('/');
    }
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>{status}</h2>
    </main>
  );
}