'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/* ---------- Types ---------- */
type StaffBrief = {
  display_name: string | null;
  email: string;
  salary_basic: number | null;
  position: string | null;
  start_date: string | null;
  year_join: number | null;
};

type StaffFull = {
  email: string;
  full_name: string | null;
  name: string | null;

  nationality: string | null;
  nric: string | null;
  dob: string | null;

  gender: 'Male' | 'Female' | null;
  race: 'Malay' | 'Chinese' | 'Indian' | 'Other' | null;
  ability_status: 'Non-disabled' | 'Disabled' | null;
  marital_status: 'Single' | 'Married' | 'Divorced/Widowed' | null;

  phone: string | null;
  address: string | null;

  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relationship: string | null;

  salary_payment_method: 'Cheque' | 'Bank Transfer' | 'Cash' | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;

  position: string | null;
  start_date: string | null;
  employment_end_date?: string | null;

  epf_no: string | null;
  socso_no: string | null;
  eis_no: string | null;

  basic_salary: number | null;

  is_admin?: boolean | null;

  // payroll flags
  archived_at?: string | null;
  include_in_payroll?: boolean | null;
  skip_payroll?: boolean | null; // DB trigger keeps this in sync
  salary_based_on_attendance?: boolean | null;

  epf_enabled?: boolean | null;
  socso_enabled?: boolean | null;
  eis_enabled?: boolean | null;
};

type NewEmployee = {
  email: string;
  full_name: string;
  position: string;
  start_date: string;
  basic_salary: string;
  is_admin: boolean;

  // new toggles
  archived: boolean;
  include_in_payroll: boolean;
  salary_based_on_attendance: boolean;
  epf_enabled: boolean;
  socso_enabled: boolean;
  eis_enabled: boolean;
};

const POSITION_OPTIONS = ['Manager', 'Supervisor', 'Mechanic', 'Admin', 'Temporary', 'Trainer'];

