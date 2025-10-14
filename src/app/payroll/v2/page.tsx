'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* =========================
   Types
   ========================= */
type SummaryRow = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: number | string;
  base_wage: number | string;
  manual_deduct: number | string; // manual only
  unpaid_auto: number | string;   // auto UNPAID only
  epf_emp: number | string;
  socso_emp: number | string;
  eis_emp: number | string;
  epf_er: number | string;
  socso_er: number | string;
  eis_er: number | string;
  total_deduct: number | string;
  net_pay: number | string;
};

type PeriodRow = { id: string; year: number; month: number; status: 'OPEN'|'LOCKED'|'FINALIZED'|string };

type PayItem = {
  id: string;
  period_id: string;
  staff_email: string;
  kind: string;       // EARN | DEDUCT | STAT_...
  code: string | null;
  label: string | null;
  amount: number;
};

function asNum(x: number | string | null | undefined): number {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number | string, currency = false): string {
  const v = asNum(n);
  return currency
    ? v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toFixed(2);
}
const isSystemManaged = (kind: string, code: string | null) => {
  const k = (kind || '').toUpperCase();
  const c = (code || '').toUpperCase();
  return c === 'BASE' || c === 'UNPAID' || k.startsWith('STAT_');
};

/* =========================
   Page
   ========================= */
