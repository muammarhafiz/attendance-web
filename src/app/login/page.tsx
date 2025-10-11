'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

export default function Login() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signInGoogle = async () => {
    setErr(null);
    setBusy(true);

    try {
      // Always send users back to our server callback, then home
      const callback = `${location.origin}/api/auth/callback?next=/`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callback,
          // helps when you have multiple Google accounts
          queryParams: { prompt: 'select_account' },
        },
      });

      if (error) {
        setErr(error.message);
        setBusy(false);
      }
      // On success, the browser will navigate away to Google,
      // then return to /api/auth/callback -> /
    } catch (e: any) {
      setErr(e?.message ?? 'Sign-in failed.');
      setBusy(false);
    }
  };

  // Fallback <a> link (in case some browsers block programmatic window navigation)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const fallbackAuthorizeUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(
    `${typeof window !== 'undefined' ? location.origin : ''}/api/auth/callback?next=/`
  )}`;

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 460 }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Sign in</h2>
      <p style={{ marginBottom: 16, color: '#555' }}>Only allow-listed staff can access.</p>

      <button
        onClick={signInGoogle}
        disabled={busy}
        style={{
          padding: 12,
          border: '1px solid #ccc',
          borderRadius: 8,
          cursor: busy ? 'default' : 'pointer',
          background: '#fff',
        }}
      >
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>

      <div style={{ marginTop: 12, fontSize: 12, color: '#777' }}>
        If clicking the button does nothing, try this{' '}
        <a href={fallbackAuthorizeUrl} style={{ color: '#2563eb', textDecoration: 'underline' }}>
          direct sign-in link
        </a>
        .
      </div>

      {err && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            border: '1px solid #fde68a',
            background: '#fffbeb',
            borderRadius: 8,
            color: '#92400e',
            fontSize: 14,
          }}
        >
          {err}
        </div>
      )}
    </main>
  );
}