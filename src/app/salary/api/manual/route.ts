// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** minimal cookie interface (avoid `any`) */
type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
  getAll?: () => { name: string; value: string }[];
};

function readCookie(name: string): string {
  try {
    const store = cookies() as unknown as ReadonlyRequestCookiesLike;
    return store.get(name)?.value ?? '';
  } catch {
    return '';
  }
}

function listCookieNames(): string[] {
  try {
    const store = cookies() as unknown as ReadonlyRequestCookiesLike;
    if (typeof store.getAll === 'function') {
      return store.getAll().map((c) => c.name);
    }
    // Fallback: probe known Supabase cookie names
    const names = [
      'sb-access-token',
      'sb-refresh-token',
    ];
    return names.filter((n) => !!readCookie(n));
  } catch {
    return [];
  }
}

type BodyIn = {
  staff_email?: string;
  kind?: string;      // 'EARN' | 'DEDUCT'
  amount?: string | number;
  label?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

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

  // ---------- find current payroll period ----------
  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id, year, month')
    .eq('year', new Date().getFullYear())
    .eq('month', new Date().getMonth() + 1)
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
        amount,               // NUMERIC >= 0
        label,                // optional
        period_id: period.id, // UUID
        // created_by is nullable in your schema, so we can omit it;
        // RLS will still check is_admin() via JWT session if cookies are present.
      },
    ]);

  if (insErr) {
    // Return cookie visibility to help diagnose session issues
    return NextResponse.json(
      {
        ok: false,
        where: 'db',
        error: insErr.message,
        code: insErr.code,
        details: 'insert manual_items',
        saw_cookies: listCookieNames(),
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}