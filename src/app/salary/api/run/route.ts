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

export async function GET(req: Request) {
  // ---------- auth: forward user's Bearer so RLS sees the session ----------
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

  const staff: StaffRow[] = (staffRows ?? []).filter(
    (s: any): s is StaffRow =>
      !!s &&
      typeof s.email === 'string' &&
      typeof s.name === 'string' &&
      typeof s.is_admin === 'boolean' &&
      typeof s.include_in_payroll === 'boolean' &&
      typeof s.skip_payroll === 'boolean'
  );

  // 3) payslips view (read-only)
  const { data: payslips, error: pErr } = await supabase
    .from('v_payslip')
    .select('staff_email, staff_name, base_pay, additions, deductions, gross_pay, net_pay')
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
    payslips: payslips ?? [],
    staff: staff.map(s => ({ email: s.email, name: s.name })),
  });
}