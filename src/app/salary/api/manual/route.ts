// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

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
  const amountNum = Number(rawAmt.replace(/[, ]/g, ''));
  if (!isFinite(amountNum) || amountNum < 0) {
    return NextResponse.json(
      { ok: false, where: 'input', field: 'amount', error: 'Amount must be a non-negative number.' },
      { status: 400 }
    );
  }
  const amount = round2(amountNum);

  // ---------- supabase (server) ----------
  // IMPORTANT: pass the Request, not a string token
  const supabase = createClientServer(req);

  // who is the caller? (for created_by)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: userErr.message },
      { status: 401 }
    );
  }
  const created_by = userData?.user?.email ?? null;

  // ---------- find current payroll period ----------
  const now = new Date();
  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id, year, month')
    .eq('year', now.getFullYear())
    .eq('month', now.getMonth() + 1)
    .maybeSingle();

  if (perr) {
    return NextResponse.json(
      { ok: false, where: 'db.period', error: perr.message, code: perr.code },
      { status: 400 }
    );
  }
  if (!period?.id) {
    return NextResponse.json(
      { ok: false, where: 'db.period', error: 'No current payroll period found.' },
      { status: 400 }
    );
  }

  // ---------- insert manual item ----------
  const { error: insErr } = await supabase
    .from('manual_items')
    .insert([
      {
        staff_email,
        kind: rawKind,    // 'EARN' | 'DEDUCT'
        amount,
        label,
        period_id: period.id,
        created_by,
        code: null,
      },
    ]);

  if (insErr) {
    return NextResponse.json(
      { ok: false, where: 'db.insert', error: insErr.message, code: insErr.code },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}