function rm(n?: number | null) {
  const v = Number(n ?? 0);
  return `RM ${v.toFixed(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export default function EmployeesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StaffBrief[]>([]);
  const [q, setQ] = useState('');

  // editor
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [model, setModel] = useState<StaffFull | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [editIsAdmin, setEditIsAdmin] = useState<boolean>(false);

  // NEW editor toggles
  const [editArchived, setEditArchived] = useState<boolean>(false);
  const [editIncludeInPayroll, setEditIncludeInPayroll] = useState<boolean>(true);
  const [editSalaryBasedOnAttendance, setEditSalaryBasedOnAttendance] = useState<boolean>(true);
  const [editEpfEnabled, setEditEpfEnabled] = useState<boolean>(true);
  const [editSocsoEnabled, setEditSocsoEnabled] = useState<boolean>(true);
  const [editEisEnabled, setEditEisEnabled] = useState<boolean>(true);

  // add employee drawer
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [newEmp, setNewEmp] = useState<NewEmployee>({
    email: '',
    full_name: '',
    position: '',
    start_date: today,
    basic_salary: '0.00',
    is_admin: false,

    archived: false,
    include_in_payroll: true,
    salary_based_on_attendance: true,
    epf_enabled: true,
    socso_enabled: true,
    eis_enabled: true,
  });

  // Auth + admin gate
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const ok = !!data.session;
      setAuthed(ok);

      if (ok) {
        const { data: adminFlag } = await supabase.rpc('is_admin');
        const adminOk = adminFlag === true;
        setIsAdmin(adminOk);
        if (!adminOk) {
          window.location.href = '/';
          return;
        }
      }

      const sub = supabase.auth.onAuthStateChange(async () => {
        const { data } = await supabase.auth.getSession();
        const ok2 = !!data.session;
        setAuthed(ok2);

        if (ok2) {
          const { data: adminFlag } = await supabase.rpc('is_admin');
          const adminOk = adminFlag === true;
          setIsAdmin(adminOk);
          if (!adminOk) {
            window.location.href = '/';
            return;
          }
        } else {
          setIsAdmin(false);
        }
      });

      cleanup = () => sub.data.subscription.unsubscribe();
    })();

    return () => cleanup && cleanup();
  }, []);

  const load = async () => {
    setLoading(true);
    setMsg(null);

    // Admin list via RPC
    const { data, error } = await supabase.rpc('get_staff_brief_active');

    if (error) {
      setMsg(`Load failed: ${error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const list = ((data ?? []) as StaffBrief[]).slice().sort((a, b) => {
      const an = (a.display_name ?? a.email).toLowerCase();
      const bn = (b.display_name ?? b.email).toLowerCase();
      return an.localeCompare(bn);
    });

    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    if (authed && isAdmin) load();
  }, [authed, isAdmin]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        (r.display_name ?? '').toLowerCase().includes(term) ||
        r.email.toLowerCase().includes(term) ||
        (r.position ?? '').toLowerCase().includes(term)
    );
  }, [rows, q]);

  const openEditor = async (email: string) => {
    if (!isAdmin) return;
    setMsg(null);
    setOpenEmail(email);

    const { data, error } = await supabase.from('staff').select('*').eq('email', email).maybeSingle();

    if (error) {
      setMsg(`Load employee failed: ${error.message}`);
      setModel(null);
      return;
    }

    const row = (data ?? null) as StaffFull | null;
    setModel(row);

    // Sync local toggles with DB row (coalesce for safety)
    setEditIsAdmin(!!row?.is_admin);
    setEditArchived(!!row?.archived_at);

    setEditIncludeInPayroll(row?.include_in_payroll ?? true);
    setEditSalaryBasedOnAttendance(row?.salary_based_on_attendance ?? true);

    setEditEpfEnabled(row?.epf_enabled ?? true);
    setEditSocsoEnabled(row?.socso_enabled ?? true);
    setEditEisEnabled(row?.eis_enabled ?? true);
  };

  const save = async () => {
    if (!model) return;
    if (!isAdmin) {
      setMsg('Not allowed.');
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const archived_at = editArchived ? (model.archived_at ?? nowIso()) : null;

      const payload: Partial<StaffFull> = {
        ...model,
        full_name: emptyToNull(model.full_name) ?? emptyToNull(model.name),
        nationality: emptyToNull(model.nationality),
        nric: emptyToNull(model.nric),
        dob: emptyToNull(model.dob),
        phone: emptyToNull(model.phone),
        address: emptyToNull(model.address),
        emergency_name: emptyToNull(model.emergency_name),
        emergency_phone: emptyToNull(model.emergency_phone),
        emergency_relationship: emptyToNull(model.emergency_relationship),
        salary_payment_method: emptyToNull(model.salary_payment_method),
        bank_name: emptyToNull(model.bank_name),
        bank_account_name: emptyToNull(model.bank_account_name),
        bank_account_no: emptyToNull(model.bank_account_no),
        position: emptyToNull(model.position),
        start_date: emptyToNull(model.start_date),
        employment_end_date: emptyToNull((model as any).employment_end_date),
        epf_no: emptyToNull(model.epf_no),
        socso_no: emptyToNull(model.socso_no),
        eis_no: emptyToNull(model.eis_no),

        is_admin: editIsAdmin,

        // NEW toggles
        archived_at,
        include_in_payroll: !!editIncludeInPayroll,
        salary_based_on_attendance: !!editSalaryBasedOnAttendance,
        epf_enabled: !!editEpfEnabled,
        socso_enabled: !!editSocsoEnabled,
        eis_enabled: !!editEisEnabled,
      };

      const { error: upErr } = await supabase.from('staff').update(payload).eq('email', model.email);
      if (upErr) throw upErr;

      // Recalc latest OPEN period (if any) so toggles reflect quickly
      const { data: period, error: perErr } = await supabase
        .schema('pay_v2')
        .from('periods')
        .select('year, month, status')
        .eq('status', 'OPEN')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (perErr) throw perErr;

      if (period?.year && period?.month) {
        const b = await supabase.schema('pay_v2').rpc('build_period', { p_year: period.year, p_month: period.month });
        // If build_period is admin-only, this should work because page is admin gated.
        if (b.error) {
          // fallback: at least sync base + stat
          const s1 = await supabase.schema('pay_v2').rpc('sync_base_items_respect_archive', {
            p_year: period.year,
            p_month: period.month,
          });
          if (s1.error) throw s1.error;

          const s2 = await supabase.schema('pay_v2').rpc('recalc_statutories_respect_temp', {
            p_year: period.year,
            p_month: period.month,
          });
          if (s2.error) throw s2.error;
        }
      }

      setMsg('Saved. Payroll flags updated.');
      await load();
    } catch (e: any) {
      setMsg(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    if (!isAdmin) return;
    setAddMsg(null);
    setNewEmp({
      email: '',
      full_name: '',
      position: '',
      start_date: today,
      basic_salary: '0.00',
      is_admin: false,

      archived: false,
      include_in_payroll: true,
      salary_based_on_attendance: true,
      epf_enabled: true,
      socso_enabled: true,
      eis_enabled: true,
    });
    setAddOpen(true);
  };

  const createEmployee = async () => {
    if (!isAdmin) {
      setAddMsg('Not allowed.');
      return;
    }

    setAddMsg(null);
    const email = newEmp.email.trim().toLowerCase();
    const name = newEmp.full_name.trim();
    const pos = newEmp.position || null;
    const start = newEmp.start_date || null;
    const salaryNum = Number(newEmp.basic_salary || 0);

    if (!email || !email.includes('@')) {
      setAddMsg('Please enter a valid email.');
      return;
    }
    if (!name) {
      setAddMsg('Please enter full name.');
      return;
    }

    setAdding(true);
    try {
      const payload: any = {
        email,
        full_name: name,
        position: pos,
        start_date: start,
        basic_salary: Number.isFinite(salaryNum) ? salaryNum : 0,

        archived_at: newEmp.archived ? nowIso() : null,
        employment_end_date: null,

        include_in_payroll: !!newEmp.include_in_payroll,
        salary_based_on_attendance: !!newEmp.salary_based_on_attendance,

        epf_enabled: !!newEmp.epf_enabled,
        socso_enabled: !!newEmp.socso_enabled,
        eis_enabled: !!newEmp.eis_enabled,

        is_admin: !!newEmp.is_admin,
      };

      const res = await supabase.from('staff').upsert(payload, { onConflict: 'email' }).select('email').maybeSingle();
      if (res.error) throw res.error;

      setAddMsg('Employee added.');
      setAddOpen(false);
      await load();
    } catch (e: any) {
      setAddMsg(`Add failed: ${e.message ?? e}`);
    } finally {
      setAdding(false);
    }
  };

  function closeEditor() {
    if (saving) return;
    setOpenEmail(null);
    setModel(null);
    setMsg(null);
  }

  if (authed === false) return <main className="mx-auto max-w-6xl p-6">Please sign in.</main>;
  if (authed === null || (authed && !isAdmin)) return <main className="mx-auto max-w-6xl p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Employees</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="rounded border px-3 py-2 w-72"
            placeholder="Search name / email / position"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="rounded bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700" onClick={openAdd}>
            + Add employee
          </button>
        </div>
      </header>

      {msg && <div className="mb-3 rounded border border-sky-200 bg-sky-50 p-2 text-sm text-sky-800">{msg}</div>}

      <section className="overflow-x-auto">
        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="border-b px-3 py-2">Name</th>
                <th className="border-b px-3 py-2">Email</th>
                <th className="border-b px-3 py-2 text-right">Basic Salary</th>
                <th className="border-b px-3 py-2">Position</th>
                <th className="border-b px-3 py-2">Year Join</th>
                <th className="border-b px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.email} className="hover:bg-gray-50">
                  <td className="border-b px-3 py-2">
                    <button className="text-sky-700 hover:underline" onClick={() => openEditor(r.email)}>
                      {r.display_name ?? r.email}
                    </button>
                  </td>
                  <td className="border-b px-3 py-2">{r.email}</td>
                  <td className="border-b px-3 py-2 text-right">{rm(r.salary_basic)}</td>
                  <td className="border-b px-3 py-2">{r.position ?? '—'}</td>
                  <td className="border-b px-3 py-2">{r.year_join ?? (r.start_date?.slice(0, 4) ?? '—')}</td>
                  <td className="border-b px-3 py-2 text-right">
                    <button className="rounded border px-3 py-1.5 hover:bg-gray-50" onClick={() => openEditor(r.email)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-600" colSpan={6}>
                    No employees.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* ---------- EDIT DRAWER ---------- */}
      {openEmail && model && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={(e) => e.target === e.currentTarget && closeEditor()}>
          <div className="absolute right-0 top-0 h-full w-[min(720px,92vw)] overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">Edit employee — {model.email}</div>
              <button className="rounded border px-2 py-1" onClick={closeEditor}>
                Close
              </button>
            </div>

            <div className="grid gap-6 p-4">
              {/* Access */}
              <Section title="Access">
                <div className="flex items-center gap-2">
                  <input id="admin-flag" type="checkbox" checked={editIsAdmin} onChange={(e) => setEditIsAdmin(e.target.checked)} />
                  <label htmlFor="admin-flag" className="text-sm">
                    Admin (can manage payroll, periods, employees)
                  </label>
                </div>
              </Section>

              {/* Employment status */}
              <Section title="Employment status">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      id="archived-flag"
                      type="checkbox"
                      checked={editArchived}
                      onChange={(e) => setEditArchived(e.target.checked)}
                    />
                    <label htmlFor="archived-flag" className="text-sm">
                      Archived / Resigned (removes from active employee list & payroll)
                    </label>
                  </div>
                  <div className="text-xs text-gray-500">
                    When checked, <code>archived_at</code> will be set. Uncheck to reactivate.
                  </div>
                </div>
              </Section>

              {/* Payroll & deductions */}
              <Section title="Payroll & deductions">
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <input
                      id="include-payroll"
                      type="checkbox"
                      checked={editIncludeInPayroll}
                      onChange={(e) => setEditIncludeInPayroll(e.target.checked)}
                    />
                    <label htmlFor="include-payroll" className="text-sm">
                      Include in Payroll page (and payslip)
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="salary-att"
                      type="checkbox"
                      checked={editSalaryBasedOnAttendance}
                      onChange={(e) => setEditSalaryBasedOnAttendance(e.target.checked)}
                    />
                    <label htmlFor="salary-att" className="text-sm">
                      Salary based on attendance (generate UNPAID deductions for absences)
                    </label>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editEpfEnabled} onChange={(e) => setEditEpfEnabled(e.target.checked)} />
                      EPF enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editSocsoEnabled} onChange={(e) => setEditSocsoEnabled(e.target.checked)} />
                      SOCSO enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editEisEnabled} onChange={(e) => setEditEisEnabled(e.target.checked)} />
                      EIS enabled
                    </label>
                  </div>

                  <div className="text-xs text-gray-500">
                    These flags must be respected by your payroll functions (statutory recalc + absent deductions).
                  </div>
                </div>
              </Section>

              {/* Personal */}
              <Section title="Personal information">
                <Grid2>
                  <Text label="Full name" value={model.full_name ?? model.name ?? ''} onChange={(v) => setModel((m) => ({ ...m!, full_name: v }))} />
                  <Text label="Nationality" value={model.nationality ?? ''} onChange={(v) => setModel((m) => ({ ...m!, nationality: v }))} />
                  <Text label="NRIC" value={model.nric ?? ''} onChange={(v) => setModel((m) => ({ ...m!, nric: v }))} />
                  <DateInput label="Date of birth" value={model.dob ?? ''} onChange={(v) => setModel((m) => ({ ...m!, dob: v }))} />
                  <Select label="Gender" value={model.gender ?? ''} onChange={(v) => setModel((m) => ({ ...m!, gender: (v || null) as any }))} options={['Male', 'Female']} />
                  <Select label="Race" value={model.race ?? ''} onChange={(v) => setModel((m) => ({ ...m!, race: (v || null) as any }))} options={['Malay', 'Chinese', 'Indian', 'Other']} />
                  <Select label="Ability status" value={model.ability_status ?? ''} onChange={(v) => setModel((m) => ({ ...m!, ability_status: (v || null) as any }))} options={['Non-disabled', 'Disabled']} />
                  <Select label="Marital status" value={model.marital_status ?? ''} onChange={(v) => setModel((m) => ({ ...m!, marital_status: (v || null) as any }))} options={['Single', 'Married', 'Divorced/Widowed']} />
                </Grid2>
              </Section>

              <Section title="Contact">
                <Grid2>
                  <Text label="Phone" value={model.phone ?? ''} onChange={(v) => setModel((m) => ({ ...m!, phone: v }))} />
                  <Text label="Address" value={model.address ?? ''} onChange={(v) => setModel((m) => ({ ...m!, address: v }))} />
                </Grid2>
              </Section>

              <Section title="Emergency contact">
                <Grid3>
                  <Text label="Name" value={model.emergency_name ?? ''} onChange={(v) => setModel((m) => ({ ...m!, emergency_name: v }))} />
                  <Text label="Phone" value={model.emergency_phone ?? ''} onChange={(v) => setModel((m) => ({ ...m!, emergency_phone: v }))} />
                  <Text label="Relationship" value={model.emergency_relationship ?? ''} onChange={(v) => setModel((m) => ({ ...m!, emergency_relationship: v }))} />
                </Grid3>
              </Section>

              <Section title="Salary payment">
                <Grid3>
                  <Select label="Method" value={model.salary_payment_method ?? ''} onChange={(v) => setModel((m) => ({ ...m!, salary_payment_method: (v || null) as any }))} options={['Cheque', 'Bank Transfer', 'Cash']} />
                  <Text label="Bank name" value={model.bank_name ?? ''} onChange={(v) => setModel((m) => ({ ...m!, bank_name: v }))} />
                  <Text label="Account holder" value={model.bank_account_name ?? ''} onChange={(v) => setModel((m) => ({ ...m!, bank_account_name: v }))} />
                  <Text label="Account no." value={model.bank_account_no ?? ''} onChange={(v) => setModel((m) => ({ ...m!, bank_account_no: v }))} />
                </Grid3>
              </Section>

              <Section title="Employment">
                <Grid3>
                  <Select label="Position" value={model.position ?? ''} onChange={(v) => setModel((m) => ({ ...m!, position: v }))} options={POSITION_OPTIONS} />
                  <DateInput label="Start date" value={model.start_date ?? ''} onChange={(v) => setModel((m) => ({ ...m!, start_date: v }))} />
                  <Money label="Basic salary" value={num(model.basic_salary)} onChange={(v) => setModel((m) => ({ ...m!, basic_salary: v }))} />
                </Grid3>
              </Section>

              <Section title="Statutory IDs">
                <Grid3>
                  <Text label="EPF No" value={model.epf_no ?? ''} onChange={(v) => setModel((m) => ({ ...m!, epf_no: v }))} />
                  <Text label="SOCSO No" value={model.socso_no ?? ''} onChange={(v) => setModel((m) => ({ ...m!, socso_no: v }))} />
                  <Text label="EIS No" value={model.eis_no ?? ''} onChange={(v) => setModel((m) => ({ ...m!, eis_no: v }))} />
                </Grid3>
              </Section>

              <div className="flex justify-end gap-2">
                <button className="rounded border px-3 py-2" onClick={closeEditor} disabled={saving}>
                  Cancel
                </button>
                <button
                  className="rounded bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-50"
                  onClick={save}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- ADD DRAWER ---------- */}
      {addOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={(e) => e.target === e.currentTarget && setAddOpen(false)}>
          <div className="absolute right-0 top-0 h-full w-[min(560px,92vw)] overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">Add employee</div>
              <button className="rounded border px-2 py-1" onClick={() => setAddOpen(false)}>
                Close
              </button>
            </div>

            <div className="grid gap-6 p-4">
              {addMsg && <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{addMsg}</div>}

              <Section title="Basic details">
                <Grid2>
                  <Text label="Email" value={newEmp.email} onChange={(v) => setNewEmp((e) => ({ ...e, email: v.toLowerCase() }))} />
                  <Text label="Full name" value={newEmp.full_name} onChange={(v) => setNewEmp((e) => ({ ...e, full_name: v }))} />
                  <Select label="Position" value={newEmp.position} onChange={(v) => setNewEmp((e) => ({ ...e, position: v }))} options={POSITION_OPTIONS} />
                  <DateInput label="Start date" value={newEmp.start_date} onChange={(v) => setNewEmp((e) => ({ ...e, start_date: v }))} />
                  <Money label="Basic salary" value={Number(newEmp.basic_salary)} onChange={(v) => setNewEmp((e) => ({ ...e, basic_salary: String(v) }))} />

                  <div className="flex items-center gap-2">
                    <input id="new-is-admin" type="checkbox" checked={newEmp.is_admin} onChange={(e) => setNewEmp((s) => ({ ...s, is_admin: e.target.checked }))} />
                    <label htmlFor="new-is-admin" className="text-sm">
                      Set as admin
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input id="new-archived" type="checkbox" checked={newEmp.archived} onChange={(e) => setNewEmp((s) => ({ ...s, archived: e.target.checked }))} />
                    <label htmlFor="new-archived" className="text-sm">
                      Archived / Resigned
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="new-include-payroll"
                      type="checkbox"
                      checked={newEmp.include_in_payroll}
                      onChange={(e) => setNewEmp((s) => ({ ...s, include_in_payroll: e.target.checked }))}
                    />
                    <label htmlFor="new-include-payroll" className="text-sm">
                      Include in payroll page
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="new-salary-att"
                      type="checkbox"
                      checked={newEmp.salary_based_on_attendance}
                      onChange={(e) => setNewEmp((s) => ({ ...s, salary_based_on_attendance: e.target.checked }))}
                    />
                    <label htmlFor="new-salary-att" className="text-sm">
                      Salary based on attendance
                    </label>
                  </div>

                  <div className="md:col-span-2 grid gap-2 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newEmp.epf_enabled}
                        onChange={(e) => setNewEmp((s) => ({ ...s, epf_enabled: e.target.checked }))}
                      />
                      EPF enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newEmp.socso_enabled}
                        onChange={(e) => setNewEmp((s) => ({ ...s, socso_enabled: e.target.checked }))}
                      />
                      SOCSO enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newEmp.eis_enabled}
                        onChange={(e) => setNewEmp((s) => ({ ...s, eis_enabled: e.target.checked }))}
                      />
                      EIS enabled
                    </label>
                  </div>
                </Grid2>
              </Section>

              <div className="flex justify-end gap-2">
                <button className="rounded border px-3 py-2" onClick={() => setAddOpen(false)} disabled={adding}>
                  Cancel
                </button>
                <button
                  className="rounded bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
                  onClick={createEmployee}
                  disabled={adding}
                >
                  {adding ? 'Adding…' : 'Add employee'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- tiny UI helpers ---------- */
function emptyToNull(v: any) {
  return v === '' ? null : v;
}
function num(v: any): number {
  return typeof v === 'number' ? v : v ? Number(v) : 0;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-white">
      <div className="border-b px-4 py-2 text-sm font-semibold">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}
function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>;
}
function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-3">{children}</div>;
}
function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input className="w-full rounded border px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input type="date" className="w-full rounded border px-2 py-1" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <select className="w-full rounded border px-2 py-1" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
function Money({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input
        inputMode="decimal"
        className="w-full rounded border px-2 py-1 text-right"
        value={Number.isFinite(value) ? String(value) : ''}
        onChange={(e) => onChange(Number(e.target.value || 0))}
        placeholder="0.00"
      />
    </div>
  );
}