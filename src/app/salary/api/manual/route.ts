// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/src/lib/supabaseServer';

type BodyIn = {
  staff_email?: string;
  kind?: string;      // 'EARN' | 'DEDUCT'
  amount?: string | number;
  label?: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: Request) {
  // 1) Parse & validate
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
  const rawKind     = (body?.kind ?? '').toString().trim().toUpperCase();
  const rawAmt      = (body?.amount ?? '').toString().trim();
  const label       = body?.label?.toString().trim() || null;

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

  // 2) Supabase (server) that sees cookies/session
  const supabase = createClientServer();

  // 3) Who is the caller? (for created_by + to ensure session exists)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: userErr?.message || 'Auth session missing' },
      { status: 401 }
    );
  }
  const created_by = userData.user.email;

  // 4) Current period
  const year  = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (perr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: perr.message, details: 'lookup payroll_periods' },
      { status: 500 }
    );
  }
  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db', error: 'No current payroll period found (year/month).' },
      { status: 400 }
    );
  }

  // 5) Insert manual item — RLS: admins only (your policy)
  const { error: insErr } = await supabase
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

  if (insErr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: insErr.message, details: 'insert manual_items' },
      { status: insErr.code === '42501' ? 403 : 400 }
    );
  }

  return NextResponse.json({ ok: true });
}