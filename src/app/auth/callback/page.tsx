'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Signing you in...');

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          setStatus(`Error: ${error.message}`);
          return;
        }
        if (data.session) {
          setStatus('Success! Redirecting...');
          // Clean up the URL (remove code & hash)
          const url = new URL(window.location.href);
          url.search = '';
          url.hash = '';
          window.history.replaceState({}, '', url.toString());
          // Redirect home
          window.location.replace('/');
        } else {
          setStatus('No session returned.');
        }
      } catch (e: any) {
        setStatus(`Exception: ${e.message}`);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h2>{status}</h2>
    </main>
  );
}