export default function PayrollV2Page() {
  // KL default period
  const klNow = useMemo(
    () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })),
    []
  );
  const [year, setYear] = useState<number>(klNow.getFullYear());
  const [month, setMonth] = useState<number>(klNow.getMonth() + 1);

  const [period, setPeriod] = useState<PeriodRow | null>(null);
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [absentMap, setAbsentMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);

  // auth/admin
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser();
      const em = data.user?.email ?? null;
      setEmail(em);
      if (em) {
        const { data: ok, error } = await supabase.rpc('is_admin', {});
        setIsAdmin(!error && ok === true);
      } else {
        setIsAdmin(false);
      }
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const disabledWrites = !isAdmin;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 1) period
      {
        const { data, error } = await supabase
          .from('pay_v2.periods')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .limit(1)
          .maybeSingle();
        if (!error) setPeriod(data as PeriodRow | null);
        else setPeriod(null);
      }

      // 2) summary view v2
      {
        const { data, error } = await supabase
          .from('v_payslip_admin_summary_v2')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .order('staff_name', { ascending: true });
        if (error) throw error;
        setRows((data as SummaryRow[]) ?? []);
      }

      // 3) absent days (public wrapper)
      {
        const { data, error } = await supabase.rpc('absent_days_from_report', {
          p_year: year,
          p_month: month,
        });
        if (!error && Array.isArray(data)) {
          const map: Record<string, number> = {};
          for (const r of data as { staff_email: string; days_absent: number }[]) {
            map[r.staff_email] = r.days_absent ?? 0;
          }
          setAbsentMap(map);
        } else {
          setAbsentMap({});
        }
      }
    } catch (e) {
      console.error(e);
      alert(`Failed to load payroll data: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { refresh(); }, [refresh]);

  // RPC helper
  const callRpc = async (fn: string, args: any) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) throw error;
  };

  const build      = () => !disabledWrites && callRpc('build_period', { p_year: year, p_month: month }).then(refresh).catch(e=>alert(`build_period failed: ${e.message}`));
  const syncBase   = () => !disabledWrites && callRpc('sync_base_items', { p_year: year, p_month: month }).then(refresh).catch(e=>alert(`sync_base_items failed: ${e.message}`));
  const syncAbsent = () => !disabledWrites && callRpc('sync_absent_deductions', { p_year: year, p_month: month }).then(refresh).catch(e=>alert(`sync_absent_deductions failed: ${e.message}`));
  const recalc     = () => !disabledWrites && callRpc('recalc_statutories', { p_year: year, p_month: month }).then(refresh).catch(e=>alert(`recalc_statutories failed: ${e.message}`));
  const lock       = () => !disabledWrites && callRpc('lock_period', { p_year: year, p_month: month }).then(refresh).catch(e=>alert(`lock_period failed: ${e.message}`));
  const unlock     = () => !disabledWrites && callRpc('unlock_period', { p_year: year, p_month: month }).then(refresh).catch(e=>alert(`unlock_period failed: ${e.message}`));

  const finalizeAndGenerate = async () => {
    if (disabledWrites) return;
    try {
      const res = await fetch('/api/payroll/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Finalize & PDF generation started/completed.');
      await refresh();
    } catch (e:any) {
      alert(`Finalize failed: ${e.message}`);
    }
  };

  // Status pill
  const statusPill = useMemo(() => {
    const st = period?.status ?? '';
    const cls =
      st === 'LOCKED' ? 'bg-yellow-100 text-yellow-800'
      : st === 'FINALIZED' ? 'bg-blue-100 text-blue-800'
      : 'bg-green-100 text-green-800';
    return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{st || '—'}</span>;
  }, [period]);

  /* =========================
     Details Modal (per staff)
     ========================= */
  const [detailsFor, setDetailsFor] = useState<{email: string; name: string | null} | null>(null);
  const [items, setItems] = useState<PayItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const canEdit = isAdmin && (period?.status === 'OPEN');

  const loadItems = useCallback(async (staffEmail: string) => {
    if (!period?.id) return;
    setItemsLoading(true);
    try {
      const { data, error } = await supabase
        .from('pay_v2.items')
        .select('id, period_id, staff_email, kind, code, label, amount')
        .eq('period_id', period.id)
        .eq('staff_email', staffEmail)
        .order('kind', { ascending: true });
      if (error) throw error;
      setItems((data as PayItem[]) ?? []);
    } catch (e:any) {
      alert(`Load items failed: ${e.message}`);
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [period?.id]);

  const openDetails = (row: SummaryRow) => {
    setDetailsFor({ email: row.staff_email, name: row.staff_name });
    loadItems(row.staff_email);
  };
  const closeDetails = () => {
    setDetailsFor(null);
    setItems([]);
  };

  const manualEarn = items.filter(i => !isSystemManaged(i.kind, i.code) && i.kind.toUpperCase() === 'EARN');
  const manualDed  = items.filter(i => !isSystemManaged(i.kind, i.code) && i.kind.toUpperCase() === 'DEDUCT');

  // Add form
  const [newKind, setNewKind] = useState<'EARN'|'DEDUCT'>('EARN');
  const [newCode, setNewCode] = useState<string>('COMM');     // sensible default
  const [newLabel, setNewLabel] = useState<string>('');
  const [newAmt, setNewAmt] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const resetAddForm = () => {
    setNewKind('EARN'); setNewCode('COMM'); setNewLabel(''); setNewAmt('');
  };

  const addLine = async () => {
    if (!detailsFor) return;
    const amount = Number(newAmt);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Amount must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      await callRpc('add_pay_item', {
        p_year: year,
        p_month: month,
        p_email: detailsFor.email,
        p_kind: newKind,
        p_code: newCode || (newKind === 'EARN' ? 'ADJUST' : 'ADJUST'),
        p_label: newLabel || newCode || (newKind === 'EARN' ? 'Adjust' : 'Adjust'),
        p_amount: amount,
      });
      // Recalc + refresh
      await callRpc('recalc_statutories', { p_year: year, p_month: month });
      await loadItems(detailsFor.email);
      await refresh();
      resetAddForm();
    } catch (e:any) {
      alert(`Add failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateLine = async (it: PayItem, newAmount: number, newLbl: string) => {
    if (!canEdit) return;
    if (newAmount <= 0 || !Number.isFinite(newAmount)) {
      alert('Amount must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      await callRpc('update_pay_item', { p_item_id: it.id, p_amount: newAmount, p_label: newLbl || it.label });
      await callRpc('recalc_statutories', { p_year: year, p_month: month });
      if (detailsFor) await loadItems(detailsFor.email);
      await refresh();
    } catch (e:any) {
      alert(`Update failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteLine = async (it: PayItem) => {
    if (!canEdit) return;
    if (!confirm('Delete this item?')) return;
    setSaving(true);
    try {
      await callRpc('delete_pay_item', { p_item_id: it.id });
      await callRpc('recalc_statutories', { p_year: year, p_month: month });
      if (detailsFor) await loadItems(detailsFor.email);
      await refresh();
    } catch (e:any) {
      alert(`Delete failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  /* =========================
     Render
     ========================= */
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">Payroll v2</h1>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="text-sm text-gray-600">
          <div className="mb-1">Period: <b>{`${year}-${String(month).padStart(2,'0')}`}</b></div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Status:</span>{statusPill}
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <div>
            <div className="text-xs text-gray-500">Year</div>
            <input type="number" className="w-24 rounded border px-2 py-1"
              value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div>
            <div className="text-xs text-gray-500">Month</div>
            <input type="number" min={1} max={12} className="w-20 rounded border px-2 py-1"
              value={month} onChange={(e) => setMonth(Number(e.target.value))} />
          </div>
          <button onClick={refresh} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Refresh</button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={build}      disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Build</button>
        <button onClick={syncBase}   disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Sync Base</button>
        <button onClick={syncAbsent} disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Sync Absent</button>
        <button onClick={recalc}     disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Recalc Statutories</button>
        <span className="mx-1 text-gray-300">|</span>
        <button onClick={lock}       disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Lock</button>
        <button onClick={unlock}     disabled={disabledWrites} className={`rounded px-3 py-1.5 text-sm font-medium ${disabledWrites?'bg-gray-100 text-gray-400':'border bg-white hover:bg-gray-50'}`}>Unlock</button>
        <button onClick={finalizeAndGenerate} disabled={disabledWrites}
          className={`ml-2 rounded px-3 py-1.5 text-sm font-semibold ${disabledWrites?'bg-blue-200 text-white':'bg-blue-600 text-white hover:bg-blue-700'}`}>
          Finalize & Generate PDFs
        </button>
      </div>

      {loading && (
        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Loading…
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded border">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="border-b px-3 py-2">Staff</th>
              <th className="border-b px-3 py-2">Base</th>
              <th className="border-b px-3 py-2">Earn</th>
              <th className="border-b px-3 py-2">Manual Deduct</th>
              <th className="border-b px-3 py-2">Unpaid (auto)</th>
              <th className="border-b px-3 py-2">EPF (Emp)</th>
              <th className="border-b px-3 py-2">SOCSO (Emp)</th>
              <th className="border-b px-3 py-2">EIS (Emp)</th>
              <th className="border-b px-3 py-2">Total Deduct</th>
              <th className="border-b px-3 py-2">Net</th>
              <th className="border-b px-3 py-2">Absent (days)</th>
              <th className="border-b px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-gray-500">
                  No data for {year}-{String(month).padStart(2,'0')}. Try Build/Sync.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const absent = absentMap[r.staff_email] ?? 0;
                return (
                  <tr key={r.staff_email} className="odd:bg-white even:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.staff_name ?? r.staff_email}
                      <div className="text-xs font-normal text-gray-500">{r.staff_email}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.base_wage, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_earn, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.manual_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.unpaid_auto, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.epf_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.socso_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.eis_emp, true)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(r.total_deduct, true)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{fmt(r.net_pay, true)}</td>
                    <td className="px-3 py-2 text-center">{absent}</td>
                    <td className="px-3 py-2">
                      <button
                        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => openDetails(r)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Finalize uses your existing <code>/api/payroll/finalize</code> endpoint to generate & upload PDFs to your
        Supabase Storage bucket.
      </p>

      {/* Details modal */}
      {detailsFor && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeDetails(); }}
        >
          <div className="w-[min(980px,96vw)] rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">
                Edit items — {detailsFor.name ?? detailsFor.email}
                <div className="text-xs text-gray-500">{detailsFor.email}</div>
              </div>
              <button className="text-sm text-gray-600 hover:text-gray-900" onClick={closeDetails}>Close</button>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-2">
              <section className="rounded border">
                <div className="border-b bg-gray-50 px-3 py-2 font-medium">Earnings (manual)</div>
                <div className="max-h-[320px] overflow-auto">
                  {itemsLoading ? (
                    <div className="p-3 text-sm text-gray-500">Loading…</div>
                  ) : manualEarn.length === 0 ? (
                    <div className="p-3 text-sm text-gray-500">No manual earnings.</div>
                  ) : (
                    manualEarn.map(it => (
                      <ItemRow
                        key={it.id}
                        it={it}
                        canEdit={canEdit}
                        onUpdate={(amt, lbl) => updateLine(it, amt, lbl)}
                        onDelete={() => deleteLine(it)}
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border">
                <div className="border-b bg-gray-50 px-3 py-2 font-medium">Deductions (manual)</div>
                <div className="max-h-[320px] overflow-auto">
                  {itemsLoading ? (
                    <div className="p-3 text-sm text-gray-500">Loading…</div>
                  ) : manualDed.length === 0 ? (
                    <div className="p-3 text-sm text-gray-500">No manual deductions.</div>
                  ) : (
                    manualDed.map(it => (
                      <ItemRow
                        key={it.id}
                        it={it}
                        canEdit={canEdit}
                        onUpdate={(amt, lbl) => updateLine(it, amt, lbl)}
                        onDelete={() => deleteLine(it)}
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border md:col-span-2">
                <div className="border-b bg-gray-50 px-3 py-2 font-medium">Add item</div>
                <div className="flex flex-wrap items-end gap-3 p-3">
                  <div>
                    <div className="text-xs text-gray-500">Type</div>
                    <select className="rounded border px-2 py-1"
                      value={newKind} onChange={e => setNewKind(e.target.value as 'EARN'|'DEDUCT')}>
                      <option value="EARN">Earning</option>
                      <option value="DEDUCT">Deduction</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Code</div>
                    <input className="w-36 rounded border px-2 py-1" value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())} placeholder="COMM / ALLOW / ADVANCE" />
                  </div>
                  <div className="grow min-w-[180px]">
                    <div className="text-xs text-gray-500">Label</div>
                    <input className="w-full rounded border px-2 py-1" value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="Display label" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Amount</div>
                    <input className="w-32 rounded border px-2 py-1 text-right" value={newAmt} onChange={e=>setNewAmt(e.target.value)} placeholder="0.00" />
                  </div>
                  <button
                    disabled={!canEdit || saving}
                    onClick={addLine}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${!canEdit ? 'bg-gray-100 text-gray-400' : 'border bg-white hover:bg-gray-50'}`}
                  >
                    Add
                  </button>
                </div>
                {!canEdit && (
                  <div className="px-3 pb-3 text-xs text-gray-500">
                    Period must be <b>OPEN</b> and you must be admin to edit.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Small component: editable row
   ========================= */
function ItemRow({
  it, canEdit, onUpdate, onDelete
}: {
  it: PayItem;
  canEdit: boolean;
  onUpdate: (amount: number, label: string) => void;
  onDelete: () => void;
}) {
  const [amt, setAmt] = useState<string>(String(it.amount));
  const [lbl, setLbl] = useState<string>(it.label || (it.code || ''));
  const [editing, setEditing] = useState(false);

  const save = () => {
    const v = Number(amt);
    if (!Number.isFinite(v) || v <= 0) {
      alert('Amount must be a positive number.');
      return;
    }
    onUpdate(v, lbl);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
      <span className="inline-block w-14 text-xs font-mono text-gray-500">{(it.code || '').toUpperCase()}</span>
      <input
        className="min-w-[180px] grow rounded border px-2 py-1 text-sm"
        value={lbl}
        disabled={!canEdit}
        onChange={e=>setLbl(e.target.value)}
      />
      <input
        className="w-28 rounded border px-2 py-1 text-right font-mono"
        value={amt}
        disabled={!canEdit}
        onChange={e=>setAmt(e.target.value)}
      />
      <div className="ml-auto flex items-center gap-2">
        <button className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
          disabled={!canEdit}
          onClick={editing ? save : () => setEditing(true)}>
          {editing ? 'Save' : 'Edit'}
        </button>
        <button className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          disabled={!canEdit}
          onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
