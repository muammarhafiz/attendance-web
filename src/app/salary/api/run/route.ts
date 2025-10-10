// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '../../../../lib/supabaseServer';

/** Strict types for this endpoint */
type StaffRow = {
  email: string;
  name: string | null;
  is_admin: boolean | null;
  include_in_payroll: boolean | null;
  skip_payroll: boolean | null;
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
  staff: { email: string; name: string }[];
  payslips: Payslip[];
  totals?: { count: number };
};

type RunErr = {
  ok: false;
  where?: string;
  error: string;
  code?: string;
};

export async function GET() {
  try {
    const supabase = createClientServer();

    // who is the caller?
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      return NextResponse.json<RunErr>(
        { ok: false, where: 'auth', error: authErr.message, code: authErr.code },
        { status: 401 }
      );
    }

    // load staff for the Adjustment dropdown
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select('email, name, is_admin, include_in_payroll, skip_payroll')
      .order('name', { ascending: true });

    if (staffErr) {
      return NextResponse.json<RunErr>(
        { ok: false, where: 'db', error: staffErr.message, code: staffErr.code },
        { status: 500 }
      );
    }

    const staff =
      (staffRows ?? [])
        .filter((s): s is StaffRow => !!s && typeof s.email === 'string')
        .filter((s) => (s.include_in_payroll ?? true) && !(s.skip_payroll ?? false))
        .map((s) => ({ email: s.email, name: s.name ?? s.email }));

    // For now, return empty payslips; the page will render and the Adjustment form will work.
    // We can plug the real payroll rows once we align with your salary schema/views.
    const payload: RunOk = {
      ok: true,
      staff,
      payslips: [],
      totals: { count: staff.length },
    };

    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json<RunErr>(
      { ok: false, where: 'server', error: msg },
      { status: 500 }
    );
  }
}