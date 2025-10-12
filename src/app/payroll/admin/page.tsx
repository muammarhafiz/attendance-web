'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* -------------------------------- Types -------------------------------- */

type Row = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: string | number;  // display gross (all EARN)
  base_wage: string | number;   // BASE-only (statutory wage)
  manual_deduct: string | number;
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  epf_er: string | number;
  socso_er: string | number;
  eis_er: string | number;
  net_pay: string | number;
};

type Item = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number;
};

/* ------------------------------- Helpers ------------------------------- */

function n(x: string | number | null | undefined) {
  const v = typeof x === 'string' ? Number(x) : x ?? 0;
  return Number.isFinite(v as number) ? (v as number) : 0;
}
function rm(x: number) {
  return `RM ${x.toFixed(2)}`;
}

const EARN_CODE_OPTIONS = [
  { value: 'COMM', label: 'COMM – Commission' },
  { value: 'OT', label: 'OT – Overtime' },
  { value: 'ALLOW', label: 'ALLOW – Allowance' },
  { value: 'BONUS', label: 'BONUS – Bonus' },
  { value: 'RETRO', label: 'RETRO – Retro Pay' },
  { value: '__CUSTOM__', label: 'Custom…' },
];

const DED_CODE_OPTIONS = [
  { value: 'UNPAID', label: 'UNPAID – Unpaid Leave' },
  { value: 'ADV', label: 'ADV – Advance' },
  { value: 'LOAN', label: 'LOAN – Loan Repayment' },
  { value: 'PENALTY', label: 'PENALTY – Penalty' },
  { value: '__CUSTOM__', label: 'Custom…' },
];

/* -------------------------------- Page -------------------------------- */

