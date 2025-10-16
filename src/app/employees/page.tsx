'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

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
  epf_no: string | null;
  socso_no: string | null;
  eis_no: string | null;

  basic_salary: number | null;
};

function rm(n?: number | null) {
  const v = Number(n ?? 0);
  return `RM ${v.toFixed(2)}`;
}

/* ======== constants / options ======== */
const POSITION_OPTIONS = ['Manager', 'Supervisor', 'Mechanic', 'Admin'] as const;
const RELATIONSHIP_OPTIONS = ['Sibling', 'Spouse', 'Parents'] as const;
const MALAYSIA_BANKS = [
  'Maybank',
  'CIMB',
  'Public Bank',
  'RHB',
  'Hong Leong Bank',
  'AmBank',
  'Bank Islam',
  'Bank Rakyat',
  'UOB',
  'OCBC',
  'HSBC',
  'Standard Chartered',
  'Affin Bank',
  'Alliance Bank',
];

/* Parse NRIC -> DOB (YYYY-MM-DD). YY 00–24 => 2000s, else 1900s. */
function dobFromNric(nric: string): string | null {
  const m = nric.replace(/\D/g, '').match(/^(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [_, yy, mm, dd] = m;
  const year2 = Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = year2 <= 24 ? 2000 + year2 : 1900 + year2;
  const mmPad = String(month).padStart(2, '0');
  const ddPad = String(day).padStart(2, '0');
  return `${year}-${mmPad}-${ddPad}`;
}

/* Convert YYYY-MM to YYYY-MM-01 for DB date */
function monthToDate(val: string | null): string | null {
  if (!val) return null;
  if (!/^\d{4}-\d{2}$/.test(val)) return null;
  return `${val}-01`;
}

/* Extract YYYY-MM from YYYY-MM-DD (or return '') */
function dateToMonth(val: string | null): string {
  if (!val) return '';
  const m = val.match(/^(\d{4}-\d{2})-\d{2}$/);
  return m ? m[1] : '';
}

/* tiny helpers */
function emptyToNull(v: any) { return v === '' ? null : v; }
function num(v: any): number { return typeof v === 'number' ? v : (v ? Number(v) : 0); }

/* ---------- UI wrappers ---------- */
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
function Text({ label, value, onChange, type = 'text' }:{
  label:string; value:string; onChange:(v:string)=>void; type?:string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input type={type} className="w-full rounded border px-2 py-1" value={value} onChange={e=>onChange(e.target.value)} />
    </div>
  );
}
function DateInput({ label, value, onChange }:{ label:string; value:string; onChange:(v:string)=>void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input type="date" className="w-full rounded border px-2 py-1" value={value || ''} onChange={e=>onChange(e.target.value)} />
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
/* Month/year input (stores YYYY-MM; caller converts to date) */
function MonthInput({ label, value, onChange }:{
  label:string; value:string; onChange:(v:string)=>void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      <input type="month" className="w-full rounded border px-2 py-1"
             value={value || ''} onChange={(e)=>onChange(e.target.value || '')}/>
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

export default function EmployeesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StaffBrief[]>([]);
  const [q, setQ] = useState('');

  // editor
  const [openEmail, setOpenEmail] = useState<string | null>(null); // 'NEW' for create
  const [model, setModel] = useState<StaffFull | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // helpers for “Other + textbox”
  const [natChoice, setNatChoice] = useState<'Malaysia' | 'Other' | ''>('');
  const [natOther, setNatOther] = useState('');
  const [relChoice, setRelChoice] = useState<'Sibling' | 'Spouse' | 'Parents' | 'Other' | ''>('');
  const [relOther, setRelOther] = useState('');
  const [bankChoice, setBankChoice] = useState<string | ''>('');
  const [bankOther, setBankOther] = useState('');

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

  const isNew = openEmail === 'NEW';

  const openCreate = () => {
    setMsg(null);
    setOpenEmail('NEW');
    const blank: StaffFull = {
      email: '',
      full_name: '',
      name: '',

      nationality: null,
      nric: '',
      dob: '',

      gender: null,
      race: null,
      ability_status: null,
      marital_status: null,

      phone: '',
      address: '',

      emergency_name: '',
      emergency_phone: '',
      emergency_relationship: null,

      salary_payment_method: null,
      bank_name: null,
      bank_account_name: '',
      bank_account_no: '',

      position: '',
      start_date: null,
      epf_no: '',
      socso_no: '',
      eis_no: '',

      basic_salary: 0,
    };
    setModel(blank);

    // reset helper selects
    setNatChoice(''); setNatOther('');
    setRelChoice(''); setRelOther('');
    setBankChoice(''); setBankOther('');
  };

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

    // hydrate select+other state from current row
    if ((row.nationality ?? '').toLowerCase() === 'malaysia') {
      setNatChoice('Malaysia'); setNatOther('');
    } else if (row.nationality && row.nationality.trim() !== '') {
      setNatChoice('Other'); setNatOther(row.nationality);
    } else {
      setNatChoice(''); setNatOther('');
    }

    if (RELATIONSHIP_OPTIONS.includes((row.emergency_relationship ?? '') as any)) {
      setRelChoice(row.emergency_relationship as any); setRelOther('');
    } else if (row.emergency_relationship) {
      setRelChoice('Other'); setRelOther(row.emergency_relationship);
    } else {
      setRelChoice(''); setRelOther('');
    }

    if (row.bank_name && MALAYSIA_BANKS.includes(row.bank_name)) {
      setBankChoice(row.bank_name); setBankOther('');
    } else if (row.bank_name) {
      setBankChoice('Other'); setBankOther(row.bank_name);
    } else {
      setBankChoice(''); setBankOther('');
    }
  };

  const save = async () => {
    if (!model) return;
    setSaving(true); setMsg(null);
    try {
      // fold “Other” fields back into model
      const nationality =
        natChoice === 'Malaysia' ? 'Malaysia' :
        natChoice === 'Other'    ? (natOther.trim() || null) :
        null;

      const emergency_relationship =
        relChoice === 'Other' ? (relOther.trim() || null) :
        (relChoice || null);

      const bank_name =
        bankChoice === 'Other' ? (bankOther.trim() || null) :
        (bankChoice || null);

      // Normalize whitespace → nulls; ensure email lowercased
      const payload = {
        ...model,
        email: (model.email || '').trim().toLowerCase(),
        full_name: emptyToNull(model.full_name) ?? emptyToNull(model.name),
        nationality,
        nric: emptyToNull(model.nric),
        dob: emptyToNull(model.dob),
        phone: emptyToNull(model.phone),
        address: emptyToNull(model.address),
        emergency_name: emptyToNull(model.emergency_name),
        emergency_phone: emptyToNull(model.emergency_phone),
        emergency_relationship,
        salary_payment_method: emptyToNull(model.salary_payment_method),
        bank_name,
        bank_account_name: emptyToNull(model.bank_account_name),
        bank_account_no: emptyToNull(model.bank_account_no),
        position: emptyToNull(model.position),
        start_date: emptyToNull(model.start_date),
        epf_no: emptyToNull(model.epf_no),
        socso_no: emptyToNull(model.socso_no),
        eis_no: emptyToNull(model.eis_no),
      };

      // basic checks for create
      if (isNew) {
        if (!payload.email) throw new Error('Email is required.');
        // rudimentary email check
        if (!/^\S+@\S+\.\S+$/.test(payload.email)) throw new Error('Please enter a valid email.');
      }

      // 1) Save to staff (insert or update)
      if (isNew) {
        const { error: insErr } = await supabase.from('staff').insert(payload as any);
        if (insErr) throw insErr;
      } else {
        const { error: upErr } = await supabase.from('staff').update(payload as any).eq('email', model.email);
        if (upErr) throw upErr;
      }

      // 2) Latest OPEN period
      const { data: period, error: perErr } = await supabase
        .schema('pay_v2')
        .from('periods')
        .select('year, month')
        .eq('status', 'OPEN')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (perErr) throw perErr;

      // 3) Reflect salary in Payroll v2 (if any OPEN)
      if (period?.year && period?.month) {
        const s1 = await supabase.schema('pay_v2').rpc('sync_base_items', { p_year: period.year, p_month: period.month });
        if (s1.error) throw s1.error;
        await supabase.schema('pay_v2').rpc('recalc_statutories', { p_year: period.year, p_month: period.month });
      }

      setMsg(isNew ? 'Employee added and payroll updated.' : 'Saved and payroll updated.');
      await load();
      // after adding, keep editor open on the new employee so you can continue filling details
      if (isNew) {
        setOpenEmail(payload.email);
      }
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
    setNatChoice(''); setNatOther('');
    setRelChoice(''); setRelOther('');
    setBankChoice(''); setBankOther('');
  }

  if (authed === false) {
    return <main className="mx-auto max-w-6xl p-6">Please sign in.</main>;
  }

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
          <button
            className="rounded bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700"
            onClick={openCreate}
          >
            Add employee
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
              <div className="font-semibold">
                {isNew ? 'Add employee' : `Edit employee — ${model.email}`}
              </div>
              <button className="rounded border px-2 py-1" onClick={closeEditor}>Close</button>
            </div>

            <div className="grid gap-6 p-4">
              {/* For NEW: capture Email early */}
              {isNew && (
                <Section title="Account">
                  <Grid3>
                    <Text
                      label="Email (required)"
                      value={model.email}
                      onChange={(v)=>setModel(m => ({...m!, email: v.toLowerCase().trim()}))}
                      type="email"
                    />
                    <div />
                    <div />
                  </Grid3>
                </Section>
              )}

              {/* Personal */}
              <Section title="Personal information">
                <Grid2>
                  <Text label="Full name" value={model.full_name ?? model.name ?? ''} onChange={v => setModel(m => ({...m!, full_name: v}))} />

                  {/* Nationality: Malaysia / Other */}
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Nationality</label>
                    <div className="flex gap-2">
                      <select
                        className="rounded border px-2 py-1"
                        value={natChoice}
                        onChange={(e) => setNatChoice(e.target.value as any)}
                      >
                        <option value="">—</option>
                        <option value="Malaysia">Malaysia</option>
                        <option value="Other">Other</option>
                      </select>
                      {natChoice === 'Other' && (
                        <input
                          className="flex-1 rounded border px-2 py-1"
                          placeholder="Enter nationality"
                          value={natOther}
                          onChange={(e) => setNatOther(e.target.value)}
                        />
                      )}
                    </div>
                  </div>

                  {/* NRIC with DOB auto-fill */}
                  <Text
                    label="NRIC (YYMMDD-PP-####)"
                    value={model.nric ?? ''}
                    onChange={v => {
                      setModel(m => ({...m!, nric: v}));
                      const dob = dobFromNric(v);
                      if (dob) setModel(m => ({...m!, dob}));
                    }}
                  />
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
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Relationship</label>
                    <div className="flex gap-2">
                      <select
                        className="rounded border px-2 py-1"
                        value={relChoice}
                        onChange={(e) => setRelChoice(e.target.value as any)}
                      >
                        <option value="">—</option>
                        {RELATIONSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="Other">Other</option>
                      </select>
                      {relChoice === 'Other' && (
                        <input
                          className="flex-1 rounded border px-2 py-1"
                          placeholder="Specify relationship"
                          value={relOther}
                          onChange={(e) => setRelOther(e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                </Grid3>
              </Section>

              {/* Salary payment */}
              <Section title="Salary payment">
                <Grid3>
                  <Select label="Method" value={model.salary_payment_method ?? ''} onChange={v => setModel(m => ({...m!, salary_payment_method: (v||null) as any}))}
                          options={['Cheque','Bank Transfer','Cash']} />

                  {/* Bank name: list + Other */}
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Bank name</label>
                    <div className="flex gap-2">
                      <select
                        className="rounded border px-2 py-1"
                        value={bankChoice}
                        onChange={(e) => setBankChoice(e.target.value)}
                      >
                        <option value="">—</option>
                        {MALAYSIA_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                        <option value="Other">Other</option>
                      </select>
                      {bankChoice === 'Other' && (
                        <input
                          className="flex-1 rounded border px-2 py-1"
                          placeholder="Enter bank name"
                          value={bankOther}
                          onChange={(e) => setBankOther(e.target.value)}
                        />
                      )}
                    </div>
                  </div>

                  <Text label="Account holder" value={model.bank_account_name ?? ''} onChange={v => setModel(m => ({...m!, bank_account_name: v}))} />
                  <Text label="Account no." value={model.bank_account_no ?? ''} onChange={v => setModel(m => ({...m!, bank_account_no: v}))} />
                </Grid3>
              </Section>

              {/* Employment */}
              <Section title="Employment">
                <Grid3>
                  {/* Position dropdown */}
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Position</label>
                    <select
                      className="w-full rounded border px-2 py-1"
                      value={model.position ?? ''}
                      onChange={(e) => setModel(m => ({...m!, position: e.target.value || null}))}
                    >
                      <option value="">—</option>
                      {POSITION_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  {/* Start date: month/year only (save as YYYY-MM-01) */}
                  <MonthInput
                    label="Start date (month/year)"
                    value={dateToMonth(model.start_date ?? null)}
                    onChange={(v) => setModel(m => ({...m!, start_date: monthToDate(v)}))}
                  />

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
                  {saving ? (isNew ? 'Adding…' : 'Saving…') : (isNew ? 'Add employee' : 'Save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
