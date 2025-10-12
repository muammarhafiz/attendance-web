'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type StaffBrief = {
  display_name: string | null;
  email: string;
  salary_basic: number | null;   // from v_staff_brief (public.staff.basic_salary)
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
  epf_no: string | null;
  socso_no: string | null;
  eis_no: string | null;

  basic_salary: number | null;   // << single salary field
};

function rm(n?: number | null) {
  const v = Number(n ?? 0);
  return `RM ${v.toFixed(2)}`;
}

export default function EmployeesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StaffBrief[]>([]);
  const [q, setQ] = useState('');

  // editor
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [model, setModel] = useState<StaffFull | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      const sub = supabase.auth.onAuthStateChange(() => {
        supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
      });
      cleanup = () => sub.data.subscription.unsubscribe();
    })();
    return () => cleanup && cleanup();
  }, []);

  const load = async () => {
    setLoading(true);
    setMsg(null);
    const { data, error } = await supabase
      .from('v_staff_brief')
      .select('*')
      .order('display_name', { ascending: true });
    if (error) setMsg(`Load failed: ${error.message}`);
    setRows((data ?? []) as StaffBrief[]);
    setLoading(false);
  };

  useEffect(() => { if (authed) load(); }, [authed]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r =>
      (r.display_name ?? '').toLowerCase().includes(term) ||
      r.email.toLowerCase().includes(term) ||
      (r.position ?? '').toLowerCase().includes(term)
    );
  }, [rows, q]);

  const openEditor = async (email: string) => {
    setMsg(null);
    setOpenEmail(email);
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) { setMsg(`Load employee failed: ${error.message}`); setModel(null); return; }
    const row = data as StaffFull;
    setModel(row);
  };

  const save = async () => {
    if (!model) return;
    setSaving(true); setMsg(null);
    try {
      // Normalize whitespace → nulls where appropriate
      const payload = {
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
        epf_no: emptyToNull(model.epf_no),
        socso_no: emptyToNull(model.socso_no),
        eis_no: emptyToNull(model.eis_no),
        // basic_salary is kept as number; allow 0 too
      };

      // 1) Save to staff (single source of truth)
      const { error: upErr } = await supabase
        .from('staff')
        .update(payload)
        .eq('email', model.email);
      if (upErr) throw upErr;

      // 2) Find current (latest) payroll period
      const { data: period, error: perErr } = await supabase
        .schema('pay_v2')
        .from('periods')
        .select('year, month')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (perErr) throw perErr;

      if (period?.year && period?.month) {
        // 3) Sync BASE items from staff.basic_salary for that period
        const { error: syncErr } = await supabase
          .schema('pay_v2')
          .rpc('sync_base_items', { p_year: period.year, p_month: period.month });
        if (syncErr) throw syncErr;

        // 4) Recompute EPF/SOCSO/EIS (BASE-only)
        const { error: recalcErr } = await supabase
          .schema('pay_v2')
          .rpc('recalc_statutories', { p_year: period.year, p_month: period.month });
        if (recalcErr) throw recalcErr;
      }

      setMsg('Saved and payroll updated.');
      await load();
    } catch (e: any) {
      setMsg(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  function closeEditor() {
    if (saving) return;
    setOpenEmail(null);
    setModel(null);
    setMsg(null);
  }

  if (authed === false) {
    return <main className="mx-auto max-w-6xl p-6">Please sign in.</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Employees</h1>
        <div className="ml-auto">
          <input
            className="rounded border px-3 py-2 w-72"
            placeholder="Search name / email / position"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
              {filtered.map(r => (
                <tr key={r.email} className="hover:bg-gray-50">
                  <td className="border-b px-3 py-2">
                    <button className="text-sky-700 hover:underline" onClick={() => openEditor(r.email)}>
                      {r.display_name ?? r.email}
                    </button>
                  </td>
                  <td className="border-b px-3 py-2">{r.email}</td>
                  <td className="border-b px-3 py-2 text-right">{rm(r.salary_basic)}</td>
                  <td className="border-b px-3 py-2">{r.position ?? '—'}</td>
                  <td className="border-b px-3 py-2">{r.year_join ?? (r.start_date?.slice(0,4) ?? '—')}</td>
                  <td className="border-b px-3 py-2 text-right">
                    <button className="rounded border px-3 py-1.5 hover:bg-gray-50" onClick={() => openEditor(r.email)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td className="px-3 py-4 text-gray-600" colSpan={6}>No employees.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {/* Drawer / Modal editor */}
      {openEmail && model && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) closeEditor(); }}>
          <div className="absolute right-0 top-0 h-full w-[min(720px,92vw)] overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-semibold">Edit employee — {model.email}</div>
              <button className="rounded border px-2 py-1" onClick={closeEditor}>Close</button>
            </div>

            <div className="grid gap-6 p-4">
              {/* Personal */}
              <Section title="Personal information">
                <Grid2>
                  <Text label="Full name" value={model.full_name ?? model.name ?? ''} onChange={v => setModel(m => ({...m!, full_name: v}))} />
                  <Text label="Nationality" value={model.nationality ?? ''} onChange={v => setModel(m => ({...m!, nationality: v}))} />
                  <Text label="NRIC" value={model.nric ?? ''} onChange={v => setModel(m => ({...m!, nric: v}))} />
                  <DateInput label="Date of birth" value={model.dob ?? ''} onChange={v => setModel(m => ({...m!, dob: v}))} />
                  <Select label="Gender" value={model.gender ?? ''} onChange={v => setModel(m => ({...m!, gender: (v||null) as any}))}
                          options={['Male','Female']} />
                  <Select label="Race" value={model.race ?? ''} onChange={v => setModel(m => ({...m!, race: (v||null) as any}))}
                          options={['Malay','Chinese','Indian','Other']} />
                  <Select label="Ability status" value={model.ability_status ?? ''} onChange={v => setModel(m => ({...m!, ability_status: (v||null) as any}))}
                          options={['Non-disabled','Disabled']} />
                  <Select label="Marital status" value={model.marital_status ?? ''} onChange={v => setModel(m => ({...m!, marital_status: (v||null) as any}))}
                          options={['Single','Married','Divorced/Widowed']} />
                </Grid2>
              </Section>

              {/* Contacts */}
              <Section title="Contact">
                <Grid2>
                  <Text label="Phone" value={model.phone ?? ''} onChange={v => setModel(m => ({...m!, phone: v}))} />
                  <Text label="Address" value={model.address ?? ''} onChange={v => setModel(m => ({...m!, address: v}))} />
                </Grid2>
              </Section>

              {/* Emergency */}
              <Section title="Emergency contact">
                <Grid3>
                  <Text label="Name" value={model.emergency_name ?? ''} onChange={v => setModel(m => ({...m!, emergency_name: v}))} />
                  <Text label="Phone" value={model.emergency_phone ?? ''} onChange={v => setModel(m => ({...m!, emergency_phone: v}))} />
                  <Text label="Relationship" value={model.emergency_relationship ?? ''} onChange={v => setModel(m => ({...m!, emergency_relationship: v}))} />
                </Grid3>
              </Section>

              {/* Payment */}
              <Section title="Salary payment">
                <Grid3>
                  <Select label="Method" value={model.salary_payment_method ?? ''} onChange={v => setModel(m => ({...m!, salary_payment_method: (v||null) as any}))}
                          options={['Cheque','Bank Transfer','Cash']} />
                  <Text label="Bank name" value={model.bank_name ?? ''} onChange={v => setModel(m => ({...m!, bank_name: v}))} />
                  <Text label="Account holder" value={model.bank_account_name ?? ''} onChange={v => setModel(m => ({...m!, bank_account_name: v}))} />
                  <Text label="Account no." value={model.bank_account_no ?? ''} onChange={v => setModel(m => ({...m!, bank_account_no: v}))} />
                </Grid3>
              </Section>

              {/* Employment */}
              <Section title="Employment">
                <Grid3>
                  <Text label="Position" value={model.position ?? ''} onChange={v => setModel(m => ({...m!, position: v}))} />
                  <DateInput label="Start date" value={model.start_date ?? ''} onChange={v => setModel(m => ({...m!, start_date: v}))} />
                  <Money label="Basic salary" value={num(model.basic_salary)} onChange={v => setModel(m => ({...m!, basic_salary: v}))} />
                </Grid3>
              </Section>

              {/* Statutory IDs */}
              <Section title="Statutory IDs">
                <Grid3>
                  <Text label="EPF No" value={model.epf_no ?? ''} onChange={v => setModel(m => ({...m!, epf_no: v}))} />
                  <Text label="SOCSO No" value={model.socso_no ?? ''} onChange={v => setModel(m => ({...m!, socso_no: v}))} />
                  <Text label="EIS No" value={model.eis_no ?? ''} onChange={v => setModel(m => ({...m!, eis_no: v}))} />
                </Grid3>
              </Section>

              <div className="flex justify-end gap-2">
                <button className="rounded border px-3 py-2" onClick={closeEditor} disabled={saving}>Cancel</button>
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
    </main>
  );
}

/* ---------- tiny UI helpers ---------- */
function emptyToNull(v: any) { return v === '' ? null : v; }
function num(v: any): number { return typeof v === 'number' ? v : (v ? Number(v) : 0); }

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
function Text({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input className="w-full rounded border px-2 py-1" value={value} onChange={e=>onChange(e.target.value)} />
    </div>
  );
}
function DateInput({ label, value, onChange }: { label:string; value:string; onChange:(v:string)=>void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input type="date" className="w-full rounded border px-2 py-1"
             value={value || ''} onChange={e=>onChange(e.target.value)} />
    </div>
  );
}
function Select({ label, value, options, onChange }:{
  label:string; value:string; options:string[]; onChange:(v:string)=>void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <select className="w-full rounded border px-2 py-1" value={value || ''} onChange={e=>onChange(e.target.value)}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Money({ label, value, onChange }:{ label:string; value:number; onChange:(v:number)=>void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input
        inputMode="decimal"
        className="w-full rounded border px-2 py-1 text-right"
        value={Number.isFinite(value) ? String(value) : ''}
        onChange={(e)=>onChange(Number(e.target.value || 0))}
        placeholder="0.00"
      />
    </div>
  );
}