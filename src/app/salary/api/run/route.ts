// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '../../../../lib/supabaseServer';

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
  brackets: { wage_min: number; wage_max: number | null; employee: number; employer: number }[] | null,
  wage: number
) {
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

    /* 1) Staff list (source of names/emails) */
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select('email,name,is_admin,include_in_payroll,skip_payroll')
      .order('name', { ascending: true });

    if (staffErr) throw staffErr;

    // 🔧 Normalize instead of using a type predicate (fixes TS error)
    const staff: StaffRow[] = (staffRows ?? [])
      .filter((s) => s && typeof s.email === 'string' && typeof s.name === 'string')
      .map((s) => ({
        email: String(s.email),
        name: String(s.name),
        is_admin: !!(s as any).is_admin,
        include_in_payroll: (s as any).include_in_payroll ?? true,
        skip_payroll: (s as any).skip_payroll ?? false,
      }));

    /* 1b) Salary profiles (basic pay) */
    const { data: profiles, error: profErr } = await supabase
      .from('salary_profiles')
      .select('staff_email,base_salary');
    if (profErr) throw profErr;

    const baseByEmail = new Map<string, number>();
    for (const p of profiles ?? []) {
      baseByEmail.set((p as any).staff_email, Number((p as any).base_salary ?? 0));
    }

    /* 2) SOCSO & EIS brackets (plural table names) */
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

    /* 3) Additions/deductions (recurring + oneoff + manual for current month) */
    const { data: addDedRows, error: addDedErr } = await supabase
      .from('v_add_ded_current_month')
      .select('staff_email, additions_total, deductions_total');

    if (addDedErr) throw addDedErr;

    const addByEmail = new Map<string, number>();
    const dedByEmail = new Map<string, number>();
    for (const r of addDedRows ?? []) {
      addByEmail.set((r as any).staff_email, Number((r as any).additions_total || 0));
      dedByEmail.set((r as any).staff_email, Math.abs(Number((r as any).deductions_total || 0)));
    }

    /* 4) Build payslips */
    const payslips: Payslip[] = [];

    for (const s of staff) {
      // honor include/skip flags when present
      if (s.include_in_payroll === false || s.skip_payroll === true) continue;

      const basic = Number(baseByEmail.get(s.email) ?? 0);

      const additions = addByEmail.get(s.email) ?? 0;
      const other_deduct = dedByEmail.get(s.email) ?? 0;

      const gross = basic + additions;

      // EPF (basic percentages)
      const epf_emp = round2(basic * 0.11);
      const epf_er = round2(basic * 0.13);

      // SOCSO
      let socso_emp = 0;
      let socso_er = 0;
      {
        const b = findBracket((socsoRows ?? []) as any, basic);
        if (b) {
          socso_emp = Number(b.employee);
          socso_er = Number(b.employer);
        }
      }

      // EIS
      let eis_emp = 0;
      let eis_er = 0;
      {
        const b = findBracket((eisRows ?? []) as any, basic);
        if (b) {
          eis_emp = Number(b.employee);
          eis_er = Number(b.employer);
        }
      }

      // HRD & PCB placeholders
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
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}