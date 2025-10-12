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

  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null;

    // Initial read
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));

    // Live updates
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
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
  <Link href="/" className="text-sm font-semibold text-gray-900">Check-in</Link>
  <Link href="/today" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Today</Link>
  <Link href="/report" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Report</Link>
  <Link href="/manager" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Manager</Link>
  <Link href="/offday" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Offday/MC</Link>
  <Link href="/payroll/admin" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Payroll</Link>
  <Link href="/payroll/records" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Payroll Records</Link>
  {/* NEW: Employees */}
  <Link href="/employees" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Employees</Link>
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