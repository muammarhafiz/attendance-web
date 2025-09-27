'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function TodayPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        // not logged in → redirect
        router.replace('/login?next=/today');
      } else {
        setEmail(data.session.user.email ?? null);
      }
      setSessionChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/login?next=/today');
      } else {
        setEmail(session.user.email ?? null);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (!sessionChecked) {
    return <div style={{ padding: 20 }}>Checking login…</div>;
  }

  if (!email) {
    return <div style={{ padding: 20 }}>Redirecting to login…</div>;
  }

  // 🟢 Place your existing Today logs UI here
  return (
    <div style={{ padding: 20 }}>
      <h2>Today's Logs</h2>
      <p>Signed in as {email}</p>
      {/* Your table + filters here */}
    </div>
  );
}