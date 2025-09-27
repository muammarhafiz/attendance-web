'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

type EnvInfo = { url?: string; ref?: string; hasUrl: boolean; hasAnon: boolean; anonLen: number };

export default function DebugAuth() {
  const [env, setEnv] = useState<EnvInfo>({ hasUrl:false, hasAnon:false, anonLen:0 });
  const [session, setSession] = useState<Session | null>(null);
  const [storageKeys, setStorageKeys] = useState<string[]>([]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const ref = url.replace('https://','').replace('.supabase.co','');
    setEnv({ url, ref, hasUrl: !!url, hasAnon: !!anon, anonLen: anon.length });

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_evt: AuthChangeEvent, s: Session | null) => setSession(s));

    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-')) keys.push(k);
      }
      setStorageKeys(keys);
    } catch {}

    return () => data.subscription.unsubscribe();
  }, []);

  const Box = ({ ok, label, extra }: { ok: boolean; label: string; extra?: string }) => (
    <div style={{
      border:'1px solid', borderColor: ok ? '#16a34a' : '#dc2626', padding:10, borderRadius:8, margin:'6px 0',
      background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#14532d' : '#7f1d1d'
    }}>
      <b>{ok ? '✅' : '❌'} {label}</b> {extra ? <span style={{color:'#374151'}}>{extra}</span> : null}
    </div>
  );

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Auth Debug</h2>

      <Box ok={env.hasUrl}  label={`ENV URL present`} extra={env.url || '(missing)'}/>
      <Box ok={env.hasAnon} label={`ENV ANON present`} extra={`length=${env.anonLen}`}/>
      <Box ok={storageKeys.length>0} label="LocalStorage auth key written" extra={storageKeys.join(', ') || '(none)'} />
      <Box ok={!!session?.user?.email} label="Session user email" extra={session?.user?.email || '(null)'} />

      <pre style={{ marginTop:12, whiteSpace:'pre-wrap', fontSize:12, color:'#4b5563' }}>
{JSON.stringify({ env, sessionUserEmail: session?.user?.email ?? null, storageKeys }, null, 2)}
      </pre>

      <div style={{marginTop:10}}>
        <a href="/login" style={{ textDecoration:'underline' }}>Go to /login</a>
      </div>
    </main>
  );
}