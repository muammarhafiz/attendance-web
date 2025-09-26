'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // 1) If session already present, go home
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        window.location.replace('/');
        return;
      }
      // 2) If returning from provider (?code=...), exchange for a session
      const hasOAuthParams =
        typeof window !== 'undefined' &&
        (window.location.search.includes('code=') ||
          window.location.hash.includes('access_token='));

      if (hasOAuthParams) {
        const { data: exData, error: exErr } =
          await supabase.auth.exchangeCodeForSession(window.location.href);
        if (!exErr && exData.session) {
          window.location.replace('/');
          return;
        }
        if (exErr) setErr(exErr.message);
      }
    });

    // 3) Also listen for auth state changes
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) window.location.replace('/');
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin } // send back to /
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
    }
  };

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>Sign in</h2>
      <p>Only allow-listed staff can access.</p>
      {err && <div style={{ color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <button
        onClick={signInWithGoogle}
        disabled={busy}
        style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}
      >
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>
    </main>
  );
}