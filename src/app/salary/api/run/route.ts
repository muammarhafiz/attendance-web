// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

/** DB row types (strict, no `any`) */
type StaffRow = {
  email: string;
  name: string;
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

// Helpers to sanitize unknown values without using `any`
const asStr = (v: unknown): string =>
  typeof v === 'string' ? v : String(v ?? '');
const asNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function GET() {
  try {
    // Use SSR client that reads Supabase auth cookies
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
      .filter((s: unknown): s is StaffRow => {
        return (
          !!s &&
          typeof (s as StaffRow).email === 'string' &&
          typeof (s as StaffRow).name === 'string' &&
          typeof (s as StaffRow).include_in_payroll === 'boolean' &&
          typeof (s as StaffRow).skip_payroll === 'boolean'
        );
      })
      .filter((s) => s.include_in_payroll && !s.skip_payroll)
      .map((s) => ({ email: s.email, name: s.name }));

    // 3) Payslips — pull from view `v_payslip`
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

    const payslips: PayslipRow[] = (payslipsRows ?? []).map((r: unknown) => {
      // treat each row as unknown and sanitize fields
      const obj = r as Record<string, unknown>;
      return {
        staff_email: asStr(obj.staff_email),
        staff_name: asStr(obj.staff_name),
        base_pay: asNum(obj.base_pay),
        additions: asNum(obj.additions),
        deductions: asNum(obj.deductions),
        gross_pay: asNum(obj.gross_pay),
        net_pay: asNum(obj.net_pay),
      };
    });

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