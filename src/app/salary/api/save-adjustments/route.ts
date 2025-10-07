// src/app/api/save-adjustments/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

type Row = { employee_id: string; commission: number; advance: number };

export async function POST(req: Request) {
  try {
    const { year, month, rows } = (await req.json()) as {
      year: number; month: number; rows: Row[];
    };
    if (!year || !month || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'year, month, rows required' }, { status: 400 });
    }
    const supabase = createClientServer();

    // 1) Ensure/lookup period
    const { data: per } = await supabase
      .from('payroll_periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    let periodId = per?.id as string | undefined;

    if (!periodId) {
      const { data: ins, error: insErr } = await supabase
        .from('payroll_periods')
        .insert({ year, month })
        .select('id')
        .single();
      if (insErr) throw insErr;
      periodId = ins.id;
    }

    // 2) Upsert COMM (earn) + ADV (deduct) for each employee (email)
    const inserts: any[] = [];
    for (const r of rows as Row[]) {
      const email = String(r.employee_id).toLowerCase().trim();
      const comm = Number(r.commission) || 0;
      const adv  = Number(r.advance)    || 0;

      // Clear existing COMM/ADV for that employee/period
      const { error: delErr } = await supabase
        .from('one_off_items')
        .delete()
        .eq('period_id', periodId)
        .eq('employee_id', email)
        .in('code', ['COMM','ADV']);
      if (delErr) throw delErr;

      if (comm !== 0) {
        inserts.push({
          employee_id: email,
          period_id: periodId,
          kind: 'EARN',
          code: 'COMM',
          label: 'Commission',
          amount: comm,
        });
      }
      if (adv !== 0) {
        inserts.push({
          employee_id: email,
          period_id: periodId,
          kind: 'DEDUCT',
          code: 'ADV',
          label: 'Advance/Deduction',
          amount: Math.abs(adv), // store positive, type=DEDUCT reduces net
        });
      }
    }

    if (inserts.length) {
      const { error: insErr2 } = await supabase.from('one_off_items').insert(inserts);
      if (insErr2) throw insErr2;
    }

    return NextResponse.json({ ok: true, periodId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Save failed' }, { status: 500 });
  }
}