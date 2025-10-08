// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/* ---------- minimal cookie interface (avoid `any`) ---------- */
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

/* ---------- types ---------- */
type Kind = 'EARN' | 'DEDUCT';

type BodyIn = {
  staff_email?: string;
  kind?: Kind | string; // will coerce to 'EARN' | 'DEDUCT'
  amount?: string | number;
  label?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- handlers ---------- */
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
  const rawKind = (body?.kind ?? '').toString().trim().toUpperCase() as Kind | string;
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
  const kind = rawKind as Kind;

  // allow "1,200.50", spaces, etc.
  const amountNum = Number(rawAmt.replace(/[, ]/g, ''));
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return NextResponse.json(
      { ok: false, where: 'input', field: 'amount', error: 'Amount must be a non-negative number.' },
      { status: 400 }
    );
  }
  const amount = round2(amountNum);

  // 2) Supabase client using App Router cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return readCookie(name);
        },
        // no response-cookie mutations from this route
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    }
  );

  // 3) Verify caller (so RLS sees your auth + for created_by)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: userErr.message, code: userErr.code ?? 'auth_error' },
      { status: 401 }
    );
  }
  const created_by = userData?.user?.email ?? null;

  // 4) Find current payroll period (year/month)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id, year, month')
    .eq('year', year)
    .eq('month', month)
    .limit(1)
    .maybeSingle();

  if (perr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: perr.message, code: perr.code ?? 'period_lookup', details: 'lookup payroll_periods' },
      { status: 500 }
    );
  }
  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db', error: `No OPEN payroll_period found for ${year}-${String(month).padStart(2, '0')}.` },
      { status: 400 }
    );
  }

  // 5) Insert manual item (RLS will enforce admin via policy: manual_items_admin_all -> is_admin())
  const { error: insErr } = await supabase
    .from('manual_items')
    .insert([
      {
        staff_email,          // TEXT (matches table)
        kind,                 // 'EARN' | 'DEDUCT' (CHECK constraint)
        amount,               // NUMERIC >= 0 (CHECK constraint)
        label,                // optional
        period_id: period.id, // UUID
        created_by,           // audit
        code: null,           // optional
      },
    ]);

  if (insErr) {
    // Most common: RLS block because request didn’t include cookies (fix: client must use credentials:'include')
    // or user isn’t admin; also CHECK constraint failures.
    return NextResponse.json(
      {
        ok: false,
        where: 'db',
        error: insErr.message,
        code: insErr.code ?? 'insert_failed',
        details: 'insert manual_items',
      },
      { status: insErr.code === 'PGRST116' ? 403 : 400 } // 403 for RLS, else 400
    );
  }

  return NextResponse.json({ ok: true });
}