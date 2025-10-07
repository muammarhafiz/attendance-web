// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/* ---------- Types based on your Attendance DB ---------- */
type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
};

type ProfileRow = {
  staff_email: string;
  base_salary: number | null;
};

type Bracket = {
  wage_min: number;
  wage_max: number | null;
  employee: number; // employee RM
  employer: number; // employer RM
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

/* ---------- Helpers ---------- */
function findBracket(
  brackets: Bracket[] | null,
  wage: number
): Bracket | null {
  if (!brackets) return null;
  for (const b of brackets) {
    const minOk = wage >= Number(b.wage_min);
    const maxOk = b.wage_max == null ? true : wage <= Number(b.wage_max);
    if (minOk && maxOk) return b;
  }
  return null;
}

/* ---------- Route ---------- */
export async function POST() {
  try {
    // Auth cookies from Attendance app session
    //const jar = cookies();

const jar = cookies() as unknown as {
  get(name: string): { value?: string } | undefined;
};

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return jar.get(name)?.value ?? '';
          },
          // no-ops in a Route Handler
          set(_n: string, _v: string, _o: CookieOptions) {},
          remove(_n: string, _o: CookieOptions) {},
        },
      }
    );

    /* 1) Staff list */
    const { data: staff, error: staffErr } = await supabase
      .from('staff')
      .select('email,name,is_admin')
      .order('name', { ascending: true });
    if (staffErr) throw staffErr;

    /* 2) Salary profiles (basic pay) */
    const { data: profiles, error: profErr } = await supabase
      .from('salary_profiles')
      .select('staff_email,base_salary');
    if (profErr) throw profErr;

    /* 3) SOCSO & EIS brackets */
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

    const baseByEmail = new Map<string, number>();
    (profiles || []).forEach((p) => {
      baseByEmail.set(p.staff_email, Number(p.base_salary ?? 0));
    });

    /* 4) Compute payslips */
    const payslips: Payslip[] = [];

    for (const s of (staff || []) as StaffRow[]) {
      const basic = Number(baseByEmail.get(s.email) ?? 0);

      const additions = 0;     // (commission/allowance to add later)
      const other_deduct = 0;  // (advance/unpaid to add later)
      const gross = basic + additions;

      // EPF (simple fixed rates for now)
      const epf_emp = Math.round(basic * 0.11 * 100) / 100; // 11%
      const epf_er = Math.round(basic * 0.13 * 100) / 100;  // 13%

      // SOCSO from brackets
      let socso_emp = 0;
      let socso_er = 0;
      {
        const b = findBracket(socsoRows ?? null, basic);
        if (b) {
          socso_emp = Number(b.employee);
          socso_er = Number(b.employer);
        }
      }

      // EIS from brackets
      let eis_emp = 0;
      let eis_er = 0;
      {
        const b = findBracket(eisRows ?? null, basic);
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