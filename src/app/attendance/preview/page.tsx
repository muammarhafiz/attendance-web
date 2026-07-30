'use client';
// Owner-only "Preview as staff". Pick any active staff member and see their exact
// self-service check-in page (attendance, requests, documents needed, details) rendered
// read-only. No second login, no impersonation — it reuses owner-gated admin_* read RPCs.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import CheckinV2 from '@/components/CheckinV2';

type StaffRow = { email: string; name: string | null; full_name: string | null; position: string | null };

export default function PreviewAsStaffPage() {
  const [owner, setOwner] = useState<boolean | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('my_access');
      setOwner(!!(data as Record<string, boolean>)?.owner);
    })();
  }, []);

  useEffect(() => {
    if (!owner) return;
    (async () => {
      const { data } = await supabase.from('staff')
        .select('email,name,full_name,position')
        .is('archived_at', null)
        .order('name', { ascending: true });
      setStaff((data ?? []) as StaffRow[]);
    })();
  }, [owner]);

  if (owner === null) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-3">Checking…</div>;
  if (!owner) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-2">This page is for the owner.</div>;

  const label = (s: StaffRow) => `${s.full_name || s.name || s.email}${s.position ? ` · ${s.position}` : ''}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Preview as staff</h1>

      <div className="mb-4 mt-4 rounded-card bg-card p-4 shadow-card">
        <label className="block text-xs text-ink-2">Choose a staff member to see their check-in page
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="mt-1 block w-full max-w-sm rounded-md border border-line px-2 py-1.5 text-sm">
            <option value="">Select a staff…</option>
            {staff.map((s) => <option key={s.email} value={s.email}>{label(s)}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-ink-3">Read only — you see their exact page (attendance, requests, documents needed, details), but nothing can be submitted or changed here.</p>
      </div>

      {selected ? (
        <CheckinV2 key={selected} previewEmail={selected} embedded />
      ) : (
        <div className="rounded-card border border-line bg-ink/[0.03] p-10 text-center text-sm text-ink-3">Pick a staff member above to preview their page.</div>
      )}
    </div>
  );
}
