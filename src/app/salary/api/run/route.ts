// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type StaffRow = {
  email: string;
  name: string;
  is_admin: boolean;
  include_in_payroll?: boolean | null;
  skip_payroll?: boolean | null;
  base_salary?: number | null;
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
type RunErr = { ok: false; where?: string; error: string; code?: string };
type RunApiRes = RunOk | RunErr;

function createSupabaseServerWithBearer(authHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const store = cookies();

  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        try {
          return store.get(name)?.value ?? '';
        } catch {
          return '';
        }
      },
      set(_n: string, _v: string, _o: CookieOptions) {},
      remove(_n: string, _o: CookieOptions) {},
    },
    global: authHeader ? { headers: { Authorization: authHeader } } : undefined,
  });
}

export async function GET() {
  const authHeader = (await Promise.resolve(null)) ?? null; // placeholder to keep top-level await symmetric
  const bearer = undefined; // not used; we read from request in the handler below
  return NextResponse.json({ ok: false, error: 'Use the handler' }, { status: 405 });
}

export async function POST(req: Request) {
  return NextResponse.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
}

export async function HEAD() {
  return NextResponse.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
}

// Next.js route handlers can export a default handler per method.
// We’ll attach the GET handler with access to the request to read headers.
export const dynamic = 'force-dynamic';

export async function GET_withRequest(req: Request) {
  const authHeader = req.headers.get('authorization');
  const supabase = createSupabaseServerWithBearer(authHeader);

  // 1) who am I?
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json<RunErr>(
      { ok: false, where: 'auth', error: userErr?.message || 'No session' },
      { status: 401 }
    );
  }

  // 2) load staff list (to populate Adjustment dropdown)
  const { data: staffRows, error: staffErr } = await supabase
    .from('staff')
    .select('email, name, is_admin, include_in_payroll, skip_payroll, base_salary')
    .order('name', { ascending: true });

  if (staffErr) {
    return NextResponse.json<RunErr>(
      { ok: false, where: 'db', error: staffErr.message, code: staffErr.code },
      { status: 500 }
    );
  }

  const staff: { email: string; name: string }[] = (staffRows ?? [])
    .filter(
      (s): s is StaffRow =>
        !!s &&
        typeof s.email === 'string' &&
        typeof s.name === 'string'
    )
    .map((s) => ({ email: s.email, name: s.name }));

  // 3) fetch current period payslips (your existing SQL or view)
  const { data: payslips, error: payErr } = await supabase
    .from('payslips_view') // replace with your real view/table name
    .select('staff_email, staff_name, base_pay, additions, deductions, gross_pay, net_pay');

  if (payErr) {
    return NextResponse.json<RunErr>(
      { ok: false, where: 'db', error: payErr.message, code: payErr.code },
      { status: 500 }
    );
  }

  const payload: RunOk = {
    ok: true,
    payslips: (payslips ?? []) as PayslipRow[],
    staff,
    totals: { count: (payslips ?? []).length },
  };

  return NextResponse.json<RunApiRes>(payload);
}

// Map default GET export to the function that has access to the request
export { GET_withRequest as GET };