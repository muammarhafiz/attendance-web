// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/* ---------- Types (match your Attendance DB) ---------- */
type StaffRow = { email: string; name: string; is_admin: boolean };
type ProfileRow = { staff_email: string; base_salary: number | null };
type BracketRow = { wage_min: number; wage_max: number | null; employee: number; employer: number };
type AddDedRow = { staff_email: string; additions_total: string | number | null; deductions_total: string | number | null };

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

type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};
function readCookie(name: string): string {
  try {
    const store = cookies() as unknown as ReadonlyRequestCookiesLike;
    return store.get(name)?.value ?? '';
  } catch {
    return '';
  }
}

function pickBracket(rows: BracketRow[] | null, wage: number): BracketRow | null {
  if (!rows) return null;
  for (const b of rows) {
    const minOk = wage >= Number(b.wage_min);
    const maxOk = b.wage_max == null ? true : wage <= Number(b.wage_max);
    if (minOk && maxOk) return b;
  }
  return null;
}

/* ---------- Route ---------- */
export async function POST() {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return readCookie(name); },
          set(_n: string, _v: string, _o: CookieOptions) {},
          remove(_n: string, _o: CookieOptions) {},
        },
      }
    );

    // 1) Staff (names/emails)
    const { data: staff, error: staffErr } = await supabase
      .from('staff')
      .select('email,name,is_admin')
      .order('name', { ascending: true });
    if (staffErr) throw staffErr;

    // 2) Base salary (from salary_profiles)
    const { data: profiles, error: profErr } = await supabase
      .from('salary_profiles')
      .select('staff_email,base_salary');
    if (profErr) throw profErr;

    const baseByEmail = new Map<string, number>();
    (profiles ?? []).forEach((p: ProfileRow) => {
      baseByEmail.set(p.staff_email, Number(p.base_salary ?? 0));
    });

    // 3) Additions/Deductions for the current month (from view)
    const { data: addDed, error: addDedErr } = await supabase
      .from('v_add_ded_current_month')
      .select('staff_email, additions_total, deductions_total');
    if (addDedErr) throw addDedErr;

    const addsByEmail = new Map<string, number>();
    const dedsByEmail = new Map<string, number>();
    (addDed ?? []).forEach((r: AddDedRow) => {
      const email = r.staff_email;
      const adds = Number(r.additions_total ?? 0);
      const deds = Math.abs(Number(r.deductions_total ?? 0));
      if (email) {
        addsByEmail.set(email, adds);
        dedsByEmail.set(email, deds);
      }
    });

    // 4) Brackets
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

    // 5) Compute payslips
    const payslips: Payslip[] = [];

    for (const s of (staff ?? []) as StaffRow[]) {
      const basic = Number(baseByEmail.get(s.email) ?? 0);
      const additions = Number(addsByEmail.get(s.email) ?? 0);
      const other_deduct = Number(dedsByEmail.get(s.email) ?? 0);

      const gross = basic + additions;

      // EPF (fixed for now)
      const epf_emp = round2(basic * 0.11);
      const epf_er  = round2(basic * 0.13);

      // SOCSO
      let socso_emp = 0, socso_er = 0;
      const sb = pickBracket(socsoRows ?? null, basic);
      if (sb) { socso_emp = Number(sb.employee); socso_er = Number(sb.employer); }

      // EIS
      let eis_emp = 0, eis_er = 0;
      const eb = pickBracket(eisRows ?? null, basic);
      if (eb) { eis_emp = Number(eb.employee); eis_er = Number(eb.employer); }

      const hrd_er = 0; // placeholder
      const pcb = 0;    // placeholder

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

    return NextResponse.json({ ok: true, payslips, totals: { count: payslips.length } });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message :
      typeof err === 'string' ? err : 'Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}