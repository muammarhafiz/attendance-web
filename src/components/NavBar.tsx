'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function NavBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold text-gray-900">Check-in</Link>
          <Link href="/today" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Today</Link>
          <Link href="/report" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Report</Link>
          <Link href="/manager" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Manager</Link>
          <Link href="/offday" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Offday/MC</Link>
        </div>

        {/* Auth button */}
        <div className="flex items-center gap-3">
          {email ? (
            <>
              <span className="hidden text-sm text-gray-600 sm:inline">{email}</span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-200"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"   // ✅ Point to the actual login route
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