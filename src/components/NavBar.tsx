'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();

  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Load session email once
  useEffect(() => {
    let unsub = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    }).data.subscription;

    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
      setChecking(false);
    });

    return () => { unsub?.unsubscribe(); };
  }, []);

  const handleManagerClick = useCallback(async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();

    // Require login first
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Please sign in first.');
      router.push('/login');
      return;
    }

    // Check admin
    // Prefer the RPC is_admin() if you created it; otherwise fall back to staff table check.
    let isAdmin = false;
    const rpc = await supabase.rpc('is_admin');
    if (!rpc.error && rpc.data === true) {
      isAdmin = true;
    } else {
      const { data, error } = await supabase
        .from('staff')
        .select('is_admin')
        .eq('email', user.email)
        .single();
      if (!error && data?.is_admin) isAdmin = true;
    }

    if (!isAdmin) {
      alert('Admins only.');
      // stay on current page (or route home if you prefer):
      // router.push('/');
      return;
    }

    router.push('/manager');
  }, [router]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const LinkItem = ({ href, label }: { href: string; label: string }) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          textDecoration: 'none',
          color: active ? '#111' : '#333',
          background: active ? '#e5e7eb' : 'transparent',
          border: '1px solid transparent'
        }}
      >
        {label}
      </Link>
    );
  };

  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
      <nav style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'system-ui',
        color: '#111'
      }}>
        <div style={{ fontWeight: 700, marginRight: 8 }}>Attendance</div>
        <LinkItem href="/" label="Home" />
        <LinkItem href="/today" label="Today" />
        <LinkItem href="/report" label="Report" />

        {/* Manager link visible to everyone; click is checked */}
        <a
          href="/manager"
          onClick={handleManagerClick}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            textDecoration: 'none',
            color: '#333',
          }}
        >
          Manager
        </a>

        <div style={{ flex: 1 }} />

        {/* Right side: auth status */}
        {!checking && email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#555' }}>{email}</span>
            <button
              onClick={signOut}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}
            >
              Sign out
            </button>
          </div>
        )}

        {!checking && !email && (
          <Link
            href="/login"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 8, textDecoration: 'none', color: '#111' }}
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}