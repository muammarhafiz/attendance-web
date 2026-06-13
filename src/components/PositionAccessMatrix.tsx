// src/components/PositionAccessMatrix.tsx
// Admin-only tick-box grid: which POSITION can access which page/feature.
// Admins always have full access (enforced server-side in can_access()); this grid
// only grants extra access to non-admin positions. Saves immediately on each toggle.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const POSITIONS = ['Manager', 'Supervisor', 'Mechanic', 'Admin', 'Temporary', 'Trainer'];

const FEATURES: { key: string; label: string; note?: string }[] = [
  { key: 'checkin', label: 'Clock-in' },
  { key: 'workshop', label: 'Workshop board' },
  { key: 'add_part', label: 'Part Arrived' },
  { key: 'intake', label: 'Customer Check-in' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'niagawan', label: 'Niagawan' },
  { key: 'payroll', label: 'Payroll', note: 'salary data' },
  { key: 'employees', label: 'Employees', note: 'salary data' },
];

export default function PositionAccessMatrix() {
  const [allow, setAllow] = useState<Record<string, boolean>>({}); // key = `${position}|${feature}`
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('position_access').select('position,feature,allowed');
    if (error) setErr(error.message);
    const m: Record<string, boolean> = {};
    for (const r of data ?? []) m[`${r.position}|${r.feature}`] = !!r.allowed;
    setAllow(m);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (position: string, feature: string) => {
    const k = `${position}|${feature}`;
    const next = !allow[k];
    setAllow((a) => ({ ...a, [k]: next }));
    setSavingKey(k);
    const { error } = await supabase.from('position_access').upsert(
      { position, feature, allowed: next }, { onConflict: 'position,feature' }
    );
    if (error) { setErr(error.message); setAllow((a) => ({ ...a, [k]: !next })); } // revert on failure
    setSavingKey((s) => (s === k ? null : s));
  }, [allow]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Access by position</h2>
      <p className="mt-1 text-xs text-gray-500">
        Tick what each position can open. <span className="font-medium">Admins always have full access.</span>{' '}
        Pages marked <span className="text-amber-700">salary data</span> reveal pay information to that position.
      </p>
      {err && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}

      {loading ? (
        <div className="mt-3 text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white px-2 py-2 text-left font-medium text-gray-600">Position</th>
                {FEATURES.map((f) => (
                  <th key={f.key} className="px-2 py-2 text-center font-medium text-gray-600">
                    <div>{f.label}</div>
                    {f.note && <div className="text-[10px] font-normal text-amber-600">{f.note}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((p) => (
                <tr key={p} className="border-t border-gray-100">
                  <td className="sticky left-0 bg-white px-2 py-2 font-medium text-gray-800">{p}</td>
                  {FEATURES.map((f) => {
                    const k = `${p}|${f.key}`;
                    return (
                      <td key={f.key} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={!!allow[k]}
                          disabled={savingKey === k}
                          onChange={() => toggle(p, f.key)}
                          className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-emerald-600"
                          aria-label={`${p} can access ${f.label}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        <span className="font-medium text-gray-500">Live now:</span> Clock-in, Workshop board, Part Arrived, Customer Check-in
        are controlled by these ticks immediately. <span className="font-medium text-gray-500">Attendance, Niagawan, Payroll
        &amp; Employees</span> stay admin-only for now (Payroll &amp; Employees hold salaries) — set the tick here and tell
        me which position to switch on, and I&apos;ll enable it safely.
      </p>
    </div>
  );
}
