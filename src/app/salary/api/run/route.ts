// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';


type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
  include_in_payroll: boolean;
  skip_payroll: boolean;
};

type PayslipRow = {
  staff_email: string;
  staff_name: string;
  base_pay: number;
  additions: number;
  deductions: number;
  gross_pay: number;
  net_pay: number;
};

/** Narrow an unknown to StaffRow without using `any` */
function isStaffRow(u: unknown): u is StaffRow {
  if (typeof u !== 'object' || u === null) return false;
  const o = u as Record<string, unknown>;
  return (
    typeof o.email === 'string' &&
    typeof o.name === 'string' &&
    typeof o.is_admin === 'boolean' &&
    typeof o.include_in_payroll === 'boolean' &&
    typeof o.skip_payroll === 'boolean'
  );
}

export async function GET(req: Request) {
  // Forward user's bearer so RLS evaluates as the real user
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const supabase = createClientServer(bearer);

  // 1) current period
  const now = new Date();
  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id, year, month')
    .eq('year', now.getFullYear())
    .eq('month', now.getMonth() + 1)
    .limit(1)
    .maybeSingle();

  if (perr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: perr.message, code: perr.code },
      { status: 500 }
    );
  }
  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db', error: 'No current payroll period found.' },
      { status: 400 }
    );
  }

  // 2) staff list (for dropdown)
  const { data: staffRows, error: sErr } = await supabase
    .from('staff')
    .select('email, name, is_admin, include_in_payroll, skip_payroll')
    .order('name', { ascending: true });

  if (sErr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: sErr.message, code: sErr.code },
      { status: 400 }
    );
  }

  const staff: StaffRow[] = (staffRows ?? []).filter(isStaffRow);

  // 3) payslips view (read-only)
  const { data: payslips, error: pErr } = await supabase
    .from('v_payslip')
    .select(
      'staff_email, staff_name, base_pay, additions, deductions, gross_pay, net_pay'
    )
    .eq('period_id', period.id)
    .order('staff_name', { ascending: true });

  if (pErr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: pErr.message, code: pErr.code },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    payslips: (payslips ?? []) as PayslipRow[],
    staff: staff.map((s) => ({ email: s.email, name: s.name })),
  });
}