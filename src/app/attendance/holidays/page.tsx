'use client';

// Public-holiday management, moved out of Settings into the Attendance area.
// Owner-only (same as when it lived under Settings → Holidays). The component is
// self-contained; this page just gates it and lets the Attendance layout supply the heading.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import HolidaysSettings from '@/components/settings/HolidaysSettings';

export default function AttendanceHolidaysPage() {
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.rpc('is_admin').then(({ data }) => setOwner(data === true));
  }, []);
  if (owner === null) return <div className="text-sm text-ink-2">Checking…</div>;
  if (!owner) return <div className="text-sm text-ink-2">You don&apos;t have access to this page.</div>;
  return <HolidaysSettings />;
}
