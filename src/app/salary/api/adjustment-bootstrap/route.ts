// src/app/api/adjustments-bootstrap/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';
import { employeeIdFromEmail } from '@/lib/identity';

export async function POST(req: Request) {
  try {
    const { year, month } = await req.json();
    if (!year || !month) return NextResponse.json({ error: 'year and month required' }, { status: 400 });

    const supabase = createClientServer();

    // 1) Period id (optional)
    const { data: per, error: perErr } = await supabase
      .from('payroll_periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (perErr) throw perErr;
    const periodId = per?.id ?? null;

    // 2) READ STAFF (attendance app)
    const { data: staff, error: staffErr } = await supabase
      .from('staff')
      .select('email, name')
      .order('name', { ascending: true });
    if (staffErr) throw staffErr;

    // 3) Existing COMM/ADV for the same period (salary tables)
    const existing: Record<string, { commission: number; advance: number }> = {};
    if (periodId) {
      const { data: items, error: ioErr } = await supabase
        .from('one_off_items')
        .select('employee_id, code, amount')
        .eq('period_id', periodId)
        .in('code', ['COMM', 'ADV']);
      if (ioErr) throw ioErr;
      for (const r of items || []) {
        const key = r.employee_id as string;
        existing[key] ||= { commission: 0, advance: 0 };
        if (r.code === 'COMM') existing[key].commission = Number(r.amount) || 0;
        if (r.code === 'ADV')  existing[key].advance    = Number(r.amount) || 0;
      }
    }

    // 4) Build rows: use deterministic UUID(employee_id) from staff.email
    const rows = (staff || []).map((s: any) => {
      const employee_id = employeeIdFromEmail(s.email);
      return {
        employee_id,
        full_name: s.name as string,
        username: s.email as string,
        commission: existing[employee_id]?.commission ?? 0,
        advance: existing[employee_id]?.advance ?? 0,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load' }, { status: 500 });
  }
}