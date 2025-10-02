'use client';

import { FormEvent, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export const dynamic = 'force-dynamic';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string>('');

  async function signInWithGoogle() {
    try {
      setMsg('');
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) setMsg(error.message);
      // On success, Google redirects back to /auth/callback
    } catch (e: any) {
      setMsg(e?.message ?? 'Unknown error');
    }
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const emailRedirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo },
      });
      if (error) setMsg(error.message);
      else setMsg('Check your email for the sign-in link.');
    } catch (err: any) {
      setMsg(err?.message ?? 'Unknown error');
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 520, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 16 }}>Sign in</h2>

      <button
        onClick={signInWithGoogle}
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #ddd',
          background: '#fff',
          fontWeight: 600,
          marginBottom: 16,
          width: '100%',
        }}
      >
        Continue with Google
      </button>

      <div style={{ margin: '16px 0', color: '#999', fontSize: 13, textAlign: 'center' }}>
        — or —
      </div>

      <form onSubmit={onEmail} style={{ display: 'grid', gap: 8 }}>
        <label htmlFor="email" style={{ fontSize: 14 }}>Email (magic link)</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #ddd',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #0b6',
            background: '#0c7',
            color: 'white',
            fontWeight: 600,
          }}
        >
          Send magic link
        </button>
      </form>

      {msg && (
        <p style={{ marginTop: 12, color: msg.toLowerCase().includes('error') ? '#b00020' : '#333' }}>
          {msg}
        </p>
      )}
    </main>
  );
}