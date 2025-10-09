// src/app/salary/api/manual/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

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

type BodyIn = {
  staff_email?: string;
  kind?: string;          // 'EARN' | 'DEDUCT'
  amount?: string | number;
  label?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: Request) {
  // ---- parse & validate body
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
  const rawAmt  = (body?.amount ?? '').toString().trim();
  const label   = body?.label?.toString().trim() || null;

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

  // ---- supabase with cookies (so RLS sees your session)
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

  // ensure session
  const { data: authInfo, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authInfo?.user) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: 'Auth session missing!' },
      { status: 401 }
    );
  }
  const created_by = authInfo.user.email ?? null;

  // ---- ensure a current payroll period exists (UPSERT)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 1) try select (keep selErr as const to satisfy lint)
  const { data: found, error: selErr } = await supabase
    .from('payroll_periods')
    .select('id, year, month, status')
    .eq('year', year)
    .eq('month', month)
    .limit(1)
    .maybeSingle();

  if (selErr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: selErr.message, code: selErr.code, details: 'select payroll_periods' },
      { status: 500 }
    );
  }

  let period = found;

  // 2) not found → try insert OPEN period
  if (!period?.id) {
    const { data: insData, error: insErr } = await supabase
      .from('payroll_periods')
      .insert([{ year, month, status: 'OPEN' }])
      .select('id, year, month, status')
      .maybeSingle();

    if (insErr) {
      if (insErr.code === '23505') {
        // unique race → reselect
        const { data: again, error: againErr } = await supabase
          .from('payroll_periods')
          .select('id, year, month, status')
          .eq('year', year)
          .eq('month', month)
          .limit(1)
          .maybeSingle();
        if (againErr || !again?.id) {
          return NextResponse.json(
            { ok: false, where: 'db', error: againErr?.message || 'Period upsert race failed' },
            { status: 500 }
          );
        }
        period = again;
      } else {
        return NextResponse.json(
          { ok: false, where: 'db', error: insErr.message, code: insErr.code, details: 'insert payroll_periods' },
          { status: 500 }
        );
      }
    } else {
      period = insData || period;
    }
  }

  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db', error: 'Could not ensure current payroll period.' },
      { status: 500 }
    );
  }

  // ---- insert manual item (RLS allows only admins via policy)
  const { error: insManualErr } = await supabase
    .from('manual_items')
    .insert([{
      staff_email,
      kind: rawKind,
      amount,
      label,
      period_id: period.id,
      created_by,
      code: null,
    }]);

  if (insManualErr) {
    const status = insManualErr.code === '42501' ? 403 : 400;
    return NextResponse.json(
      { ok: false, where: 'db', error: insManualErr.message, code: insManualErr.code, details: 'insert manual_items' },
      { status }
    );
  }

  return NextResponse.json({ ok: true, period_id: period.id });
}