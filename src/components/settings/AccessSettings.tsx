'use client';
// Settings → Access. The ONE place that defines what each position can open.
// Owner has everything (locked). Managers can edit the operational toggles, but only an
// Owner can change the salary/financial/access ones (payroll, employees, pnl, access_admin).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const POSITIONS = ['Owner', 'Manager', 'Office', 'Supervisor', 'Mechanic', 'Mechanic 2', 'Mechanic 3', 'Part-time', 'Temporary', 'Trainer'];

type Feature = { key: string; label: string; ownerOnly?: boolean; note?: string };
const FEATURES: Feature[] = [
  { key: 'checkin', label: 'Check-in' },
  { key: 'workshop', label: 'Workshop' },
  { key: 'add_part', label: 'Part arrived' },
  { key: 'intake', label: 'Customer check-in' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'niagawan', label: 'Niagawan' },
  { key: 'month_end', label: 'Office' },
  { key: 'pnl', label: 'P&L (profit)', ownerOnly: true, note: 'financial' },
  { key: 'payroll', label: 'Payroll', ownerOnly: true, note: 'salary' },
  { key: 'employees', label: 'Employees', ownerOnly: true, note: 'salary' },
  { key: 'pay_salaries', label: 'Pay salaries', ownerOnly: true, note: 'salary' },
  { key: 'access_admin', label: 'Manage access', ownerOnly: true },
];

export default function AccessSettings() {
  const [allow, setAllow] = useState<Record<string, boolean>>({}); // `${position}|${feature}` -> bool
  const [isOwner, setIsOwner] = useState(false);
  const [canEdit, setCanEdit] = useState(false); // owner or manager (access_admin)
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: acc }, { data: rows, error }] = await Promise.all([
      supabase.rpc('my_access'),
      supabase.from('position_access').select('position,feature,allowed'),
    ]);
    const a = (acc ?? {}) as Record<string, boolean>;
    setIsOwner(!!a.owner);
    setCanEdit(!!a.owner || !!a.access_admin);
    if (error) setErr(error.message);
    const m: Record<string, boolean> = {};
    for (const r of rows ?? []) m[`${r.position}|${r.feature}`] = !!r.allowed;
    setAllow(m);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cellChecked = (position: string, feature: string) =>
    position === 'Owner' ? true : !!allow[`${position}|${feature}`];

  const cellDisabled = (position: string, f: Feature) =>
    !canEdit || position === 'Owner' || (f.ownerOnly && !isOwner) || savingKey === `${position}|${f.key}`;

  const toggle = useCallback(async (position: string, feature: string) => {
    const k = `${position}|${feature}`;
    const next = !allow[k];
    setErr(null);
    setAllow((a) => ({ ...a, [k]: next }));
    setSavingKey(k);
    const { error } = await supabase.rpc('set_position_access', { p_position: position, p_feature: feature, p_allowed: next });
    if (error) { setErr(error.message); setAllow((a) => ({ ...a, [k]: !next })); } // revert on failure
    setSavingKey((s) => (s === k ? null : s));
  }, [allow]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Access</h2>
        <p className="mt-1 text-sm text-ink-2">
          What each <span className="font-medium">position</span> can open. Set a person&apos;s position on the Employees page and
          their access follows this table. <span className="font-medium">Owner</span> always has everything.
        </p>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-bad-soft px-3 py-2 text-xs text-bad">{err}</div>}
      {!loading && !canEdit && (
        <div className="rounded-lg border border-amber-200 bg-warn-soft px-3 py-2 text-sm text-warn">You can view this, but only an Owner or Manager can change it.</div>
      )}
      {!loading && canEdit && !isOwner && (
        <div className="rounded-lg border border-line bg-ink/5 px-3 py-2 text-xs text-ink-2">
          You can change the operational toggles. The <span className="font-medium text-warn">salary / financial / access</span> columns are Owner-only.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-card bg-card shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-ink-2">Position</th>
                {FEATURES.map((f) => (
                  <th key={f.key} className="px-2 py-2 text-center font-medium text-ink-2 whitespace-nowrap">
                    <div>{f.label}</div>
                    {f.note && <div className={`text-[10px] font-normal ${f.note === 'salary' ? 'text-bad' : 'text-warn'}`}>{f.note}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((p) => (
                <tr key={p} className="border-t border-line">
                  <td className={`sticky left-0 z-10 bg-card px-3 py-2 font-medium ${p === 'Owner' ? 'text-good' : 'text-ink-2'}`}>{p}</td>
                  {FEATURES.map((f) => (
                    <td key={f.key} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={cellChecked(p, f.key)}
                        disabled={cellDisabled(p, f)}
                        onChange={() => toggle(p, f.key)}
                        className="h-5 w-5 cursor-pointer rounded border-line accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`${p} can access ${f.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-3">
        Everyone can always reach their own <span className="font-medium">Check-in</span> (clock-in, own payslip &amp; sales).
        Columns marked <span className="text-bad">salary</span> / <span className="text-warn">financial</span> reveal sensitive data — only an Owner can turn those on.
      </p>
    </div>
  );
}
