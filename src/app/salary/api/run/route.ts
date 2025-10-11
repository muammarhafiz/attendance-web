// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

/** DB row types (strict, no `any`) */
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

type RunOk = {
  ok: true;
  payslips: PayslipRow[];
  staff: { email: string; name: string }[];
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
    // Use SSR client that reads Supabase auth cookies (no headers/bearer needed)
    const supabase = createClientServer();

    // 1) Find current payroll period (year/month = today)
    const now = new Date();
    const { data: period, error: perr } = await supabase
      .from('payroll_periods')
      .select('id, year, month')
      .eq('year', now.getFullYear())
      .eq('month', now.getMonth() + 1)
      .limit(1)
      .maybeSingle();

    if (perr) {
      return NextResponse.json<RunErr>(
        { ok: false, where: 'db', error: perr.message, code: perr.code },
        { status: 500 }
      );
    }
    if (!period?.id) {
      return NextResponse.json<RunErr>(
        { ok: false, where: 'db', error: 'No current payroll period found' },
        { status: 400 }
      );
    }

    // 2) Staff list (for the Adjustment dropdown)
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff')
      .select('email, name, include_in_payroll, skip_payroll')
      .order('name');

    if (staffErr) {
      return NextResponse.json<RunErr>(
        { ok: false, where: 'db', error: staffErr.message, code: staffErr.code },
        { status: 500 }
      );
    }

    const staff: { email: string; name: string }[] = (staffRows ?? [])
      .filter((s): s is StaffRow => !!s && typeof s.email === 'string' && typeof s.name === 'string')
      .filter((s) => s.include_in_payroll && !s.skip_payroll)
      .map((s) => ({ email: s.email, name: s.name }));

    // 3) Payslips — pull from view `v_payslip` (already granted)
    const { data: payslipsRows, error: vErr } = await supabase
      .from('v_payslip')
      .select(
        'staff_email, staff_name, base_pay, additions, deductions, gross_pay, net_pay, period_id'
      )
      .eq('period_id', period.id);

    if (vErr) {
      return NextResponse.json<RunErr>(
        { ok: false, where: 'db', error: vErr.message, code: vErr.code },
        { status: 500 }
      );
    }

    const payslips: PayslipRow[] = (payslipsRows ?? []).map((r) => ({
      staff_email: String((r as any).staff_email ?? ''),
      staff_name: String((r as any).staff_name ?? ''),
      base_pay: Number((r as any).base_pay ?? 0),
      additions: Number((r as any).additions ?? 0),
      deductions: Number((r as any).deductions ?? 0),
      gross_pay: Number((r as any).gross_pay ?? 0),
      net_pay: Number((r as any).net_pay ?? 0),
    }));

    return NextResponse.json<RunOk>({
      ok: true,
      payslips,
      staff,
      totals: { count: payslips.length },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return NextResponse.json<RunErr>(
      { ok: false, where: 'server', error: msg },
      { status: 500 }
    );
  }
}