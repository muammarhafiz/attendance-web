// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** minimal cookie interface (avoid `any`) */
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
  kind?: string;      // 'EARN' | 'DEDUCT' (case-insensitive)
  amount?: string | number;
  label?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/* -------------------------------------------------------
   POST /salary/api/manual
   Inserts a manual item into public.manual_items
   (RLS requires the caller to be an admin)
------------------------------------------------------- */
export async function POST(req: Request) {
  // ---------- parse & validate input ----------
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
  // allow "1,200.50", spaces, etc.
  const amountNum = Number(rawAmt.replace(/[, ]/g, ''));
  if (!isFinite(amountNum) || amountNum < 0) {
    return NextResponse.json(
      { ok: false, where: 'input', field: 'amount', error: 'Amount must be a non-negative number.' },
      { status: 400 }
    );
  }
  const amount = round2(amountNum);

  // ---------- supabase client with cookies ----------
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return readCookie(name);
        },
        // route handler: no response cookie mutations here
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    }
  );

  // who is the caller? (for created_by)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: userErr?.message || 'Auth session missing!' },
      { status: 401 }
    );
  }
  const created_by = userData.user.email ?? null;

  // ---------- find current payroll period ----------
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
      { ok: false, where: 'db', error: perr.message, code: perr.code, details: 'lookup payroll_periods' },
      { status: 500 }
    );
  }
  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db', error: 'No current payroll period found (year/month).' },
      { status: 400 }
    );
  }

  // ---------- insert manual item (RLS enforces admin) ----------
  const { error: insErr } = await supabase
    .from('manual_items')
    .insert([
      {
        staff_email,          // TEXT
        kind: rawKind,        // 'EARN' | 'DEDUCT'
        amount,               // NUMERIC >= 0 (check constraint)
        label,                // optional
        period_id: period.id, // UUID
        created_by,           // for audit
        code: null,           // optional (nullable)
      },
    ]);

  if (insErr) {
    return NextResponse.json(
      {
        ok: false,
        where: 'db',
        error: insErr.message,
        code: insErr.code,
        details: 'insert manual_items',
      },
      { status: insErr.code ? 403 : 400 }
    );
  }

  return NextResponse.json({ ok: true });
}

/* -------------------------------------------------------
   GET /salary/api/manual?debug=1
   Diagnostics: what the server sees (auth/admin/period)
------------------------------------------------------- */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get('debug');

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

  const { data: authInfo, error: authErr } = await supabase.auth.getUser();
  const userEmail = authInfo?.user?.email ?? null;

  // ask DB if this email is admin
  let amIAdmin: boolean | null = null;
  if (userEmail) {
    const { data: adminRow } = await supabase
      .from('staff')
      .select('is_admin')
      .eq('email', userEmail)
      .maybeSingle();
    amIAdmin = adminRow?.is_admin ?? false;
  }

  // current period (if any)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id, year, month, status')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (!debug) {
    return NextResponse.json({
      ok: true,
      hasAuth: !!authInfo?.user,
      userEmail,
      amIAdmin,
      periodFound: !!period?.id,
    });
  }

  return NextResponse.json({
    ok: true,
    diagnostics: {
      auth: {
        hasUser: !!authInfo?.user,
        error: authErr?.message ?? null,
        userEmail,
      },
      admin: { amIAdmin },
      period: {
        year, month,
        found: !!period?.id,
        id: period?.id ?? null,
        error: perr?.message ?? null,
      },
    },
  });
}