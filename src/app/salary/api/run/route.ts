// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/src/lib/supabaseServer';

type StaffRow = {
  email: string;
  name: string;
  base_salary: number;
  epf_enabled: boolean;
  epf_rate_employee: number;
  epf_rate_employer: number;
  socso_enabled: boolean;
  eis_enabled: boolean;
  hrd_enabled: boolean;
  is_foreign_worker: boolean;
  include_in_payroll: boolean;
  skip_payroll: boolean;
};

type BracketRow = { wage_min: number; wage_max: number | null; employee: number; employer: number; };

type Payslip = {
  email: string; name: string;
  basic_pay: number; additions: number; other_deduct: number; gross_pay: number;
  epf_emp: number; epf_er: number; socso_emp: number; socso_er: number;
  eis_emp: number; eis_er: number; hrd_er: number; pcb: number; net_pay: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const pickBracket = (rows: BracketRow[] | null, wage: number) => {
  if (!rows) return null;
  for (const b of rows) {
    const minOk = wage >= Number(b.wage_min);
    const maxOk = b.wage_max == null ? true : wage <= Number(b.wage_max);
    if (minOk && maxOk) return b;
  }
  return null;
};

export async function POST() {
  try {
    const supabase = createClientServer();

    // 0) ensure we have a session — not strictly required for SELECT, but consistent.
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return NextResponse.json({ ok: false, where: 'auth', error: 'Auth session missing' }, { status: 401 });
    }

    // 1) Staff (payroll fields live in staff table per your schema dump)
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select('email,name,base_salary,epf_enabled,epf_rate_employee,epf_rate_employer,socso_enabled,eis_enabled,hrd_enabled,is_foreign_worker,include_in_payroll,skip_payroll')
      .order('name', { ascending: true });

    if (staffErr) throw staffErr;
    const staff = (staffRows ?? []) as StaffRow[];

    // 2) Add/Ded totals from your view
    const { data: addDedRows, error: addDedErr } = await supabase
      .from('v_add_ded_current_month')
      .select('staff_email, additions_total, deductions_total');
    if (addDedErr) throw addDedErr;

    const addMap = new Map<string, number>();
    const dedMap = new Map<string, number>();
    for (const r of addDedRows ?? []) {
      addMap.set(r.staff_email, Number(r.additions_total ?? 0));
      dedMap.set(r.staff_email, Math.abs(Number(r.deductions_total ?? 0)));
    }

    // 3) SOCSO & EIS brackets
    const { data: socsoRows, error: socsoErr } = await supabase
      .from('socso_brackets')
      .select('wage_min,wage_max,employee,employer')
      .order('wage_min', { ascending: true });
    if (socsoErr) throw socsoErr;

    const { data: eisRows, error: eisErr } = await supabase
      .from('eis_brackets')
      .select('wage_min,wage_max,employee,employer')
      .order('wage_min', { ascending: true });
    if (eisErr) throw eisErr;

    // 4) Compute
    const payslips: Payslip[] = [];
    for (const s of staff) {
      if (!s.include_in_payroll || s.skip_payroll) continue;

      const basic = Number(s.base_salary ?? 0);
      const additions = Number(addMap.get(s.email) ?? 0);
      const other_deduct = Number(dedMap.get(s.email) ?? 0);
      const gross = basic + additions;

      // EPF
      const epf_emp = s.epf_enabled ? r2(basic * Number(s.epf_rate_employee)) : 0;
      const epf_er  = s.epf_enabled ? r2(basic * Number(s.epf_rate_employer)) : 0;

      // SOCSO
      let socso_emp = 0, socso_er = 0;
      if (s.socso_enabled && !s.is_foreign_worker) {
        const b = pickBracket(socsoRows ?? null, basic);
        if (b) { socso_emp = Number(b.employee); socso_er = Number(b.employer); }
      }

      // EIS
      let eis_emp = 0, eis_er = 0;
      if (s.eis_enabled && !s.is_foreign_worker) {
        const b = pickBracket(eisRows ?? null, basic);
        if (b) { eis_emp = Number(b.employee); eis_er = Number(b.employer); }
      }

      // HRD & PCB placeholders
      const hrd_er = s.hrd_enabled ? 0 : 0;
      const pcb = 0;

      const net = gross - epf_emp - socso_emp - eis_emp - pcb - other_deduct;

      payslips.push({
        email: s.email, name: s.name,
        basic_pay: basic, additions, other_deduct, gross_pay: r2(gross),
        epf_emp, epf_er, socso_emp, socso_er, eis_emp, eis_er, hrd_er, pcb,
        net_pay: r2(net),
      });
    }

    return NextResponse.json({ ok: true, payslips, totals: { count: payslips.length } });
  } catch (err: any) {
    const msg = err?.message || 'Error';
    return NextResponse.json({ ok: false, where: 'server', error: msg }, { status: 500 });
  }
}