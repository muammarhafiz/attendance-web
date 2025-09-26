'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // If already signed in, go home
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = '/';
    });
  }, []);

  const signInWithGoogle = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin } // back to /
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