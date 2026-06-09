'use client';
import Image from 'next/image';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function Login() {
  const [busy, setBusy] = useState(false);
  const signInGoogle = async () => {
    setBusy(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex justify-center">
          <Image src="/zordaq-auto.png" alt="ZORDAQ Auto Service" width={717} height={1174} priority className="h-24 w-auto" />
        </div>
        <h1 className="mt-5 text-center text-lg font-semibold text-slate-900">ZORDAQ Auto Service</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Staff access only — sign in with your work Google account.</p>

        <button
          onClick={signInGoogle}
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.1 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7C43.8 37.8 46.5 31.7 46.5 24.5z" />
            <path fill="#FBBC05" d="M10.5 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.9-6.1C1 16.1 0 19.9 0 24s1 7.9 2.6 11.4l7.9-7.1z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.3-8.5 2.3-6.3 0-11.6-3.6-13.5-8.8l-7.9 7.1C6.5 42.6 14.6 48 24 48z" />
          </svg>
          {busy ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <p className="mt-5 text-center text-xs text-slate-400">Only allow-listed staff can access this system.</p>
      </div>
    </div>
  );
}
