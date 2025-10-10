// src/app/salary/api/manual/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

type BodyIn = {
  staff_email?: string;
  kind?: string;      // 'EARN' | 'DEDUCT' (case-insensitive)
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

  // ---------- auth: forward user's Bearer so RLS sees the session ----------
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  // ---------- supabase (server) ----------
  const supabase = createClientServer(bearer);

  // who is the caller? (for created_by)
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) {
    return NextResponse.json(
      { ok: false, where: 'auth', error: userErr.message },
      { status: 401 }
    );
  }
  const created_by = userData?.user?.email ?? null;

  // ---------- current payroll period ----------
  const now = new Date();
  const { data: period, error: perr } = await supabase
    .from('payroll_periods')
    .select('id, year, month')
    .eq('year', now.getFullYear())
    .eq('month', now.getMonth() + 1)
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
        staff_email,
        kind: rawKind,     // 'EARN' | 'DEDUCT'
        amount,            // NUMERIC >= 0
        label,             // optional
        period_id: period.id,
        created_by,        // audit
        code: null,        // optional
      },
    ]);

  if (insErr) {
    return NextResponse.json(
      { ok: false, where: 'db', error: insErr.message, code: insErr.code, details: 'insert manual_items' },
      { status: insErr.code === '42501' ? 403 : 400 } // 403 likely RLS
    );
  }

  return NextResponse.json({ ok: true });
}