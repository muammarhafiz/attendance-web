// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieStoreLike = {
  get(name: string): { value?: string } | undefined;
};

function readCookie(name: string): string {
  try {
    const jar = cookies() as unknown as CookieStoreLike;
    return jar.get(name)?.value ?? '';
  } catch {
    return '';
  }
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(input.length / 4) * 4,
    '='
  );
  if (typeof atob === 'function') return atob(b64);
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function getSupabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return readCookie(name);
        },
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    }
  );
}

async function getSessionEmail(supabase: Awaited<ReturnType<typeof getSupabase>>): Promise<string | null> {
  // 1) Try official way
  const { data, error } = await supabase.auth.getUser();
  if (!error && data?.user?.email) return data.user.email;

  // 2) Fallback: decode JWT from cookie
  const token = readCookie('sb-access-token') || readCookie('sb:token'); // either name depending on version
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const email: string | undefined = payload?.email || payload?.user_metadata?.email;
    return email ?? null;
  } catch {
    return null;
  }
}

async function assertAdmin(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const email = await getSessionEmail(supabase);
  if (!email) throw new Error('No active session');

  const { data, error } = await supabase
    .from('staff')
    .select('is_admin')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;
  if (!data?.is_admin) throw new Error('Admins only');
  return email;
}

type Body = {
  staff_email: string;               // target staff (email)
  kind: 'EARN' | 'DEDUCT';           // enum (matches your check constraint)
  amount: number;                    // RM
  label?: string | null;             // optional description
  code?: string | null;              // optional code
};

export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();

    // Only admins may insert manual items
    await assertAdmin(supabase);

    const body = (await req.json()) as Body;
    if (!body?.staff_email || !body?.kind || typeof body.amount !== 'number') {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload' },
        { status: 400 }
      );
    }

    // find current period
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // get (or create) payroll_periods row for this year/month
    let { data: period, error: perr } = await supabase
      .from('payroll_periods')
      .select('id, year, month, status')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (perr) throw perr;

    if (!period) {
      const { data: inserted, error: ierr } = await supabase
        .from('payroll_periods')
        .insert([{ year, month, status: 'OPEN' }])
        .select('id, year, month, status')
        .single();
      if (ierr) throw ierr;
      period = inserted;
    }

    // Insert into manual_items (admin-only)
    const { error: insErr } = await supabase.from('manual_items').insert([
      {
        staff_email: body.staff_email,
        period_id: period.id,
        kind: body.kind,
        amount: body.amount,
        label: body.label ?? null,
        code: body.code ?? null,
      },
    ]);

    if (insErr) throw insErr;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: 403 });
  }
}