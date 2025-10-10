// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

/** Strict types (no `any`) */
type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
  include_in_payroll: boolean;
  skip_payroll: boolean;
  base_salary?: number | null;   // staff.base_salary
  basic_salary?: number | null;  // legacy column — we’ll coalesce
};

type AddDedRow = {
  staff_email: string | null;
  additions_total: number | null;
  deductions_total: number | null;
};

type Payslip = {
  staff_email: string;
  staff_name: string;
  base_pay: number;
  additions: number;
  deductions: number;
  gross_pay: number;
  net_pay: number;
};

type RunOk = {
  ok: true;
  payslips: Payslip[];
  staff: { email: string; name: string }[];
  totals?: { count: number };
};

type RunErr = {
  ok: false;
  where?: string;
  error: string;
  code?: string;
};

function isStaffRow(s: unknown): s is StaffRow {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.email === 'string' &&
    typeof o.name === 'string' &&
    typeof o.is_admin === 'boolean' &&
    typeof o.include_in_payroll === 'boolean' &&
    typeof o.skip_payroll === 'boolean'
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET() {
  const supabase = createClientServer();

  // 1) Load staff
  const { data: staffRows, error: staffErr } = await supabase
    .from('staff')
    .select(
      [
        'email',
        'name',
        'is_admin',
        'include_in_payroll',
        'skip_payroll',
        'base_salary',
        'basic_salary',
      ].join(',')
    );

  if (staffErr) {
    const out: RunErr = {
      ok: false,
      where: 'staff',
      error: staffErr.message,
      code: staffErr.code,
    };
    return NextResponse.json(out, { status: 500 });
  }

  // Cast to unknown[] first so TS doesn’t invent a weird union type
  const staff: StaffRow[] = ((staffRows ?? []) as unknown[]).filter(isStaffRow);

  // 2) Load current-month additions/deductions view
  const { data: addDedRows, error: addDedErr } = await supabase
    .from('v_add_ded_current_month')
    .select('staff_email, additions_total, deductions_total');

  if (addDedErr) {
    const out: RunErr = {
      ok: false,
      where: 'v_add_ded_current_month',
      error: addDedErr.message,
      code: addDedErr.code,
    };
    return NextResponse.json(out, { status: 500 });
  }

  const addDedMap = new Map<string, { add: number; ded: number }>();
  for (const r of (addDedRows ?? []) as AddDedRow[]) {
    if (!r?.staff_email) continue;
    addDedMap.set(r.staff_email.toLowerCase(), {
      add: Number(r.additions_total ?? 0),
      ded: Number(r.deductions_total ?? 0),
    });
  }

  // 3) Build payslips (filter in-payroll & not skipped)
  const payslips: Payslip[] = staff
    .filter((s) => s.include_in_payroll && !s.skip_payroll)
    .map((s) => {
      const key = s.email.toLowerCase();
      const v = addDedMap.get(key) ?? { add: 0, ded: 0 };
      const base =
        (typeof s.base_salary === 'number' ? s.base_salary : null) ??
        (typeof s.basic_salary === 'number' ? s.basic_salary : null) ??
        0;

      const gross = base + v.add;
      const net = gross - v.ded;

      return {
        staff_email: s.email,
        staff_name: s.name || s.email.split('@')[0],
        base_pay: round2(base),
        additions: round2(v.add),
        deductions: round2(v.ded),
        gross_pay: round2(gross),
        net_pay: round2(net),
      };
    })
    .sort((a, b) =>
      a.staff_name.localeCompare(b.staff_name) || a.staff_email.localeCompare(b.staff_email)
    );

  const out: RunOk = {
    ok: true,
    payslips,
    staff: staff.map((s) => ({ email: s.email, name: s.name })),
    totals: { count: payslips.length },
  };

  return NextResponse.json(out);
}