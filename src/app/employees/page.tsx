'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  name: string;
  staff_email: string;
  basic_salary: number | null;
  base_in_current_payroll: number | null;
  mismatched: boolean | null;
};

function rm(n?: number | null) {
  const v = Number(n ?? 0);
  return `RM ${v.toFixed(2)}`;
}

export default function EmployeesPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // edit modal
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBasic, setEditBasic] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMsg(null);
    const { data, error } = await supabase
      .schema('pay_v2')
      .from('v_staff_with_current_base')
      .select('*')
      .order('name', { ascending: true });
    if (error) setMsg(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openEdit = (r: Row) => {
    setEditingEmail(r.staff_email);
    setEditName(r.name ?? '');
    setEditBasic(r.basic_salary != null ? String(r.basic_salary) : '');
  };

  const save = async () => {
    if (!editingEmail) return;
    setSaving(true);
    setMsg(null);
    try {
      // 1) Update staff profile
      const basic = Number(editBasic || '0');
      const { error: upErr } = await supabase
        .from('staff')
        .update({ name: editName, basic_salary: basic })
        .eq('email', editingEmail);
      if (upErr) throw upErr;

      // 2) Push to Payroll BASE for selected period and recalc
      const { error: syncErr } = await supabase
        .rpc('sync_base_items', { p_year: year, p_month: month });
      if (syncErr) throw syncErr;

      setMsg('Saved & synced to payroll.');
      setEditingEmail(null);
      await load();
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-5 flex items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Employees</h1>
          <p className="text-sm text-gray-500">
            Edit profile salary, then we auto-sync BASE to Payroll and recalc EPF/SOCSO/EIS.
          </p>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-600">Sync Year</label>
            <input type="number" className="rounded border px-2 py-1" value={year}
              onChange={(e)=>setYear(Number(e.target.value))}/>
          </div>
          <div>
            <label className="block text-xs text-gray-600">Sync Month</label>
            <input type="number" min={1} max={12} className="rounded border px-2 py-1" value={month}
              onChange={(e)=>setMonth(Number(e.target.value))}/>
          </div>
          <button onClick={load} disabled={loading}
            className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">Refresh</button>
        </div>
      </header>

      {msg && <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{msg}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="border-b px-3 py-2 text-left">Name</th>
                <th className="border-b px-3 py-2 text-left">Email</th>
                <th className="border-b px-3 py-2 text-right">Basic salary (profile)</th>
                <th className="border-b px-3 py-2 text-right">BASE in current payroll</th>
                <th className="border-b px-3 py-2 text-left">Status</th>
                <th className="border-b px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const mismatch = !!r.mismatched;
                return (
                  <tr key={r.staff_email} className={mismatch ? 'bg-amber-50' : ''}>
                    <td className="border-b px-3 py-2">{r.name}</td>
                    <td className="border-b px-3 py-2">{r.staff_email}</td>
                    <td className="border-b px-3 py-2 text-right">{rm(r.basic_salary)}</td>
                    <td className="border-b px-3 py-2 text-right">{rm(r.base_in_current_payroll)}</td>
                    <td className="border-b px-3 py-2">
                      {mismatch ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Not synced</span>
                                : <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">In sync</span>}
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded border px-3 py-1.5 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td className="px-3 py-4 text-sm text-gray-500" colSpan={6}>No employees.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal (name + basic salary for brevity; add more fields as needed) */}
      {editingEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
             onClick={(e)=>{ if (e.target === e.currentTarget && !saving) setEditingEmail(null); }}>
          <div className="w-[520px] rounded-md bg-white shadow-xl">
            <div className="border-b p-3 font-semibold">Edit employee</div>
            <div className="grid gap-3 p-4">
              <div>
                <label className="block text-xs text-gray-600">Full name</label>
                <input className="w-full rounded border px-2 py-1" value={editName} onChange={(e)=>setEditName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-600">Basic salary (RM)</label>
                <input inputMode="decimal" className="w-full rounded border px-2 py-1 text-right"
                  value={editBasic} onChange={(e)=>setEditBasic(e.target.value)} />
                <p className="mt-1 text-xs text-gray-500">
                  On Save, this updates Payroll’s BASE for {String(month).padStart(2,'0')}/{year} and recalculates EPF/SOCSO/EIS.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t p-3">
              <button className="rounded border px-3 py-1.5" onClick={()=>setEditingEmail(null)} disabled={saving}>Cancel</button>
              <button className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}