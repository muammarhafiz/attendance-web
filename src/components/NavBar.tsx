// src/components/NavBar.tsx
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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

      if (userEmail) {
        const { data, error } = await supabase.rpc('is_admin');
        setIsAdmin(Boolean(data) && !error);
      } else {
        setIsAdmin(false);
      }
    };

    readAuthAndRole();

    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      const userEmail = session?.user?.email ?? null;
      setEmail(userEmail);
      if (userEmail) {
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

  const isActive = useMemo(
    () => (href: string) =>
      pathname === href || pathname?.startsWith(href + '/') || pathname === href + '/',
    [pathname]
  );

  const linkClass = (href: string) =>
    `inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition
     ${isActive(href)
       ? 'bg-gray-900 text-white'
       : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'}`;

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Left: brand + primary links */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Brand */}
          <Link
            href="/"
            className="mr-2 hidden rounded-md px-2 py-1 text-sm font-bold tracking-wide text-gray-900 sm:inline-flex"
            aria-label="Home"
            title="Home"
          >
            Attendance
          </Link>

          {/* Primary links */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Link href="/" className={linkClass('/')}>Check-in</Link>
            <Link href="/today" className={linkClass('/today')}>Today</Link>
            <Link href="/report" className={linkClass('/report')}>Report</Link>
            {/* Removed: Manager */}
            <Link href="/offday" className={linkClass('/offday')}>Offday/MC</Link>

            {/* Admin-only payroll links (old Payroll removed) */}
            {isAdmin && (
              <>
                <Link href="/payroll/records" className={linkClass('/payroll/records')}>Payroll Records</Link>
                <Link href="/payroll/v2" className={linkClass('/payroll/v2')}>Payroll v2</Link>
              </>
            )}

            <Link href="/employees" className={linkClass('/employees')}>Employees</Link>
          </div>
        </div>

        {/* Right: auth */}
        <div className="flex items-center gap-2 sm:gap-3">
          {email ? (
            <>
              <span className="hidden text-sm text-gray-600 sm:inline">{email}</span>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-900 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
