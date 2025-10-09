// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

/* ---------- Types (from your DB) ---------- */
type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
  include_in_payroll?: boolean | null;
  skip_payroll?: boolean | null;
};

type ProfileRow = {
  staff_email: string;
  base_salary: number | null;
  epf_enabled?: boolean | null;
  socso_enabled?: boolean | null;
  eis_enabled?: boolean | null;
  hrd_enabled?: boolean | null;
  epf_rate_employee?: number | null;
  epf_rate_employer?: number | null;
};

type BracketRow = {
  wage_min: number;
  wage_max: number | null;
  employee: number;
  employer: number;
};

type AddDedViewRow = {
  staff_email: string | null;
  additions_total: number | null;
  deductions_total: number | null;
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

type RunApiRes =
  | { ok: true; payslips: Payslip[]; totals?: { count: number } }
  | { ok: false; where?: string; error: string; code?: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- Helpers ---------- */
function findBracket(brackets: BracketRow[] | null, wage: number): BracketRow | null {
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
    const supabase = createClientServer();

    /* 1) Staff list + filters (typed) */
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select('email,name,is_admin,include_in_payroll,skip_payroll') as unknown as {
      data: Array<{
        email: string;
        name: string;
        is_admin: boolean;
        include_in_payroll: boolean | null;
        skip_payroll: boolean | null;
      }> | null;
      error: { message: string; code?: string } | null;
    };

    if (staffErr) {
      const res: RunApiRes = { ok: false, where: 'staff', error: staffErr.message, code: staffErr.code };
      return NextResponse.json(res, { status: 500 });
    }

    const staff: StaffRow[] = (staffRows ?? [])
      .filter((s) => typeof s?.email === 'string' && typeof s?.name === 'string')
      .map((s) => ({
        email: s.email,
        name: s.name,
        is_admin: !!s.is_admin,
        include_in_payroll: s.include_in_payroll ?? true,
        skip_payroll: s.skip_payroll ?? false,
      }))
      .filter((s) => (s.include_in_payroll ?? true) && !(s.skip_payroll ?? false));

    /* 2) Salary profiles (typed) */
    const { data: profiles, error: profErr } = await supabase
      .from('salary_profiles')
      .select(
        'staff_email,base_salary,epf_enabled,socso_enabled,eis_enabled,hrd_enabled,epf_rate_employee,epf_rate_employer'
      ) as unknown as {
      data: Array<ProfileRow> | null;
      error: { message: string; code?: string } | null;
    };

    if (profErr) {
      const res: RunApiRes = { ok: false, where: 'salary_profiles', error: profErr.message, code: profErr.code };
      return NextResponse.json(res, { status: 500 });
    }

    const byEmail = new Map<string, ProfileRow>();
    (profiles ?? []).forEach((p) => {
      byEmail.set(p.staff_email, {
        staff_email: p.staff_email,
        base_salary: p.base_salary ?? 0,
        epf_enabled: p.epf_enabled ?? true,
        socso_enabled: p.socso_enabled ?? true,
        eis_enabled: p.eis_enabled ?? true,
        hrd_enabled: p.hrd_enabled ?? false,
        epf_rate_employee: p.epf_rate_employee ?? 11,
        epf_rate_employer: p.epf_rate_employer ?? 13,
      });
    });

    /* 3) SOCSO & EIS brackets (typed) */
    const [{ data: socsoRows, error: socsoErr }, { data: eisRows, error: eisErr }] =
      (await Promise.all([
        supabase
          .from('socso_brackets')
          .select('wage_min,wage_max,employee,employer')
          .order('wage_min', { ascending: true }) as unknown as Promise<{
          data: BracketRow[] | null;
          error: { message: string; code?: string } | null;
        }>,
        supabase
          .from('eis_brackets')
          .select('wage_min,wage_max,employee,employer')
          .order('wage_min', { ascending: true }) as unknown as Promise<{
          data: BracketRow[] | null;
          error: { message: string; code?: string } | null;
        }>,
      ])) as [{ data: BracketRow[] | null; error: { message: string; code?: string } | null },
              { data: BracketRow[] | null; error: { message: string; code?: string } | null }];

    if (socsoErr) {
      const res: RunApiRes = { ok: false, where: 'socso_brackets', error: socsoErr.message, code: socsoErr.code };
      return NextResponse.json(res, { status: 500 });
    }
    if (eisErr) {
      const res: RunApiRes = { ok: false, where: 'eis_brackets', error: eisErr.message, code: eisErr.code };
      return NextResponse.json(res, { status: 500 });
    }

    /* 4) Additions/deductions aggregated view (typed) */
    const { data: addDedRows, error: addDedErr } = await supabase
      .from('v_add_ded_current_month')
      .select('staff_email, additions_total, deductions_total') as unknown as {
      data: Array<AddDedViewRow> | null;
      error: { message: string; code?: string } | null;
    };

    if (addDedErr) {
      const res: RunApiRes = { ok: false, where: 'v_add_ded_current_month', error: addDedErr.message, code: addDedErr.code };
      return NextResponse.json(res, { status: 500 });
    }

    const addByEmail = new Map<string, number>();
    const dedByEmail = new Map<string, number>();
    (addDedRows ?? []).forEach((r) => {
      const key = r.staff_email ?? '';
      if (!key) return;
      addByEmail.set(key, Number(r.additions_total ?? 0));
      dedByEmail.set(key, Math.abs(Number(r.deductions_total ?? 0)));
    });

    /* 5) Compute payslips */
    const payslips: Payslip[] = [];

    for (const s of staff) {
      const profile = byEmail.get(s.email);
      const basic = Number(profile?.base_salary ?? 0);

      // totals from view
      const additions = Number(addByEmail.get(s.email) ?? 0);
      const other_deduct = Number(dedByEmail.get(s.email) ?? 0);

      const gross = basic + additions;

      // EPF
      const epfEnabled = (profile?.epf_enabled ?? true) === true;
      const empRate = Number(profile?.epf_rate_employee ?? 11) / 100;
      const erRate = Number(profile?.epf_rate_employer ?? 13) / 100;
      const epf_emp = epfEnabled ? round2(basic * empRate) : 0;
      const epf_er = epfEnabled ? round2(basic * erRate) : 0;

      // SOCSO
      let socso_emp = 0;
      let socso_er = 0;
      if ((profile?.socso_enabled ?? true) === true) {
        const b = findBracket(socsoRows ?? null, basic);
        if (b) {
          socso_emp = Number(b.employee);
          socso_er = Number(b.employer);
        }
      }

      // EIS
      let eis_emp = 0;
      let eis_er = 0;
      if ((profile?.eis_enabled ?? true) === true) {
        const b = findBracket(eisRows ?? null, basic);
        if (b) {
          eis_emp = Number(b.employee);
          eis_er = Number(b.employer);
        }
      }

      // HRD & PCB (placeholders)
      const hrd_er = (profile?.hrd_enabled ?? false) ? 0 : 0;
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
        basic_pay: round2(basic),
        additions: round2(additions),
        other_deduct: round2(other_deduct),
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

    const res: RunApiRes = { ok: true, payslips, totals: { count: payslips.length } };
    return NextResponse.json(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error';
    const res: RunApiRes = { ok: false, where: 'unknown', error: message };
    return NextResponse.json(res, { status: 500 });
  }
}