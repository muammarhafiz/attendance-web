// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type ReadonlyRequestCookiesLike = {
  get(name: string): { value?: string } | undefined;
};
const jarGet = (name: string) => {
  const j = cookies() as unknown as ReadonlyRequestCookiesLike;
  return j.get(name)?.value ?? '';
};

function ok<T>(data: T) {
  return NextResponse.json({ ok: true, ...data });
}
function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function getSupabase() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: jarGet,
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    }
  );
}

async function assertAdmin(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data, error } = await supabase
    .from('staff')
    .select('is_admin')
    .eq('email', supabase.auth.getUser ? (await supabase.auth.getUser()).data.user?.email ?? '' : '')
    .maybeSingle();

  // Fallback: if supabase.auth.getUser() is not available in SSR adapter, use RLS helper
  if (error || !data || data.is_admin !== true) {
    // Try admin via RLS helper function, if present:
    const { data: adminCheck } = await supabase.rpc('is_admin');
    if (adminCheck !== true) throw new Error('Admins only');
  }
}

async function getCurrentPeriodId(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data, error } = await supabase
    .from('payroll_periods')
    .select('id')
    .eq('year', year)
    .eq('month', month)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data?.id) return data.id;

  // If period row missing, create one
  const { data: ins, error: insErr } = await supabase
    .from('payroll_periods')
    .insert({ year, month, status: 'OPEN' })
    .select('id')
    .single();

  if (insErr) throw insErr;
  return ins.id as string;
}

/** GET: list manual_items for current period */
export async function GET() {
  try {
    const supabase = await getSupabase();
    await assertAdmin(supabase);
    const periodId = await getCurrentPeriodId(supabase);

    const { data, error } = await supabase
      .from('manual_items')
      .select('id, staff_email, kind, label, amount, created_at, created_by')
      .eq('period_id', periodId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ok({ items: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return fail(msg, 500);
  }
}

/** POST: create a new manual item */
export async function POST(req: Request) {
  try {
    const supabase = await getSupabase();
    await assertAdmin(supabase);
    const periodId = await getCurrentPeriodId(supabase);

    const body = (await req.json()) as {
      staff_email: string;
      kind: 'EARN' | 'DEDUCT';
      amount: number;
      label?: string;
    };

    if (!body?.staff_email || !body?.kind || typeof body.amount !== 'number') {
      return fail('Missing staff_email/kind/amount');
    }

    const { data: ins, error } = await supabase
      .from('manual_items')
      .insert({
        staff_email: body.staff_email,
        kind: body.kind,
        amount: body.amount,
        label: body.label ?? null,
        period_id: periodId,
      })
      .select('id')
      .single();

    if (error) throw error;
    return ok({ id: ins.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return fail(msg, 500);
  }
}

/** PUT: update an existing item */
export async function PUT(req: Request) {
  try {
    const supabase = await getSupabase();
    await assertAdmin(supabase);
    await getCurrentPeriodId(supabase); // ensure a period exists (not strictly needed for update)

    const body = (await req.json()) as {
      id: string;
      staff_email?: string;
      kind?: 'EARN' | 'DEDUCT';
      amount?: number;
      label?: string | null;
    };
    if (!body?.id) return fail('Missing id');

    const patch: Record<string, unknown> = {};
    if (body.staff_email) patch.staff_email = body.staff_email;
    if (body.kind) patch.kind = body.kind;
    if (typeof body.amount === 'number') patch.amount = body.amount;
    if (typeof body.label !== 'undefined') patch.label = body.label;

    const { error } = await supabase
      .from('manual_items')
      .update(patch)
      .eq('id', body.id);

    if (error) throw error;
    return ok({ updated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return fail(msg, 500);
  }
}

/** DELETE: remove an item by id */
export async function DELETE(req: Request) {
  try {
    const supabase = await getSupabase();
    await assertAdmin(supabase);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return fail('Missing id');

    const { error } = await supabase.from('manual_items').delete().eq('id', id);
    if (error) throw error;
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return fail(msg, 500);
  }
}