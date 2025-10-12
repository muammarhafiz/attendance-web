'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Row = {
  year: number;
  month: number;
  staff_name: string | null;
  staff_email: string;
  total_earn: string | number;
  manual_deduct: string | number;
  epf_emp: string | number;
  socso_emp: string | number;
  eis_emp: string | number;
  epf_er: string | number;
  socso_er: string | number;
  eis_er: string | number;
  total_deduct: string | number;
  net_pay: string | number;
};

type Item = {
  id: string;
  kind: 'EARN' | 'DEDUCT' | string;
  code: string | null;
  label: string | null;
  amount: number;
};

function n(x: string | number | null | undefined) {
  const v = typeof x === 'string' ? Number(x) : x ?? 0;
  return Number.isFinite(v as number) ? (v as number) : 0;
}
function rm(x: number) {
  return `RM ${x.toFixed(2)}`;
}

// Dropdown choices
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

export default function AdminPayrollPage() {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1..12

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // NEW: divisor for absence → daily rate
  const [dayDivisor, setDayDivisor] = useState<number>(26);

  // Inline editor
  const [openEditorFor, setOpenEditorFor] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [itemsEarn, setItemsEarn] = useState<Record<string, Item[]>>({});
  const [itemsDed, setItemsDed] = useState<Record<string, Item[]>>({});
  const [baseInput, setBaseInput] = useState<Record<string, string>>({});

  // Add-line forms
  const [newEarn, setNewEarn] = useState<Record<string, { codeSel: string; code: string; label: string; amount: string }>>({});
  const [newDed, setNewDed] = useState<Record<string, { codeSel: string; code: string; label: string; amount: string }>>({});

  useEffect(() => {
  // set initial state from current session
  (async () => {
    const { data } = await supabase.auth.getSession();
    setAuthed(!!data.session);
  })();

  // subscribe to auth changes
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    setAuthed(!!session); // <-- session is Session | null
  });

  // cleanup
  return () => {
    sub.subscription.unsubscribe();
  };
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
    if (error) {
      setMsg(`Failed to read period: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
  };

  const loadSummary = async () => {
    setLoading(true);
    setMsg(null);

    const { data, error } = await supabase
      .schema('pay_v2')
      .from('v_payslip_admin_summary')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .order('staff_name', { ascending: true });

    if (error) {
      setMsg(`Failed to load: ${error.message}`);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (authed) loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, year, month]);

  const totals = useMemo(() => {
    const sum = (k: keyof Row) => rows.reduce((a, r) => a + n(r[k]), 0);
    const gross = sum('total_earn');
    const manual = sum('manual_deduct');
    const epfEmp = sum('epf_emp');
    const socsoEmp = sum('socso_emp');
    const eisEmp = sum('eis_emp');
    const epfEr = sum('epf_er');
    const socsoEr = sum('socso_er');
    const eisEr = sum('eis_er');
    const totalDeduct = sum('total_deduct');
    const net = sum('net_pay');
    const employerCost = gross + epfEr + socsoEr + eisEr;
    return { gross, manual, epfEmp, socsoEmp, eisEmp, epfEr, socsoEr, eisEr, totalDeduct, net, employerCost };
  }, [rows]);

  // ---------- NEW: sync absences from Report logic + recalc ----------
  const syncAbsences = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // 1) run sync (returns one row per affected staff)
      const { data: synced, error: syncErr } = await supabase
        .schema('pay_v2')
        .rpc('sync_absent_from_report', {
          p_year: year,
          p_month: month,
          p_day_divisor: dayDivisor,
        });

      if (syncErr) throw syncErr;

      const affected = Array.isArray(synced) ? synced.length : 0;

      // 2) recalc EPF/SOCSO/EIS
      const { error: recalcErr } = await supabase
        .schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });

      if (recalcErr) throw recalcErr;

      // 3) reload view
      await loadSummary();

      setMsg(`Synced absences from Report (divisor ${dayDivisor}). Updated ${affected} staff and recalculated statutories.`);
    } catch (e: any) {
      setMsg(`Sync absences failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  // ---------- inline editor (BASE + add/remove arbitrary items) -------------
  const openEditor = async (staff_email: string) => {
    setEditorLoading(true);
    setOpenEditorFor(staff_email);
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

      setItemsEarn((m) => ({ ...m, [staff_email]: earnLines as Item[] }));
      setItemsDed((m) => ({ ...m, [staff_email]: dedLines as Item[] }));

      // set BASE input
      const base = (earnLines as Item[]).find((x) => (x.code || '').toUpperCase() === 'BASE');
      setBaseInput((m) => ({ ...m, [staff_email]: base ? String(base.amount) : '' }));

      // reset add-line forms
      setNewEarn((m) => ({ ...m, [staff_email]: { codeSel: EARN_CODE_OPTIONS[0].value, code: EARN_CODE_OPTIONS[0].value, label: '', amount: '' } }));
      setNewDed((m) => ({ ...m, [staff_email]: { codeSel: DED_CODE_OPTIONS[0].value,  code: DED_CODE_OPTIONS[0].value,  label: '', amount: '' } }));
    } catch (e: any) {
      setMsg(`Editor load failed: ${e.message ?? e}`);
    } finally {
      setEditorLoading(false);
    }
  };

  const saveBase = async (staff_email: string) => {
    setBusy(true); setMsg(null);
    try {
      const period_id = await getPeriodId();
      if (!period_id) return;

      const desired = Number(baseInput[staff_email] ?? '0') || 0;

      // delete existing BASE lines
      await supabase.schema('pay_v2')
        .from('items')
        .delete()
        .eq('period_id', period_id)
        .eq('staff_email', staff_email)
        .eq('code', 'BASE');

      if (desired !== 0) {
        const { error } = await supabase.schema('pay_v2')
          .from('items')
          .insert({
            period_id,
            staff_email,
            kind: 'EARN',
            code: 'BASE',
            label: 'Base salary',
            amount: desired,
          });
        if (error) throw error;
      }

      // recalc
      const { error: recalcErr } = await supabase
        .schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });
      if (recalcErr) setMsg(`Recalc failed: ${recalcErr.message}`);
      else setMsg(`Base updated for ${staff_email}.`);

      await loadSummary();
      await openEditor(staff_email);
    } catch (e: any) {
      setMsg(`Save base failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const addLine = async (staff_email: string, kind: 'EARN' | 'DEDUCT') => {
    setBusy(true); setMsg(null);
    try {
      const period_id = await getPeriodId();
      if (!period_id) return;

      const src = kind === 'EARN' ? newEarn[staff_email] : newDed[staff_email];

      // Resolve code: dropdown or custom
      let code = (src?.codeSel || '').toUpperCase();
      if (code === '__CUSTOM__') {
        code = (src?.code || '').toUpperCase().trim();
      }
      const label = (src?.label || '').trim();
      const amt = Number(src?.amount || '0') || 0;

      if (!code || !label || amt <= 0) {
        setMsg('Please select/enter a code, provide a label, and a positive amount.');
        setBusy(false);
        return;
      }

      const { error } = await supabase.schema('pay_v2').from('items').insert({
        period_id,
        staff_email,
        kind,
        code,
        label,
        amount: amt,
      });
      if (error) throw error;

      // recalc
      const { error: recalcErr } = await supabase
        .schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });
      if (recalcErr) setMsg(`Recalc failed: ${recalcErr.message}`);

      await loadSummary();
      await openEditor(staff_email);
    } catch (e: any) {
      setMsg(`Add line failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteLine = async (id: string, staff_email: string) => {
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.schema('pay_v2').from('items').delete().eq('id', id);
      if (error) throw error;

      const { error: recalcErr } = await supabase
        .schema('pay_v2')
        .rpc('recalc_statutories', { p_year: year, p_month: month });
      if (recalcErr) setMsg(`Recalc failed: ${recalcErr.message}`);

      await loadSummary();
      await openEditor(staff_email);
    } catch (e: any) {
      setMsg(`Delete failed: ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  if (authed === false) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Payroll</h1>
        <p className="text-sm text-gray-600">Please sign in to access Payroll.</p>
      </main>
    );
  }
  if (authed === null) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="text-sm text-gray-600">Checking session…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payroll – Admin summary</h1>
          <p className="text-sm text-gray-500">Period {yyyymm}</p>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              min={2020} max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Month</label>
            <input
              type="number"
              className="rounded border px-2 py-1"
              min={1} max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            />
          </div>

          {/* NEW: day divisor input */}
          <div>
            <label className="block text-xs font-medium text-gray-600">Day divisor</label>
            <input
              type="number"
              className="w-24 rounded border px-2 py-1"
              min={1} max={31}
              value={dayDivisor}
              onChange={(e) => setDayDivisor(Math.max(1, Math.min(31, Number(e.target.value || 26))))}
            />
          </div>

          <button
            onClick={loadSummary}
            disabled={loading || busy}
            className="rounded border px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>

          {/* NEW: Sync absences button */}
          <button
            onClick={syncAbsences}
            disabled={loading || busy}
            className="rounded bg-sky-600 px-3 py-1.5 text-white hover:bg-sky-700 disabled:opacity-50"
            title="Insert/refresh UNPAID (ABSENT) using the Report rules, then recalc EPF/SOCSO/EIS"
          >
            {busy ? 'Syncing…' : 'Sync Absences (from Report)'}
          </button>
        </div>
      </header>

      {msg && (
        <div className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {msg}
        </div>
      )}

      <section>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No data for this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b px-3 py-2 align-bottom bg-white text-left">Employee</th>
                  <th colSpan={1} className="border-b px-3 py-2 align-bottom bg-white text-right">Gross</th>
                  <th colSpan={4} className="border-b px-3 py-2 bg-rose-50 text-rose-700 text-center font-semibold">
                    Employee Deductions
                  </th>
                  <th className="border-b px-3 py-2 align-bottom bg-white text-right">Net Pay</th>
                  <th colSpan={3} className="border-b px-3 py-2 bg-emerald-50 text-emerald-700 text-center font-semibold">
                    Employer Contributions
                  </th>
                  <th className="border-b px-3 py-2 align-bottom bg-white text-right">Employer Cost</th>
                  <th className="border-b px-3 py-2 align-bottom bg-white text-right">Actions</th>
                </tr>
                <tr className="bg-gray-50 text-left">
                  <th className="border-b px-3 py-2">Employee</th>
                  <th className="border-b px-3 py-2 text-right">Gross Wages</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">EPF (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">SOCSO (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">EIS (Emp)</th>
                  <th className="border-b px-3 py-2 text-right bg-rose-50">Manual Deduct</th>
                  <th className="border-b px-3 py-2 text-right">Net</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">EPF (Er)</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">SOCSO (Er)</th>
                  <th className="border-b px-3 py-2 text-right bg-emerald-50">EIS (Er)</th>
                  <th className="border-b px-3 py-2 text-right">Total Cost</th>
                  <th className="border-b px-3 py-2"></th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const gross = n(r.total_earn);
                  const epfEmp = n(r.epf_emp);
                  const socsoEmp = n(r.socso_emp);
                  const eisEmp = n(r.eis_emp);
                  const manual = n(r.manual_deduct);
                  const net = n(r.net_pay);

                  const epfEr = n(r.epf_er);
                  const socsoEr = n(r.socso_er);
                  const eisEr = n(r.eis_er);
                  const employerCost = gross + epfEr + socsoEr + eisEr;

                  const isOpen = openEditorFor === r.staff_email;

                  return (
                    <>
                      <tr key={r.staff_email}>
                        <td className="border-b px-3 py-2">{r.staff_name ?? r.staff_email}</td>
                        <td className="border-b px-3 py-2 text-right">{rm(gross)}</td>
                        <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(epfEmp)}</td>
                        <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(socsoEmp)}</td>
                        <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(eisEmp)}</td>
                        <td className="border-b px-3 py-2 text-right bg-rose-50">{rm(manual)}</td>
                        <td className="border-b px-3 py-2 text-right font-medium">{rm(net)}</td>
                        <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(epfEr)}</td>
                        <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(socsoEr)}</td>
                        <td className="border-b px-3 py-2 text-right bg-emerald-50">{rm(eisEr)}</td>
                        <td className="border-b px-3 py-2 text-right">{rm(employerCost)}</td>
                        <td className="border-b px-3 py-2 text-right">
                          <button
                            onClick={() => (isOpen ? setOpenEditorFor(null) : openEditor(r.staff_email))}
                            className="rounded border px-3 py-1.5 hover:bg-gray-50"
                          >
                            {isOpen ? 'Close' : 'Edit'}
                          </button>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr key={r.staff_email + ':editor'}>
                          <td colSpan={12} className="bg-gray-50 p-4">
                            {editorLoading ? (
                              <div className="text-sm text-gray-500">Loading editor…</div>
                            ) : (
                              <div className="grid gap-6 md:grid-cols-2">
                                {/* BASE editor */}
                                <div className="rounded border bg-white p-4">
                                  <h3 className="mb-3 font-semibold">Base (Gross component)</h3>
                                  <div className="flex items-end gap-3">
                                    <div>
                                      <label className="block text-xs text-gray-600">BASE amount (RM)</label>
                                      <input
                                        inputMode="decimal"
                                        className="w-40 rounded border px-2 py-1 text-right"
                                        placeholder="0.00"
                                        value={baseInput[r.staff_email] ?? ''}
                                        onChange={(e) =>
                                          setBaseInput((m) => ({ ...m, [r.staff_email]: e.target.value }))
                                        }
                                      />
                                    </div>
                                    <button
                                      onClick={() => saveBase(r.staff_email)}
                                      disabled={busy}
                                      className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      Save Base
                                    </button>
                                  </div>
                                  <p className="mt-2 text-xs text-gray-500">
                                    Gross wages = sum of all <b>EARN</b> lines (BASE + OT + COMM + etc).
                                  </p>
                                </div>

                                {/* Add Earn */}
                                <div className="rounded border bg-white p-4">
                                  <h3 className="mb-3 font-semibold">Add Earn line</h3>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div>
                                      <label className="block text-xs text-gray-600">Code</label>
                                      <select
                                        className="w-full rounded border px-2 py-1"
                                        value={newEarn[r.staff_email]?.codeSel ?? EARN_CODE_OPTIONS[0].value}
                                        onChange={(e) => {
                                          const sel = e.target.value;
                                          setNewEarn((m) => ({
                                            ...m,
                                            [r.staff_email]: {
                                              ...(m[r.staff_email] ?? { codeSel: sel, code: '', label: '', amount: '' }),
                                              codeSel: sel,
                                              code: sel === '__CUSTOM__' ? '' : sel,
                                            },
                                          }));
                                        }}
                                      >
                                        {EARN_CODE_OPTIONS.map((opt) => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                      {newEarn[r.staff_email]?.codeSel === '__CUSTOM__' && (
                                        <input
                                          className="mt-2 w-full rounded border px-2 py-1"
                                          placeholder="Custom code (e.g., MISC)"
                                          value={newEarn[r.staff_email]?.code ?? ''}
                                          onChange={(e) =>
                                            setNewEarn((m) => ({
                                              ...m,
                                              [r.staff_email]: {
                                                ...(m[r.staff_email] ?? { codeSel: '__CUSTOM__', code: '', label: '', amount: '' }),
                                                code: e.target.value,
                                              },
                                            }))
                                          }
                                        />
                                      )}
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600">Label</label>
                                      <input
                                        className="w-full rounded border px-2 py-1"
                                        placeholder="Commission / Overtime"
                                        value={newEarn[r.staff_email]?.label ?? ''}
                                        onChange={(e) =>
                                          setNewEarn((m) => ({
                                            ...m,
                                            [r.staff_email]: {
                                              ...(m[r.staff_email] ?? { codeSel: EARN_CODE_OPTIONS[0].value, code: EARN_CODE_OPTIONS[0].value, label: '', amount: '' }),
                                              label: e.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600">Amount (RM)</label>
                                      <input
                                        inputMode="decimal"
                                        className="w-full rounded border px-2 py-1 text-right"
                                        placeholder="0.00"
                                        value={newEarn[r.staff_email]?.amount ?? ''}
                                        onChange={(e) =>
                                          setNewEarn((m) => ({
                                            ...m,
                                            [r.staff_email]: {
                                              ...(m[r.staff_email] ?? { codeSel: EARN_CODE_OPTIONS[0].value, code: EARN_CODE_OPTIONS[0].value, label: '', amount: '' }),
                                              amount: e.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                  <div className="mt-3">
                                    <button
                                      onClick={() => addLine(r.staff_email, 'EARN')}
                                      disabled={busy}
                                      className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      Add Earn
                                    </button>
                                  </div>
                                </div>

                                {/* Add Deduct */}
                                <div className="rounded border bg-white p-4">
                                  <h3 className="mb-3 font-semibold">Add Deduct line</h3>
                                  <div className="grid grid-cols-3 gap-2">
                                    <div>
                                      <label className="block text-xs text-gray-600">Code</label>
                                      <select
                                        className="w-full rounded border px-2 py-1"
                                        value={newDed[r.staff_email]?.codeSel ?? DED_CODE_OPTIONS[0].value}
                                        onChange={(e) => {
                                          const sel = e.target.value;
                                          setNewDed((m) => ({
                                            ...m,
                                            [r.staff_email]: {
                                              ...(m[r.staff_email] ?? { codeSel: sel, code: '', label: '', amount: '' }),
                                              codeSel: sel,
                                              code: sel === '__CUSTOM__' ? '' : sel,
                                            },
                                          }));
                                        }}
                                      >
                                        {DED_CODE_OPTIONS.map((opt) => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                      {newDed[r.staff_email]?.codeSel === '__CUSTOM__' && (
                                        <input
                                          className="mt-2 w-full rounded border px-2 py-1"
                                          placeholder="Custom code (e.g., D_MISC)"
                                          value={newDed[r.staff_email]?.code ?? ''}
                                          onChange={(e) =>
                                            setNewDed((m) => ({
                                              ...m,
                                              [r.staff_email]: {
                                                ...(m[r.staff_email] ?? { codeSel: '__CUSTOM__', code: '', label: '', amount: '' }),
                                                code: e.target.value,
                                              },
                                            }))
                                          }
                                        />
                                      )}
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600">Label</label>
                                      <input
                                        className="w-full rounded border px-2 py-1"
                                        placeholder="Unpaid Leave / Advance"
                                        value={newDed[r.staff_email]?.label ?? ''}
                                        onChange={(e) =>
                                          setNewDed((m) => ({
                                            ...m,
                                            [r.staff_email]: {
                                              ...(m[r.staff_email] ?? { codeSel: DED_CODE_OPTIONS[0].value, code: DED_CODE_OPTIONS[0].value, label: '', amount: '' }),
                                              label: e.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600">Amount (RM)</label>
                                      <input
                                        inputMode="decimal"
                                        className="w-full rounded border px-2 py-1 text-right"
                                        placeholder="0.00"
                                        value={newDed[r.staff_email]?.amount ?? ''}
                                        onChange={(e) =>
                                          setNewDed((m) => ({
                                            ...m,
                                            [r.staff_email]: {
                                              ...(m[r.staff_email] ?? { codeSel: DED_CODE_OPTIONS[0].value, code: DED_CODE_OPTIONS[0].value, label: '', amount: '' }),
                                              amount: e.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                  <div className="mt-3">
                                    <button
                                      onClick={() => addLine(r.staff_email, 'DEDUCT')}
                                      disabled={busy}
                                      className="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50"
                                    >
                                      Add Deduct
                                    </button>
                                  </div>
                                </div>

                                {/* Current EARN lines */}
                                <div className="rounded border bg-white p-4">
                                  <h3 className="mb-3 font-semibold">Current EARN lines</h3>
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
                                        {(itemsEarn[r.staff_email] ?? []).map((it) => (
                                          <tr key={it.id}>
                                            <td className="border-b px-2 py-1">{it.code}</td>
                                            <td className="border-b px-2 py-1">{it.label}</td>
                                            <td className="border-b px-2 py-1 text-right">{rm(n(it.amount))}</td>
                                            <td className="border-b px-2 py-1 text-right">
                                              <button
                                                onClick={() => deleteLine(it.id, r.staff_email)}
                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                              >
                                                Delete
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                        {(itemsEarn[r.staff_email] ?? []).length === 0 && (
                                          <tr><td className="px-2 py-2 text-sm text-gray-500" colSpan={4}>No EARN lines.</td></tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* Current DEDUCT lines */}
                                <div className="rounded border bg-white p-4">
                                  <h3 className="mb-3 font-semibold">Current DEDUCT lines</h3>
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
                                        {(itemsDed[r.staff_email] ?? []).map((it) => (
                                          <tr key={it.id}>
                                            <td className="border-b px-2 py-1">{it.code}</td>
                                            <td className="border-b px-2 py-1">{it.label}</td>
                                            <td className="border-b px-2 py-1 text-right">{rm(n(it.amount))}</td>
                                            <td className="border-b px-2 py-1 text-right">
                                              <button
                                                onClick={() => deleteLine(it.id, r.staff_email)}
                                                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                              >
                                                Delete
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                        {(itemsDed[r.staff_email] ?? []).length === 0 && (
                                          <tr><td className="px-2 py-2 text-sm text-gray-500" colSpan={4}>No DEDUCT lines.</td></tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>

              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td className="border-t px-3 py-2 text-right">Totals:</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.gross)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.epfEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.socsoEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.eisEmp)}</td>
                  <td className="border-t px-3 py-2 text-right bg-rose-50">{rm(totals.manual)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.net)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.epfEr)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.socsoEr)}</td>
                  <td className="border-t px-3 py-2 text-right bg-emerald-50">{rm(totals.eisEr)}</td>
                  <td className="border-t px-3 py-2 text-right">{rm(totals.employerCost)}</td>
                  <td className="border-t px-3 py-2 text-right">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}