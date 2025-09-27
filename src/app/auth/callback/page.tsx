'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/** Handles Google OAuth + Magic Links robustly */
export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Signing you in…');

  useEffect(() => {
    (async () => {
      try {
        // Already signed in?
        const s0 = await supabase.auth.getSession();
        if (s0.data.session) return goHome();

        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type');

        // Magic link flow
        if (tokenHash && type) {
          const { data, error } = await supabase.auth.verifyOtp({
            type: type as any,
            token_hash: tokenHash,
          });
          if (data?.session) return goHome();
          if (error) return setStatus('Error (magic link): ' + error.message);
        }

        // OAuth / PKCE flow
        const ex = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (ex.data?.session) return goHome();

        // Some browsers set the session despite ?error=… on URL
        const s1 = await supabase.auth.getSession();
        if (s1.data.session) return goHome();

        setStatus('Sign-in failed: ' + (ex.error?.message || 'no session returned'));
      } catch (e) {
        setStatus('Exception: ' + (e instanceof Error ? e.message : String(e)));
      }
    })();

    function goHome() {
      const clean = new URL(window.location.href);
      clean.search = ''; clean.hash = '';
      window.history.replaceState({}, '', clean.toString());
      window.location.replace('/');
    }
  }, []);

  return <main style={{padding:24,fontFamily:'system-ui'}}><h2>{status}</h2></main>;
}