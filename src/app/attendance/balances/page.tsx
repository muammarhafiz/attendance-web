'use client';
// Leave balances (Employment Act). Entitlement from each staff's start date:
// Annual 8/12/16, Sick (MC) 14/18/22 by years of service. "Used" comes from the request
// flows — approved off-day requests + emergencies (annual) and approved MC (sick).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Bal = {
  email: string; name: string; start_date: string | null; years: number;
  annual_ent: number; annual_used: number; emergency_used: number;
  mc_ent: number; mc_used: number; annual_left: number; mc_left: number; unpaid: number;
};

const nowYear = new Date(Date.now() + 8 * 3600e3).getUTCFullYear();

export default function LeaveBalancesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [year, setYear] = useState(nowYear);
  const [rows, setRows] = useState<Bal[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      if (data.session) { const { data: a } = await supabase.rpc('can_access', { p_feature: 'attendance' }); setOk(a === true); }
      else setOk(false);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('leave_balances', { p_year: year });
    setRows((data ?? []) as Bal[]);
    setLoading(false);
  }, [year]);
  useEffect(() => { if (ok) load(); }, [ok, load]);

  if (authed === null || ok === null) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-3">Checking…</div>;
  if (!authed) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-2">Please sign in.</div>;
  if (!ok) return <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-ink-2">You don&apos;t have access to this page.</div>;

  const missing = rows.filter((r) => !r.start_date).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Leave balances</h1>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setYear((y) => y - 1)} className="rounded-md border border-line px-2 py-1 text-sm text-ink-2 hover:bg-ink/5">‹</button>
          <span className="min-w-[56px] text-center text-sm font-semibold text-ink tabular-nums">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} disabled={year >= nowYear} className="rounded-md border border-line px-2 py-1 text-sm text-ink-2 hover:bg-ink/5 disabled:opacity-30">›</button>
        </div>
      </div>

      <div className="mb-4 rounded-card bg-card p-4 shadow-card">
        <p className="text-xs text-ink-3">
          Set by law from each staff&rsquo;s start date — <b>Annual</b> 8 / 12 / 16 and <b>MC</b> 14 / 18 / 22 days by years of service.
          Annual counts approved <b>off-day</b> requests and <b>emergencies</b>; MC counts approved <b>MC</b>. Rest days, Sundays, and public holidays don&rsquo;t count.
          Emergency leave comes out of annual.
        </p>
        {missing > 0 && (
          <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            {missing} staff have no <b>start date</b> set, so they default to the lowest tier (8 / 14). Add it in Employees to fix their entitlement.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-card bg-card shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-3 py-2 font-medium">Staff</th>
              <th className="px-3 py-2 font-medium">Service</th>
              <th className="px-3 py-2 font-medium">Annual leave</th>
              <th className="px-3 py-2 font-medium">Sick / MC</th>
              <th className="px-3 py-2 font-medium">Emergency</th>
              <th className="px-3 py-2 font-medium">Unpaid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-4 text-ink-3">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-ink-3">No staff.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.email}>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">{r.name}</div>
                  {!r.start_date && <div className="text-[11px] text-warn">no start date</div>}
                </td>
                <td className="px-3 py-2.5 text-ink-2 tabular-nums">{r.start_date ? `${r.years} yr${r.years === 1 ? '' : 's'}` : '—'}</td>
                <td className="px-3 py-2.5">
                  <span className="tabular-nums text-ink">{r.annual_used}</span>
                  <span className="text-ink-3"> / {r.annual_ent}</span>
                  <span className={`ml-2 text-xs ${r.annual_left === 0 ? 'text-bad' : 'text-good'}`}>{r.annual_left} left</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="tabular-nums text-ink">{r.mc_used}</span>
                  <span className="text-ink-3"> / {r.mc_ent}</span>
                  <span className={`ml-2 text-xs ${r.mc_left === 0 ? 'text-bad' : 'text-good'}`}>{r.mc_left} left</span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink-2">{r.emergency_used}</td>
                <td className="px-3 py-2.5 tabular-nums">
                  {r.unpaid > 0 ? <span className="rounded-full bg-bad-soft px-2 py-0.5 text-xs font-medium text-bad">{r.unpaid}</span> : <span className="text-ink-3">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
