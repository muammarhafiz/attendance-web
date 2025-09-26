'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If already logged in, bounce to home
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace('/');
    });

    const { data } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) window.location.replace('/');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Supabase manages callback → after login it will redirect back to your site root
      options: { redirectTo: window.location.origin },
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