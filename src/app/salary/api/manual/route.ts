// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

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

type BodyIn = {
  staff_email?: string;
  kind?: string;              // 'EARN' | 'DEDUCT'
  amount?: string | number;   // non-negative
  label?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: Request) {
  // 1) Parse & validate input
  let body: BodyIn | null = null;
  try {
    body = (await req.json()) as BodyIn;
  } catch {
    return NextResponse.json(
      { ok: false, where: 'input', error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const staff_email = (body?.staff_email ?? '').trim();
  const rawKind = (body?.kind ?? '').toString().trim().toUpperCase();
  const rawAmt = (body?.amount ?? '').toString().trim();
  const label = body?.label?.toString().trim() || null;

  if (!staff_email || !staff_email.includes('@')) {
    return NextResponse.json(
      { ok: false, where: 'input', field: 'staff_email', error: 'Provide a valid staff email.' },
      { status: 400 }
    );
  }
  if (rawKind !== 'EARN' && rawKind !== 'DEDUCT') {
    return NextResponse.json(
      { ok: false, where: 'input', field: 'kind', error: "Kind must be 'EARN' or 'DEDUCT'." },
      { status: 400 }
    );
  }

  const amountNum = Number(rawAmt.replace(/[, ]/g, ''));
  if (!isFinite(amountNum) || amountNum < 0) {
    return NextResponse.json(
      { ok: false, where: 'input', field: 'amount', error: 'Amount must be a non-negative number.' },
      { status: 400 }
    );
  }
  const amount = round2(amountNum);

  // 2) Create Supabase server client wired to App Router cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return readCookie(name);
        },
        // Route Handler: we don’t mutate response cookies here
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    }
  );

  // 3) Who is the caller? (for created_by & RLS identity)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: userErr.message },
      { status: 401 }
    );
  }
  const created_by = userData?.user?.email ?? null;

  // 4) Find current payroll period (year/month = today)
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const { data: period, error: periodErr } = await supabase
    .from('payroll_periods')
    .select('id')
    .eq('year', year)
    .eq('month', month)
    .limit(1)
    .maybeSingle();

  if (periodErr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: periodErr.message, details: 'lookup payroll_periods' },
      { status: 500 }
    );
  }
  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db', error: 'No current payroll period found (year/month).' },
      { status: 400 }
    );
  }

  // 5) Insert manual item (RLS requires admin -> policy manual_items_admin_all = is_admin())
  const { error: insErr } = await supabase
    .from('manual_items')
    .insert([
      {
        staff_email,          // TEXT
        kind: rawKind,        // 'EARN' | 'DEDUCT'
        amount,               // NUMERIC >= 0
        label,                // optional
        period_id: period.id, // UUID
        created_by,           // audit
        code: null,           // optional
      },
    ]);

  if (insErr) {
    // Clear message + hints
    return NextResponse.json(
      {
        ok: false,
        where: 'db',
        error: insErr.message,
        code: insErr.code,
        details: 'insert manual_items',
        hints: [
          'Are you logged in (supabase.auth.getUser())?',
          'Does your request include cookies (fetch(..., { credentials: "include" }))?',
          'Is your user an admin (is_admin() = true)?',
        ],
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}