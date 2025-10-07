// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieStoreLike = { get(name: string): { value?: string } | undefined };
const readCookie = (n: string) => {
  try { return (cookies() as unknown as CookieStoreLike).get(n)?.value ?? ''; }
  catch { return ''; }
};

function b64UrlDecode(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length/4) * 4, '=');
  // @ts-ignore Buffer exists in Node route handlers
  return (typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8'));
}

type Body = {
  staff_email: string;
  kind: 'EARN' | 'DEDUCT';
  amount: number | string;
  label?: string | null;
  code?: string | null;
};

export async function POST(req: Request) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (n: string) => readCookie(n),
          set(_n: string, _v: string, _o: CookieOptions) {},
          remove(_n: string, _o: CookieOptions) {},
        },
      }
    );

    // Parse & validate body
    const body = (await req.json()) as Body;
    const staff_email = String(body.staff_email || '').trim();
    const kind = body.kind === 'DEDUCT' ? 'DEDUCT' : 'EARN';
    const amountNum = Number(body.amount);
    const label = body.label?.toString().trim() || null;
    const code = body.code?.toString().trim() || null;

    if (!staff_email) throw new Error('staff_email required');
    if (!Number.isFinite(amountNum)) throw new Error('amount must be a number');
    if (amountNum <= 0) throw new Error('amount must be > 0');

    // Identify caller
    const { data: authData } = await supabase.auth.getUser();
    let callerEmail = authData?.user?.email ?? null;

    if (!callerEmail) {
      const tok = readCookie('sb-access-token') || readCookie('sb:token');
      if (tok && tok.split('.').length >= 2) {
        try {
          const payload = JSON.parse(b64UrlDecode(tok.split('.')[1]));
          callerEmail = payload?.email ?? payload?.user_metadata?.email ?? null;
        } catch {}
      }
    }

    if (!callerEmail) {
      return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }

    // Admin check
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff')
      .select('is_admin')
      .eq('email', callerEmail)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staffRow?.is_admin) {
      return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 });
    }

    // Ensure we have a current payroll period
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const { data: found, error: findErr } = await supabase
      .from('payroll_periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (findErr) throw findErr;

    let periodId = found?.id as string | undefined;

    if (!periodId) {
      const { data: inserted, error: insertErr } = await supabase
        .from('payroll_periods')
        .insert([{ year, month, status: 'OPEN' }])
        .select('id')
        .single();
      if (insertErr) throw insertErr;
      periodId = inserted.id as string;
    }

    // Insert manual item
    const { error: insErr } = await supabase
      .from('manual_items')
      .insert([{
        staff_email,
        kind,          // 'EARN' | 'DEDUCT'
        amount: amountNum,
        label,
        code,
        period_id: periodId,
      }]);
    if (insErr) throw insErr;

    return NextResponse.json({
      ok: true,
      inserted: { staff_email, kind, amount: amountNum, label, code, period_id: periodId },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message :
      typeof err === 'string' ? err : 'Error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}