'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<string>('Signing you in…');

  useEffect(() => {
    (async () => {
      const { data, error } =
        await supabase.auth.exchangeCodeForSession(window.location.href);

      if (error) {
        setStatus(`Error: ${error.message}`);
        return;
      }
      if (data?.session) {
        setStatus('Success! Redirecting…');
        const url = new URL(window.location.href);
        url.search = ''; url.hash = '';
        window.history.replaceState({}, '', url.toString());
        window.location.replace('/');
      } else {
        setStatus('No session returned.');
      }
    })();
  }, []);

  return <main style={{ padding: 24, fontFamily: 'system-ui' }}><h2>{status}</h2></main>;
}