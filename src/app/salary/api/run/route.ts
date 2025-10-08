// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/* ---------- Types (match your DB) ---------- */
type StaffRow = {
  email: string;
  name: string;
  base_salary: number;
  skip_payroll: boolean;
  epf_enabled: boolean;
  epf_rate_employee: number; // e.g. 0.11
  epf_rate_employer: number; // e.g. 0.13
  socso_enabled: boolean;
  eis_enabled: boolean;
  hrd_enabled: boolean;
  is_foreign_worker: boolean;
  include_in_payroll: boolean;
};

type BracketRow = {
  wage_min: number;
  wage_max: number | null;
  employee: number; // employee RM (fixed amount per bracket)
  employer: number; // employer RM (fixed amount per bracket)
};

type AddDedRow = {
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

/* ---------- Helpers ---------- */
const round2 = (n: number) => Math.round(n * 100) / 100;

function findBracket(rows: BracketRow[] | null, wage: number): BracketRow | null {
  if (!rows) return null;
  for (const r of rows) {
    const minOk = wage >= Number(r.wage_min);
    const maxOk = r.wage_max == null ? true : wage <= Number(r.wage_max);
    if (minOk && maxOk) return r;
  }
  return null;
}

/** minimal cookie interface to avoid `any` */
type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};
function readCookie(name: string): string {
  try {
    const jar = cookies() as unknown as ReadonlyRequestCookiesLike;
    return jar.get(name)?.value ?? '';
  } catch {
    return '';
  }
}

/* ---------- Route ---------- */
export async function POST() {
  try {
    // Create Supabase client wired to App Router cookies
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return readCookie(name);
          },
          set(_n: string, _v: string, _o: CookieOptions) {},
          remove(_n: string, _o: CookieOptions) {},
        },
      }
    );

    /* 1) Staff as source of truth (your DB keeps payroll flags on staff) */
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select(
        [
          'email',
          'name',
          'base_salary',
          'skip_payroll',
          'epf_enabled',
          'epf_rate_employee',
          'epf_rate_employer',
          'socso_enabled',
          'eis_enabled',
          'hrd_enabled',
          'is_foreign_worker',
          'include_in_payroll',
        ].join(',')
      )
      .order('name', { ascending: true });

    if (staffErr) {
      return NextResponse.json(
        { ok: false, where: 'db', error: staffErr.message, details: 'select staff' },
        { status: 500 }
      );
    }

    // Normalize/guard types from DB (avoid dangerous casts)
    type StaffRowDB = {
      email?: unknown;
      name?: unknown;
      base_salary?: unknown;
      skip_payroll?: unknown;
      epf_enabled?: unknown;
      epf_rate_employee?: unknown;
      epf_rate_employer?: unknown;
      socso_enabled?: unknown;
      eis_enabled?: unknown;
      hrd_enabled?: unknown;
      is_foreign_worker?: unknown;
      include_in_payroll?: unknown;
    };

    const rawList: StaffRowDB[] = Array.isArray(staffRows) ? (staffRows as unknown as StaffRowDB[]) : [];
    const staff: StaffRow[] = rawList.map((r) => ({
      email: String(r.email ?? ''),
      name: String(r.name ?? ''),
      base_salary: Number(r.base_salary ?? 0),
      skip_payroll: Boolean(r.skip_payroll),
      epf_enabled: Boolean(r.epf_enabled),
      epf_rate_employee: Number(r.epf_rate_employee ?? 0),
      epf_rate_employer: Number(r.epf_rate_employer ?? 0),
      socso_enabled: Boolean(r.socso_enabled),
      eis_enabled: Boolean(r.eis_enabled),
      hrd_enabled: Boolean(r.hrd_enabled),
      is_foreign_worker: Boolean(r.is_foreign_worker),
      include_in_payroll: Boolean(r.include_in_payroll),
    }));

    /* 2) Additions/deductions view (aggregates recurring, one-off, manual) */
    const { data: addDedRows, error: addDedErr } = await supabase
      .from('v_add_ded_current_month')
      .select('staff_email, additions_total, deductions_total');

    if (addDedErr) {
      return NextResponse.json(
        { ok: false, where: 'db', error: addDedErr.message, details: 'select v_add_ded_current_month' },
        { status: 500 }
      );
    }

    const addByEmail = new Map<string, number>();
    const dedByEmail = new Map<string, number>();
    (addDedRows ?? []).forEach((r: AddDedRow) => {
      const email = (r.staff_email || '').toLowerCase();
      if (!email) return;
      addByEmail.set(email, Number(r.additions_total ?? 0));
      dedByEmail.set(email, Number(r.deductions_total ?? 0));
    });

    /* 3) SOCSO & EIS brackets (fixed RM amounts per bracket) */
    const [{ data: socsoRows, error: socsoErr }, { data: eisRows, error: eisErr }] =
      await Promise.all([
        supabase
          .from('socso_brackets')
          .select('wage_min,wage_max,employee,employer')
          .order('wage_min', { ascending: true }),
        supabase
          .from('eis_brackets')
          .select('wage_min,wage_max,employee,employer')
          .order('wage_min', { ascending: true }),
      ]);

    if (socsoErr || eisErr) {
      const msg = (socsoErr?.message || eisErr?.message) ?? 'Brackets fetch failed';
      return NextResponse.json(
        { ok: false, where: 'db', error: msg, details: 'fetch socso/eis brackets' },
        { status: 500 }
      );
    }

    /* 4) Compute payslips */
    const payslips: Payslip[] = [];

    for (const s of staff) {
      // Respect flags
      if (s.skip_payroll || !s.include_in_payroll) continue;

      const emailLc = s.email.toLowerCase();
      const basic = Number(s.base_salary ?? 0);
      const additions = Number(addByEmail.get(emailLc) ?? 0);
      const other_deduct = Number(dedByEmail.get(emailLc) ?? 0);

      const gross = basic + additions;

      // EPF (percentage of basic) — only if enabled
      const epf_emp = s.epf_enabled ? round2(basic * Number(s.epf_rate_employee ?? 0)) : 0;
      const epf_er  = s.epf_enabled ? round2(basic * Number(s.epf_rate_employer ?? 0)) : 0;

      // SOCSO/EIS — generally not for foreign workers
      let socso_emp = 0, socso_er = 0;
      if (s.socso_enabled && !s.is_foreign_worker) {
        const b = findBracket((socsoRows ?? []) as BracketRow[], basic);
        if (b) {
          socso_emp = Number(b.employee ?? 0);
          socso_er  = Number(b.employer ?? 0);
        }
      }

      let eis_emp = 0, eis_er = 0;
      if (s.eis_enabled && !s.is_foreign_worker) {
        const b = findBracket((eisRows ?? []) as BracketRow[], basic);
        if (b) {
          eis_emp = Number(b.employee ?? 0);
          eis_er  = Number(b.employer ?? 0);
        }
      }

      // HRD & PCB (placeholders)
      const hrd_er = s.hrd_enabled ? 0 : 0;
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
        epf_emp: round2(epf_emp),
        epf_er: round2(epf_er),
        socso_emp: round2(socso_emp),
        socso_er: round2(socso_er),
        eis_emp: round2(eis_emp),
        eis_er: round2(eis_er),
        hrd_er: round2(hrd_er),
        pcb: round2(pcb),
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
    return NextResponse.json({ ok: false, where: 'server', error: message }, { status: 500 });
  }
}