'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthPage() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');

  async function signInWithGoogle() {
    try {
      setBusy(true);
      setMsg('');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) setMsg(error.message);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMsg('Signed out.');
  }

  return (
    <main style={{ maxWidth: 520, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Sign in</h1>

      <p style={{ color: '#555', marginBottom: 16 }}>
        Use your Google account to sign in. You’ll be returned here after authentication.
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={signInWithGoogle}
          disabled={busy}
          style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff' }}
        >
          {busy ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <button
          onClick={signOut}
          style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #eee', background: '#fafafa' }}
        >
          Sign out
        </button>
      </div>

      {msg && <p style={{ marginTop: 16, color: '#b00020' }}>{msg}</p>}
    </main>
  );
}