'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

type Sess = { user?: { email?: string } } | null;

export default function DebugAuth() {
  const [env, setEnv] = useState<{ url?: string; ref?: string }>();
  const [session, setSession] = useState<Sess>(null);
  const [storageKeys, setStorageKeys] = useState<string[]>([]);

  useEffect(() => {
    // show env (sanitized)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const ref = url.replace('https://', '').replace('.supabase.co', '');
    setEnv({ url, ref });

    // current session
    supabase.auth.getSession().then(({ data }) => setSession(data.session as any));

    // listen to changes
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession((s as any) ?? null);
    });

    // localStorage keys
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith('sb-')) keys.push(k);
      }
      setStorageKeys(keys);
    } catch {}

    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Auth Debug</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>
{JSON.stringify(
  {
    NEXT_PUBLIC_SUPABASE_URL: env?.url,
    projectRef: env?.ref,
    sessionUserEmail: session?.user?.email ?? null,
    hasSbAuthKey: storageKeys.length > 0,
    storageKeys,
  },
  null,
  2
)}
      </pre>
      <a href="/login" style={{ textDecoration: 'underline' }}>Go to /login</a>
    </main>
  );
}