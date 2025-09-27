'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';

type EnvInfo = { url?: string; ref?: string };

export default function DebugAuth() {
  const [env, setEnv] = useState<EnvInfo>({});
  const [session, setSession] = useState<Session | null>(null);
  const [storageKeys, setStorageKeys] = useState<string[]>([]);

  useEffect(() => {
    // show env (sanitized)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const ref = url.replace('https://', '').replace('.supabase.co', '');
    setEnv({ url, ref });

    // current session
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    // listen to changes
    const { data } = supabase.auth.onAuthStateChange(
      (_evt: AuthChangeEvent, s: Session | null) => setSession(s)
    );

    // localStorage keys
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-')) keys.push(k);
      }
      setStorageKeys(keys);
    } catch {
      // ignore if storage is blocked
    }

    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Auth Debug</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>
{JSON.stringify(
  {
    NEXT_PUBLIC_SUPABASE_URL: env.url,
    projectRef: env.ref,
    sessionUserEmail: session?.user?.email ?? null,
    hasSbAuthKey: storageKeys.length > 0,
    storageKeys,
  },
  null,
  2
)}
      </pre>
      <div style={{ marginTop: 12 }}>
        <a href="/login" style={{ textDecoration: 'underline' }}>Go to /login</a>
      </div>
    </main>
  );
}