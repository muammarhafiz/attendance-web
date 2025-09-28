'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function NavBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (()=>void) | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setEmail(session?.user?.email ?? null);
      unsub = supabase.auth.onAuthStateChange((_e, s) => {
        setEmail(s?.user?.email ?? null);
      }).data?.subscription?.unsubscribe ?? null;
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const bar: React.CSSProperties = {
    display:'flex', alignItems:'center', gap:16, padding:'10px 16px',
    borderBottom:'1px solid #e5e7eb', position:'sticky', top:0, background:'#fff', zIndex:10
  };
  const link: React.CSSProperties = { textDecoration:'none', color:'#111', fontWeight:600 };
  const right: React.CSSProperties = { marginLeft:'auto', display:'flex', gap:12, alignItems:'center' };
  const pill: React.CSSProperties = { padding:'6px 10px', border:'1px solid #d0d5dd', borderRadius:999 };

  return (
    <nav style={bar}>
      <Link href="/" style={link}>Attendance</Link>
      <Link href="/" style={link}>Home</Link>
      <Link href="/today" style={link}>Today</Link>
      <Link href="/report" style={link}>Report</Link>
      <Link href="/offday" style={link}>Offday/MC</Link>
      <Link href="/manager" style={link}>Manager</Link>
      <div style={right}>
        {email ? <span style={pill}>{email}</span> : <Link href="/login" style={link}>Sign in</Link>}
      </div>
    </nav>
  );
}

