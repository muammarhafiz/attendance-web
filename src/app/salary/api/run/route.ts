// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '../../../../lib/supabaseServer';

/* ---------- DB row shapes we select ---------- */
interface StaffDB {
  email: string;
  name: string;
  is_admin: boolean;
  include_in_payroll: boolean | null;
  skip_payroll: boolean | null;
}
interface SalaryProfileDB {
  staff_email: string;
  base_salary: number | null;
}
interface BracketDB {
  wage_min: number;
  wage_max: number | null;
  employee: number;
  employer: number;
}
interface AddDedRowDB {
  staff_email: string;
  additions_total: number | null;
  deductions_total: number | null;
}

/* ---------- App-level types ---------- */
type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
  include_in_payroll?: boolean;
  skip_payroll?: boolean;
};

type Payslip = {
  email: string;
  name: string;
  basic_pay: number;
  additions: number;
  other_deduct: number;
  gross_pay: number;
  epf_emp: number;
  epf_er: number;
  socso_emp: number;
  socso_er: number;
  eis_emp: number;
  eis_er: number;
  hrd_er: number;
  pcb: number;
  net_pay: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function findBracket(
  brackets: BracketDB[] | null,
  wage: number
): BracketDB | null {
  if (!brackets) return null;
  for (const b of brackets) {
    const minOk = wage >= Number(b.wage_min);
    const maxOk = b.wage_max == null ? true : wage <= Number(b.wage_max);
    if (minOk && maxOk) return b;
  }
  return null;
}

export async function POST() {
  try {
    const supabase = createClientServer();

    /* 1) Staff list */
    const staffResp = (await supabase
      .from('staff')
      .select('email,name,is_admin,include_in_payroll,skip_payroll')
      .order('name', { ascending: true })) as unknown as {
        data: StaffDB[] | null;
        error: Error | null;
      };

    if (staffResp.error) throw staffResp.error;

    const staff: StaffRow[] = (staffResp.data ?? []).map((s) => ({
      email: s.email,
      name: s.name,
      is_admin: !!s.is_admin,
      include_in_payroll: s.include_in_payroll ?? true,
      skip_payroll: s.skip_payroll ?? false,
    }));

    /* 1b) Salary profiles (basic) */
    const profResp = (await supabase
      .from('salary_profiles')
      .select('staff_email,base_salary')) as unknown as {
        data: SalaryProfileDB[] | null;
        error: Error | null;
      };
    if (profResp.error) throw profResp.error;

    const baseByEmail = new Map<string, number>();
    for (const p of profResp.data ?? []) {
      baseByEmail.set(p.staff_email, Number(p.base_salary ?? 0));
    }

    /* 2) SOCSO/EIS brackets */
    const socsoResp = (await supabase
      .from('socso_brackets')
      .select('wage_min,wage_max,employee,employer')
      .order('wage_min', { ascending: true })) as unknown as {
        data: BracketDB[] | null;
        error: Error | null;
      };
    if (socsoResp.error) throw socsoResp.error;

    const eisResp = (await supabase
      .from('eis_brackets')
      .select('wage_min,wage_max,employee,employer')
      .order('wage_min', { ascending: true })) as unknown as {
        data: BracketDB[] | null;
        error: Error | null;
      };
    if (eisResp.error) throw eisResp.error;

    /* 3) Current-month additions/deductions view */
    const addDedResp = (await supabase
      .from('v_add_ded_current_month')
      .select('staff_email, additions_total, deductions_total')) as unknown as {
        data: AddDedRowDB[] | null;
        error: Error | null;
      };
    if (addDedResp.error) throw addDedResp.error;

    const addByEmail = new Map<string, number>();
    const dedByEmail = new Map<string, number>();
    for (const r of addDedResp.data ?? []) {
      addByEmail.set(r.staff_email, Number(r.additions_total ?? 0));
      dedByEmail.set(r.staff_email, Math.abs(Number(r.deductions_total ?? 0)));
    }

    /* 4) Build payslips */
    const payslips: Payslip[] = [];

    for (const s of staff) {
      if (s.include_in_payroll === false || s.skip_payroll === true) continue;

      const basic = Number(baseByEmail.get(s.email) ?? 0);
      const additions = addByEmail.get(s.email) ?? 0;
      const other_deduct = dedByEmail.get(s.email) ?? 0;
      const gross = basic + additions;

      // EPF
      const epf_emp = round2(basic * 0.11);
      const epf_er = round2(basic * 0.13);

      // SOCSO
      const socsoB = findBracket(socsoResp.data ?? null, basic);
      const socso_emp = socsoB ? Number(socsoB.employee) : 0;
      const socso_er = socsoB ? Number(socsoB.employer) : 0;

      // EIS
      const eisB = findBracket(eisResp.data ?? null, basic);
      const eis_emp = eisB ? Number(eisB.employee) : 0;
      const eis_er = eisB ? Number(eisB.employer) : 0;

      // HRD & PCB placeholders
      const hrd_er = 0;
      const pcb = 0;

      const net =
        gross - epf_emp - socso_emp - eis_emp - pcb - other_deduct;

      payslips.push({
        email: s.email,
        name: s.name,
        basic_pay: basic,
        additions,
        other_deduct,
        gross_pay: round2(gross),
        epf_emp,
        epf_er,
        socso_emp,
        socso_er,
        eis_emp,
        eis_er,
        hrd_er,
        pcb,
        net_pay: round2(net),
      });
    }

    return NextResponse.json({
      ok: true,
      payslips,
      totals: { count: payslips.length },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error';
    return NextResponse.json({ ok: false, where: 'run', error: message }, { status: 500 });
  }
}