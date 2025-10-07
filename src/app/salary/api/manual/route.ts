// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** Minimal cookie store shape so we avoid `any`. */
type CookieStoreLike = { get(name: string): { value?: string } | undefined };
const readCookie = (n: string) => {
  try { return (cookies() as unknown as CookieStoreLike).get(n)?.value ?? ''; }
  catch { return ''; }
};

/** Base64url decode that works in Node or Edge runtimes without ts-comments. */
function b64UrlDecodeToUtf8(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  // Prefer atob if it exists (Edge/runtime)
  if (typeof (globalThis as unknown as { atob?: (s: string) => string }).atob === 'function') {
    const ascii = (globalThis as unknown as { atob: (s: string) => string }).atob(b64);
    // Decode ASCII -> UTF-8
    try { return decodeURIComponent(escape(ascii)); } catch { return ascii; }
  }
  // Fallback to Buffer in Node
  try {
    // declare a minimal Buffer-like type so TS is happy without @ts-ignore
    const Buf = (globalThis as unknown as { Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } } }).Buffer;
    if (Buf) return Buf.from(b64, 'base64').toString('utf8');
  } catch {}
  return '';
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
          // Adapter requires these, even if no-ops in route handlers
          set(_n: string, _v: string, _o: CookieOptions) {},
          remove(_n: string, _o: CookieOptions) {},
        },
      }
    );

    // 1) Parse body
    const body = (await req.json()) as Body;
    const staff_email = String(body.staff_email || '').trim();
    const kind: 'EARN' | 'DEDUCT' = body.kind === 'DEDUCT' ? 'DEDUCT' : 'EARN';
    const amountNum = Number(body.amount);
    const label = body.label?.toString().trim() || null;
    const code = body.code?.toString().trim() || null;

    if (!staff_email) throw new Error('staff_email required');
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('amount must be a number > 0');

    // 2) Who is calling?
    const { data: authData } = await supabase.auth.getUser();
    let callerEmail = authData?.user?.email ?? null;

    if (!callerEmail) {
      const tok = readCookie('sb-access-token') || readCookie('sb:token');
      if (tok && tok.split('.').length >= 2) {
        try {
          const payload = JSON.parse(b64UrlDecodeToUtf8(tok.split('.')[1]));
          callerEmail = payload?.email ?? payload?.user_metadata?.email ?? null;
        } catch {}
      }
    }
    if (!callerEmail) {
      return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }

    // 3) Admin check
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff')
      .select('is_admin')
      .eq('email', callerEmail)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staffRow?.is_admin) {
      return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 });
    }

    // 4) Ensure current payroll period exists
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

    // 5) Insert manual adjustment
    const { error: insErr } = await supabase
      .from('manual_items')
      .insert([{
        staff_email,
        kind,               // 'EARN' | 'DEDUCT'
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