export default function AdminPayrollPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // search & filters
  const [q, setQ] = useState('');
  const [fManual, setFManual] = useState(false);
  const [fAbsent, setFAbsent] = useState(false);
  const [fNegNet, setFNegNet] = useState(false);

  // absent counts (from report logic)
  const [absentCnt, setAbsentCnt] = useState<Record<string, number>>({});

  // Drawer editor
  const [openDrawerFor, setOpenDrawerFor] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [itemsEarn, setItemsEarn] = useState<Record<string, Item[]>>({});
  const [itemsDed, setItemsDed] = useState<Record<string, Item[]>>({});
  const [baseInput, setBaseInput] = useState<Record<string, string>>({});
  const [newEarn, setNewEarn] = useState<Record<string, { codeSel: string; code: string; label: string; amount: string }>>({});
  const [newDed, setNewDed] = useState<Record<string, { codeSel: string; code: string; label: string; amount: string }>>({});

  // auth
  useEffect(() => {
    let unsub: { data: { subscription: { unsubscribe: () => void } } } | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      const ret = supabase.auth.onAuthStateChange((_event, session) => setAuthed(!!session));
      unsub = ret;
    })();
    return () => unsub?.data.subscription.unsubscribe();
  }, []);

  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;

  const getPeriodId = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .schema('pay_v2')
      .from('periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (error) { setMsg(`Failed to read period: ${error.message}`); return null; }
    return data?.id ?? null;
  };

  const loadAbsentCounts = useCallback(async () => {
    const m: Record<string, number> = {};
    const { data } = await supabase
      .schema('pay_v2')
      .rpc('absent_days_from_report', { p_year: year, p_month: month });
    if (Array.isArray(data)) {
      for (const r of data as any[]) m[r.staff_email] = Number(r.days_absent || 0);
    }
    setAbsentCnt(m);
  }, [year, month]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const { data, error } = await supabase
      .schema('pay_v2')
      .from('v_payslip_admin_summary')
      .select('year,month,staff_name,staff_email,total_earn,base_wage,manual_deduct,epf_emp,socso_emp,eis_emp,epf_er,socso_er,eis_er,net_pay')
      .eq('year', year)
      .eq('month', month)
      .order('staff_name', { ascending: true });
    if (error) { setMsg(`Failed to load: ${error.message}`); setRows([]); }
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    if (authed) { loadSummary(); loadAbsentCounts(); }
  }, [authed, year, month, loadSummary, loadAbsentCounts]);

  // totals
  const totals = useMemo(() => {
    const sum = (k: keyof Row) => rows.reduce((a, r) => a + n(r[k]), 0);
    const gross = sum('total_earn');
    const baseWage = sum('base_wage');
    const manual = sum('manual_deduct');
    const epfEmp = sum('epf_emp');
    const socsoEmp = sum('socso_emp');
    const eisEmp = sum('eis_emp');
    const epfEr = sum('epf_er');
    const socsoEr = sum('socso_er');
    const eisEr = sum('eis_er');
    const totalDeduct = manual + epfEmp + socsoEmp + eisEmp;
    const net = sum('net_pay');
    const employerCost = gross + epfEr + socsoEr + eisEr;
    return { gross, baseWage, manual, epfEmp, socsoEmp, eisEmp, epfEr, socsoEr, eisEr, totalDeduct, net, employerCost };
  }, [rows]);

  // filtered rows
  const filtered = useMemo(() => {
    let r = rows;
    const ql = q.trim().toLowerCase();
    if (ql) {
      r = r.filter(x => (x.staff_name || '').toLowerCase().includes(ql) || x.staff_email.toLowerCase().includes(ql));
    }
    if (fManual) r = r.filter(x => n(x.manual_deduct) > 0);
    if (fAbsent) r = r.filter(x => (absentCnt[x.staff_email] || 0) > 0);
    if (fNegNet) r = r.filter(x => n(x.net_pay) < 0);
    return r;
  }, [rows, q, fManual, fAbsent, fNegNet, absentCnt]);

  /* ---------- Sync button: pull Employees.basic_salary into this month ---------- */
  const syncSalariesToThisMonth = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase
        .schema('pay_v2')
        .rpc('sync_base_items', { p_year: year, p_month: month });
      if (error) throw error;

      // sync_base_items already calls recalc_statutories; calling again is safe if desired:
      await supabase.schema('pay_v2').rpc('recalc_statutories', { p_year: year, p_month: month });

      setMsg('Synced base salaries from Employees into this month.');
      await loadSummary();
    } catch (e: any) {
      setMsg(`Sync failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------ Drawer UX ----------------------------- */

  const openDrawer = async (staff_email: string) => {
    setDrawerLoading(true);
    setOpenDrawerFor(staff_email);
    try {
      const period_id = await getPeriodId();
      if (!period_id) return;
      const { data, error } = await supabase
        .schema('pay_v2')
        .from('items')
        .select('id, kind, code, label, amount')
        .eq('period_id', period_id)
        .eq('staff_email', staff_email);
      if (error) throw error;

      const earnLines = (data ?? []).filter((x: any) => x.kind === 'EARN');
      const dedLines = (data ?? []).filter((x: any) => x.kind === 'DEDUCT');

      setItemsEarn(m => ({ ...m, [staff_email]: earnLines as Item[] }));
      setItemsDed(m => ({ ...m, [staff_email]: dedLines as Item[] }));

      const base = (earnLines as Item[]).find(x => (x.code || '').toUpperCase() === 'BASE');
      setBaseInput(m => ({ ...m, [staff_email]: base ? String(base.amount) : '' }));

      setNewEarn(m => ({ ...m, [staff_email]: { codeSel: EARN_CODE_OPTIONS[0].value, code: EARN_CODE_OPTIONS[0].value, label: '', amount: '' } }));
      setNewDed(m => ({ ...m, [staff_email]: { codeSel: DED_CODE_OPTIONS[0].value, code: DED_CODE_OPTIONS[0].value, label: '', amount: '' } }));
    } catch (e: any) {
      setMsg(`Editor load failed: ${e.message ?? e}`);
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => setOpenDrawerFor(null);

  const saveBase = async (staff_email: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const period_id = await getPeriodId();
      if (!period_id) return;

      const desired = Number(baseInput[staff_email] ?? '0') || 0;

      await supabase.schema('pay_v2').from('items')
        .delete()
        .eq('period_id', period_id)
        .eq('staff_email', staff_email)
        .eq('code', 'BASE');

      if (desired !== 0) {
        const { error } = await supabase
          .schema('pay_v2')
          .from('items')
          .insert({ period_id, staff_email, kind: 'EARN', code: 'BASE', label: 'Base salary', amount: desired });
        if (error) throw error;
      }

      const { error: recalcErr } = await supabase
        .schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });
      if (recalcErr) setMsg(`Recalc failed: ${recalcErr.message}`);
      else setMsg(`Base updated for ${staff_email}.`);

      await loadSummary();
      await openDrawer(staff_email);
    } catch (e: any) {
      setMsg(`Save base failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const addLine = async (staff_email: string, kind: 'EARN' | 'DEDUCT') => {
    setBusy(true);
    setMsg(null);
    try {
      const period_id = await getPeriodId();
      if (!period_id) return;

      const src = kind === 'EARN' ? newEarn[staff_email] : newDed[staff_email];

      let code = (src?.codeSel || '').toUpperCase();
      if (code === '__CUSTOM__') code = (src?.code || '').toUpperCase().trim();
      const label = (src?.label || '').trim();
      const amt = Number(src?.amount || '0') || 0;

      if (!code || !label || amt <= 0) {
        setMsg('Please select/enter a code, provide a label, and a positive amount.');
        setBusy(false);
        return;
      }

      const { error } = await supabase.schema('pay_v2').from('items').insert({ period_id, staff_email, kind, code, label, amount: amt });
      if (error) throw error;

      const { error: recalcErr } = await supabase.schema('pay_v2').rpc('recalc_statutories', { p_year: year, p_month: month });
      if (recalcErr) setMsg(`Recalc failed: ${recalcErr.message}`);

      await loadSummary();
      await openDrawer(staff_email);
    } catch (e: any) {
      setMsg(`Add line failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteLine = async (id: string, staff_email: string) => {
    setBusy(true);
       setMsg(null);
    try {
      const { error } = await supabase.schema('pay_v2').from('items').delete().eq('id', id);
      if (error) throw error;

      const { error: recalcErr } = await supabase.schema('pay_v2').rpc('recalc_statutories', { p_year: year, p_month: month });
      if (recalcErr) setMsg(`Recalc failed: ${recalcErr.message}`);

      await loadSummary();
      await openDrawer(staff_email);
    } catch (e: any) {
      setMsg(`Delete failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------- Render ------------------------------ */

  if (authed === false) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll</h1>
        <p className="text-sm text-gray-600">Please sign in to access Payroll.</p>
      </main>
    );
  }
  if (authed === null) {
    return (
      <main className="mx-auto max-w-7xl p-6">
        <div className="text-sm text-gray-600">Checking session…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] p-6">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payroll — Admin summary</h1>
          <p className="text-sm text-gray-500">Period {yyyymm}</p>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input type="number" className="rounded border px-2 py-1" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Month</label>
            <input type="number" className="rounded border px-2 py-1" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
          </div>
          <button
            onClick={() => { loadSummary(); loadAbsentCounts(); }}
            disabled={loading || busy}
            className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>

          {/* NEW: sync button */}
          <button
            onClick={syncSalariesToThisMonth}
            disabled={busy}
            className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Sync salaries to this month
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Search name/email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64 rounded border px-3 py-1.5"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fManual} onChange={(e) => setFManual(e.target.checked)} />
          Has manual deduct
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fAbsent} onChange={(e) => setFAbsent(e.target.checked)} />
          Has absent
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fNegNet} onChange={(e) => setFNegNet(e.target.checked)} />
          Net negative
        </label>
      </div>

      {msg && (<div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{msg}</div>)}

      {/* Table */}
      <section className="relative">
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] border-collapse text-sm">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 border-b bg-white px-3 py-2 text-left">Employee</th>
                  <th className="border-b bg-white px-3 py-2 text-right">Gross</th>
                  <th className="border-b bg-white px-3 py-2 text-right">
                    Base wage
                    <span title="Statutories are computed on Base wage only." className="ml-1 cursor-help text-xs text-gray-500">ⓘ</span>
                  </th>
                  <th colSpan={4} className="border-b bg-rose-50 px-3 py-2 text-center font-semibold text-rose-700">
                    Employee Deductions
                  </th>
                  <th className="border-b bg-white px-3 py-2 text-right">Net Pay</th>
                  <th colSpan={3} className="border-b bg-emerald-50 px-3 py-2 text-center font-semibold text-emerald-700">
                    Employer Contributions
                  </th>
                  <th className="border-b bg-white px-3 py-2 text-right">Employer Cost</th>
                  <th className="border-b bg-white px-3 py-2"></th>
                </tr>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-30 border-b px-3 py-2 text-left">Employee</th>
                  <th className="border-b px-3 py-2 text-right">Gross Wages</th>
                  <th className="border-b px-3 py-2 text-right">Base (Statutory)</th>
                  <th className="border-b bg-rose-50 px-3 py-2 text-right">EPF (Emp)</th>
                  <th className="border-b bg-rose-50 px-3 py-2 text-right">SOCSO (Emp)</th>
                  <th className="border-b bg-rose-50 px-3 py-2 text-right">EIS (Emp)</th>
                  <th className="border-b bg-rose-50 px-3 py-2 text-right">Manual</th>
                  <th className="border-b px-3 py-2 text-right">Net</th>
                  <th className="border-b bg-emerald-50 px-3 py-2 text-right">EPF (Er)</th>
                  <th className="border-b bg-emerald-50 px-3 py-2 text-right">SOCSO (Er)</th>
                  <th className="border-b bg-emerald-50 px-3 py-2 text-right">EIS (Er)</th>
                  <th className="border-b px-3 py-2 text-right">Total Cost</th>
                  <th className="border-b px-3 py-2"></th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((r) => {
                  const gross = n(r.total_earn);
                  const baseWage = n(r.base_wage);
                  const epfEmp = n(r.epf_emp);
                  const socsoEmp = n(r.socso_emp);
                  const eisEmp = n(r.eis_emp);
                  const manual = n(r.manual_deduct);
                  const net = n(r.net_pay);
                  const epfEr = n(r.epf_er);
                  const socsoEr = n(r.socso_er);
                  const eisEr = n(r.eis_er);
                  const employerCost = gross + epfEr + socsoEr + eisEr;
                  const abs = absentCnt[r.staff_email] || 0;
                  const isOpen = openDrawerFor === r.staff_email;

                  return (
                    <tr key={r.staff_email} className={isOpen ? 'bg-sky-50/40' : ''}>
                      <td className="sticky left-0 z-10 border-b bg-white px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{r.staff_name ?? r.staff_email}</div>
                          {abs > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">ABS {abs}</span>}
                          {manual > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">ADJ</span>}
                        </div>
                        <div className="text-xs text-gray-500">{r.staff_email}</div>
                      </td>
                      <td className="border-b px-3 py-2 text-right">{rm(gross)}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(baseWage)}</td>
                      <td className="border-b bg-rose-50 px-3 py-2 text-right">{rm(epfEmp)}</td>
                      <td className="border-b bg-rose-50 px-3 py-2 text-right">{rm(socsoEmp)}</td>
                      <td className="border-b bg-rose-50 px-3 py-2 text-right">{rm(eisEmp)}</td>
                      <td className="border-b bg-rose-50 px-3 py-2 text-right">{rm(manual)}</td>
                      <td className={`border-b px-3 py-2 text-right font-medium ${net < 0 ? 'text-rose-700' : ''}`}>{rm(net)}</td>
                      <td className="border-b bg-emerald-50 px-3 py-2 text-right">{rm(epfEr)}</td>
                      <td className="border-b bg-emerald-50 px-3 py-2 text-right">{rm(socsoEr)}</td>
                      <td className="border-b bg-emerald-50 px-3 py-2 text-right">{rm(eisEr)}</td>
                      <td className="border-b px-3 py-2 text-right">{rm(employerCost)}</td>
                      <td className="border-b px-3 py-2 text-right">
                        <button onClick={() => (isOpen ? closeDrawer() : openDrawer(r.staff_email))} className="rounded border px-3 py-1.5 hover:bg-gray-50">
                          {isOpen ? 'Close' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-gray-50 font-semibold">
                  <td className="sticky left-0 z-10 border-t px-3 py-2 text-right">Totals:</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.gross)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.baseWage)}</td>
                  <td className="border-t bg-rose-50 px-3 py-2 text-right">{rm(totals.epfEmp)}</td>
                  <td className="border-t bg-rose-50 px-3 py-2 text-right">{rm(totals.socsoEmp)}</td>
                  <td className="border-t bg-rose-50 px-3 py-2 text-right">{rm(totals.eisEmp)}</td>
                  <td className="border-t bg-rose-50 px-3 py-2 text-right">{rm(totals.manual)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.net)}</td>
                  <td className="border-t bg-emerald-50 px-3 py-2 text-right">{rm(totals.epfEr)}</td>
                  <td className="border-t bg-emerald-50 px-3 py-2 text-right">{rm(totals.socsoEr)}</td>
                  <td className="border-t bg-emerald-50 px-3 py-2 text-right">{rm(totals.eisEr)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.employerCost)}</td>
                  <td className="border-t px-3 py-2 text-right">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Right Drawer */}
      {openDrawerFor && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) closeDrawer(); }}>
          <div className="flex-1 bg-black/30" />
          <div className="h-full w-[480px] overflow-y-auto border-l bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Edit — {openDrawerFor}</div>
              <button onClick={closeDrawer} className="rounded border px-3 py-1.5 hover:bg-gray-50">Close</button>
            </div>

            {drawerLoading ? (
              <div className="text-sm text-gray-500">Loading editor…</div>
            ) : (
              <div className="grid gap-6">
                {/* Base (statutory) */}
                <div className="rounded border bg-white p-4">
                  <div className="mb-2 font-semibold">
                    Base wage <span className="align-middle text-xs text-gray-500">(EPF/SOCSO/EIS computed on this)</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <input
                      inputMode="decimal"
                      className="w-40 rounded border px-2 py-1 text-right"
                      placeholder="0.00"
                      value={baseInput[openDrawerFor] ?? ''}
                      onChange={(e) => setBaseInput(m => ({ ...m, [openDrawerFor]: e.target.value }))}
                    />
                    <button
                      onClick={() => saveBase(openDrawerFor)}
                      disabled={busy}
                      className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Save Base & Recalc
                    </button>
                  </div>
                </div>

                {/* Add Earn */}
                <div className="rounded border bg-white p-4">
                  <div className="mb-2 font-semibold">Add Earn</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600">Code</label>
                      <select
                        className="w-full rounded border px-2 py-1"
                        value={newEarn[openDrawerFor]?.codeSel ?? EARN_CODE_OPTIONS[0].value}
                        onChange={(e) => {
                          const sel = e.target.value;
                          setNewEarn(m => ({
                            ...m,
                            [openDrawerFor]: {
                              ...(m[openDrawerFor] ?? { codeSel: sel, code: '', label: '', amount: '' }),
                              codeSel: sel,
                              code: sel === '__CUSTOM__' ? '' : sel,
                            },
                          }));
                        }}
                      >
                        {EARN_CODE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      {newEarn[openDrawerFor]?.codeSel === '__CUSTOM__' && (
                        <input
                          className="mt-2 w-full rounded border px-2 py-1"
                          placeholder="Custom code (e.g., MISC)"
                          value={newEarn[openDrawerFor]?.code ?? ''}
                          onChange={(e) => setNewEarn(m => ({
                            ...m,
                            [openDrawerFor]: {
                              ...(m[openDrawerFor] ?? { codeSel: '__CUSTOM__', code: '', label: '', amount: '' }),
                              code: e.target.value,
                            },
                          }))}
                        />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Label</label>
                      <input
                        className="w-full rounded border px-2 py-1"
                        placeholder="Commission / Overtime"
                        value={newEarn[openDrawerFor]?.label ?? ''}
                        onChange={(e) => setNewEarn(m => ({
                          ...m,
                          [openDrawerFor]: {
                            ...(m[openDrawerFor] ?? { codeSel: EARN_CODE_OPTIONS[0].value, code: EARN_CODE_OPTIONS[0].value, label: '', amount: '' }),
                            label: e.target.value,
                          },
                        }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Amount (RM)</label>
                      <input
                        inputMode="decimal"
                        className="w-full rounded border px-2 py-1 text-right"
                        placeholder="0.00"
                        value={newEarn[openDrawerFor]?.amount ?? ''}
                        onChange={(e) => setNewEarn(m => ({
                          ...m,
                          [openDrawerFor]: {
                            ...(m[openDrawerFor] ?? { codeSel: EARN_CODE_OPTIONS[0].value, code: EARN_CODE_OPTIONS[0].value, label: '', amount: '' }),
                            amount: e.target.value,
                          },
                        }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <button onClick={() => addLine(openDrawerFor, 'EARN')} disabled={busy}
                      className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50">
                      Add Earn & Recalc
                    </button>
                  </div>
                </div>

                {/* Add Deduct */}
                <div className="rounded border bg-white p-4">
                  <div className="mb-2 font-semibold">Add Deduct</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600">Code</label>
                      <select
                        className="w-full rounded border px-2 py-1"
                        value={newDed[openDrawerFor]?.codeSel ?? DED_CODE_OPTIONS[0].value}
                        onChange={(e) => {
                          const sel = e.target.value;
                          setNewDed(m => ({
                            ...m,
                            [openDrawerFor]: {
                              ...(m[openDrawerFor] ?? { codeSel: sel, code: '', label: '', amount: '' }),
                              codeSel: sel,
                              code: sel === '__CUSTOM__' ? '' : sel,
                            },
                          }));
                        }}
                      >
                        {DED_CODE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      {newDed[openDrawerFor]?.codeSel === '__CUSTOM__' && (
                        <input
                          className="mt-2 w-full rounded border px-2 py-1"
                          placeholder="Custom code (e.g., D_MISC)"
                          value={newDed[openDrawerFor]?.code ?? ''}
                          onChange={(e) => setNewDed(m => ({
                            ...m,
                            [openDrawerFor]: {
                              ...(m[openDrawerFor] ?? { codeSel: '__CUSTOM__', code: '', label: '', amount: '' }),
                              code: e.target.value,
                            },
                          }))}
                        />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Label</label>
                      <input
                        className="w-full rounded border px-2 py-1"
                        placeholder="Unpaid Leave / Advance"
                        value={newDed[openDrawerFor]?.label ?? ''}
                        onChange={(e) => setNewDed(m => ({
                          ...m,
                          [openDrawerFor]: {
                            ...(m[openDrawerFor] ?? { codeSel: DED_CODE_OPTIONS[0].value, code: DED_CODE_OPTIONS[0].value, label: '', amount: '' }),
                            label: e.target.value,
                          },
                        }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600">Amount (RM)</label>
                      <input
                        inputMode="decimal"
                        className="w-full rounded border px-2 py-1 text-right"
                        placeholder="0.00"
                        value={newDed[openDrawerFor]?.amount ?? ''}
                        onChange={(e) => setNewDed(m => ({
                          ...m,
                          [openDrawerFor]: {
                            ...(m[openDrawerFor] ?? { codeSel: DED_CODE_OPTIONS[0].value, code: DED_CODE_OPTIONS[0].value, label: '', amount: '' }),
                            amount: e.target.value,
                          },
                        }))}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <button onClick={() => addLine(openDrawerFor, 'DEDUCT')} disabled={busy}
                      className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50">
                      Add Deduct & Recalc
                    </button>
                  </div>
                </div>

                {/* Current EARN lines */}
                <div className="rounded border bg-white p-4">
                  <div className="mb-2 font-semibold">Current EARN</div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          <th className="border-b px-2 py-1">Code</th>
                          <th className="border-b px-2 py-1">Label</th>
                          <th className="border-b px-2 py-1 text-right">Amount</th>
                          <th className="border-b px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(itemsEarn[openDrawerFor] ?? []).map((it) => (
                          <tr key={it.id}>
                            <td className="border-b px-2 py-1">{it.code}</td>
                            <td className="border-b px-2 py-1">{it.label}</td>
                            <td className="border-b px-2 py-1 text-right">{rm(n(it.amount))}</td>
                            <td className="border-b px-2 py-1 text-right">
                              <button onClick={() => deleteLine(it.id, openDrawerFor)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                        {(itemsEarn[openDrawerFor] ?? []).length === 0 && (
                          <tr><td className="px-2 py-2 text-sm text-gray-500" colSpan={4}>No EARN lines.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Current DEDUCT lines */}
                <div className="rounded border bg-white p-4">
                  <div className="mb-2 font-semibold">Current DEDUCT</div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          <th className="border-b px-2 py-1">Code</th>
                          <th className="border-b px-2 py-1">Label</th>
                          <th className="border-b px-2 py-1 text-right">Amount</th>
                          <th className="border-b px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(itemsDed[openDrawerFor] ?? []).map((it) => (
                          <tr key={it.id}>
                            <td className="border-b px-2 py-1">{it.code}</td>
                            <td className="border-b px-2 py-1">{it.label}</td>
                            <td className="border-b px-2 py-1 text-right">{rm(n(it.amount))}</td>
                            <td className="border-b px-2 py-1 text-right">
                              <button onClick={() => deleteLine(it.id, openDrawerFor)} className="rounded border px-2 py-1 text-xs hover:bg-gray-50">
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                        {(itemsDed[openDrawerFor] ?? []).length === 0 && (
                          <tr><td className="px-2 py-2 text-sm text-gray-500" colSpan={4}>No DEDUCT lines.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}