// src/components/NavBar.tsx
'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function NavBar() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;

    const readAuthAndRole = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userEmail = userData.user?.email ?? null;
      setEmail(userEmail);

      // check admin (only if logged in)
      if (userEmail) {
        const { data, error } = await supabase.rpc('is_admin');
        setIsAdmin(Boolean(data) && !error);
      } else {
        setIsAdmin(false);
      }
    };

    // initial
    readAuthAndRole();

    // live updates
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
      if (session?.user?.email) {
        supabase.rpc('is_admin').then(({ data, error }) => {
          setIsAdmin(Boolean(data) && !error);
        });
      } else {
        setIsAdmin(false);
      }
    });
    unsub = data?.subscription ?? null;

    return () => unsub?.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const linkCls = useMemo(
    () =>
      (href: string) =>
        `text-sm font-semibold ${
          pathname?.startsWith(href) ? 'text-gray-900' : 'text-gray-700 hover:text-gray-900'
        }`,
    [pathname]
  );

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">

        <div className="flex items-center gap-6">
          <Link href="/" className={linkCls('/')}>Check-in</Link>
          <Link href="/today" className={linkCls('/today')}>Today</Link>
          <Link href="/report" className={linkCls('/report')}>Report</Link>
          <Link href="/manager" className={linkCls('/manager')}>Manager</Link>
          <Link href="/offday" className={linkCls('/offday')}>Offday/MC</Link>

          {/* Admin-only payroll links */}
          {isAdmin && (
            <>
              <Link href="/payroll/admin" className={linkCls('/payroll/admin')}>Payroll</Link>
              <Link href="/payroll/records" className={linkCls('/payroll/records')}>Payroll Records</Link>
              <Link href="/payroll/v2" className={linkCls('/payroll/v2')}>Payroll v2</Link>
            </>
          )}

          {/* NEW: Employees */}
          <Link href="/employees" className={linkCls('/employees')}>Employees</Link>
        </div>

        <div className="flex items-center gap-3">
          {email ? (
            <>
              <span className="hidden text-sm text-gray-600 sm:inline">{email}</span>
              <button
                onClick={handleSignOut}
                className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-200"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
