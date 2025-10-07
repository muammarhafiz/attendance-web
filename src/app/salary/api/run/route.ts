// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Types from our DB shape
type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
};

type ExtraRow = {
  staff_email: string; // FK to staff.email
  basic_salary: number | null;
  skip_payroll?: boolean | null;
};

type SocsoBracket = {
  min_wage: number;
  max_wage: number | null;
  employer_rm: number;
  employee_rm: number;
};

type EisBracket = {
  min_wage: number;
  max_wage: number | null;
  employer_rm: number;
  employee_rm: number;
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

function findBracket<T extends { min_wage: number; max_wage: number | null }>(
  brackets: T[] | null,
  wage: number
): T | null {
  if (!brackets) return null;
  for (const b of brackets) {
    const minOk = wage >= b.min_wage;
    const maxOk = b.max_wage == null ? true : wage <= b.max_wage;
    if (minOk && maxOk) return b;
  }
  return null;
}

export async function POST() {
  try {
    // Supabase (attendance project) via cookies from headers()
    const cookieStore = headers();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          // route handlers can't set/remove response cookies this way; keep stubs
          set(_name: string, _value: string, _options: CookieOptions) { /* no-op */ },
          remove(_name: string, _options: CookieOptions) { /* no-op */ },
        },
      }
    );

    // 1) Load staff
    const { data: staff, error: staffErr } = await supabase
      .from('staff')
      .select('email,name,is_admin')
      .order('name', { ascending: true });
    if (staffErr) throw staffErr;

    // 2) Load salary extras (basic + skip flag)
    const { data: extras, error: extrasErr } = await supabase
      .from('salary_staff_extras')
      .select('staff_email,basic_salary,skip_payroll');
    if (extrasErr) throw extrasErr;

    // 3) SOCSO brackets
    const { data: socsoRows, error: socsoErr } = await supabase
      .from('socso_bracket')
      .select('min_wage,max_wage,employer_rm,employee_rm')
      .order('min_wage', { ascending: true });
    if (socsoErr) throw socsoErr;

    // 4) EIS brackets
    const { data: eisRows, error: eisErr } = await supabase
      .from('eis_bracket')
      .select('min_wage,max_wage,employer_rm,employee_rm')
      .order('min_wage', { ascending: true });
    if (eisErr) throw eisErr;

    const extrasByEmail = new Map<string, ExtraRow>();
    (extras || []).forEach((e) => extrasByEmail.set(e.staff_email, e));

    const payslips: Payslip[] = [];

    for (const s of (staff || []) as StaffRow[]) {
      const ex = extrasByEmail.get(s.email);
      const skip = Boolean(ex?.skip_payroll);
      const basic = Number(ex?.basic_salary || 0);

      if (skip) continue;

      // EPF/SOCSO/EIS on basic only
      const additions = 0;
      const other_deduct = 0;

      const gross = basic + additions;

      // EPF (fixed rates for now)
      const epf_emp = Math.round(basic * 0.11 * 100) / 100; // 11% employee
      const epf_er = Math.round(basic * 0.13 * 100) / 100;  // 13% employer

      // SOCSO from table
      let socso_emp = 0;
      let socso_er = 0;
      {
        const b = findBracket<SocsoBracket>(socsoRows, basic);
        if (b) {
          socso_emp = b.employee_rm;
          socso_er = b.employer_rm;
        }
      }

      // EIS from table
      let eis_emp = 0;
      let eis_er = 0;
      {
        const b = findBracket<EisBracket>(eisRows, basic);
        if (b) {
          eis_emp = b.employee_rm;
          eis_er = b.employer_rm;
        }
      }

      // HRD and PCB: 0 for now
      const hrd_er = 0;
      const pcb = 0;

      const net =
        gross
        - epf_emp
        - socso_emp
        - eis_emp
        - pcb
        - other_deduct;

      payslips.push({
        email: s.email,
        name: s.name,
        basic_pay: basic,
        additions,
        other_deduct,
        gross_pay: Math.round(gross * 100) / 100,
        epf_emp,
        epf_er,
        socso_emp,
        socso_er,
        eis_emp,
        eis_er,
        hrd_er,
        pcb,
        net_pay: Math.round(net * 100) / 100,
      });
    }

    return NextResponse.json({
      ok: true,
      payslips,
      totals: { count: payslips.length },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}