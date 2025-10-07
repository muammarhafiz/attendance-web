// src/app/api/run-payroll/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

type StaffRow = {
  email: string;
  name: string;
  base_salary: number | null;

  // EPF settings (still % on BASIC)
  epf_enabled?: boolean | null;
  epf_rate_employee?: number | null; // e.g. 0.11
  epf_rate_employer?: number | null; // e.g. 0.13

  // Statutory toggles
  socso_enabled?: boolean | null;
  eis_enabled?: boolean | null;
  hrd_enabled?: boolean | null;
  is_foreign_worker?: boolean | null;
};

type Bracket = { wage_min: number; wage_max: number; employee: number; employer: number };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// pick table row that covers wage; if no exact band, use nearest lower band
function pickBracket(brs: Bracket[], wage: number): Bracket | null {
  const w = Number(wage) || 0;
  if (!brs?.length) return null;
  const hit = brs.find(b => w >= Number(b.wage_min) && w <= Number(b.wage_max));
  if (hit) return hit;
  let best: Bracket | null = null;
  for (const b of brs) {
    if (w >= Number(b.wage_min)) {
      if (!best || Number(b.wage_min) > Number(best.wage_min)) best = b;
    }
  }
  return best;
}

export async function POST(req: Request) {
  try {
    const { year, month } = (await req.json()) as { year: number; month: number };
    if (!year || !month) {
      return NextResponse.json({ error: 'year, month required' }, { status: 400 });
    }

    const supabase = createClientServer();

    // 1) Ensure/lookup period
    const { data: per0, error: perErr } = await supabase
      .from('payroll_periods')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (perErr) throw perErr;

    let periodId = per0?.id as string | undefined;
    if (!periodId) {
      const { data: perNew, error: perInsErr } = await supabase
        .from('payroll_periods')
        .insert({ year, month })
        .select('id')
        .single();
      if (perInsErr) throw perInsErr;
      periodId = perNew.id;
    }

    // 2) Load staff, one-offs, and official tables (plural + singular fallback)
    const [staffRes, itemsRes, socsoPlural, socsoSing, eisPlural, eisSing] = await Promise.all([
      supabase.from('staff').select(
        'email, name, base_salary, epf_enabled, epf_rate_employee, epf_rate_employer, socso_enabled, eis_enabled, hrd_enabled, is_foreign_worker'
      ).order('name', { ascending: true }),

      supabase.from('one_off_items').select('employee_id, kind, code, amount').eq('period_id', periodId),

      supabase.from('socso_brackets').select('wage_min, wage_max, employee, employer').order('wage_min', { ascending: true }),
      supabase.from('socso_bracket').select('wage_min, wage_max, employee, employer').order('wage_min', { ascending: true }),

      supabase.from('eis_brackets').select('wage_min, wage_max, employee, employer').order('wage_min', { ascending: true }),
      supabase.from('eis_bracket').select('wage_min, wage_max, employee, employer').order('wage_min', { ascending: true }),
    ]);
    if (staffRes.error) throw staffRes.error;
    if (itemsRes.error) throw itemsRes.error;

    const staff = (staffRes.data || []) as StaffRow[];
    const items = itemsRes.data || [];
    const socsoBrs: Bracket[] = (socsoPlural.data?.length ? socsoPlural.data : socsoSing.data) || [];
    const eisBrs: Bracket[]   = (eisPlural.data?.length   ? eisPlural.data   : eisSing.data)   || [];

    // 3) Clear this period’s payroll_items
    const { error: delErr } = await supabase.from('payroll_items').delete().eq('period_id', periodId);
    if (delErr) throw delErr;

    // 4) Build this period’s payroll_items (BASIC-only bases)
    const byEmp: Record<string, { earns: any[]; deducts: any[] }> = {};
    for (const it of items) {
      const k = String(it.employee_id).toLowerCase().trim();
      byEmp[k] ||= { earns: [], deducts: [] };
      if (it.kind === 'EARN') byEmp[k].earns.push(it);
      if (it.kind === 'DEDUCT') byEmp[k].deducts.push(it);
    }

    const rows: any[] = [];
    for (const s of staff) {
      const email = s.email.toLowerCase().trim();
      const name = s.name;
      const basic = Number(s.base_salary) || 0;

      const earns = byEmp[email]?.earns || [];
      const deducts = byEmp[email]?.deducts || [];

      // BASIC-only statutory bases
      const epfBase = basic;
      const socsoBase = basic;
      const eisBase = basic;

      // EPF (still % on BASIC)
      const epfEnabled = !!(s.epf_enabled ?? true) && !(s.is_foreign_worker ?? false);
      const epfEmp = epfEnabled ? r2(epfBase * (Number(s.epf_rate_employee) || 0)) : 0;
      const epfEr  = epfEnabled ? r2(epfBase * (Number(s.epf_rate_employer) || 0)) : 0;

      // SOCSO — OFFICIAL TABLE (Act 4). If table empty, fallback to % (0.5% emp, 1.75% er).
      let socsoEmp = 0, socsoEr = 0;
      const socsoEnabled = !!(s.socso_enabled ?? true) && !(s.is_foreign_worker ?? false);
      if (socsoEnabled) {
        if (socsoBrs.length) {
          const b = pickBracket(socsoBrs, socsoBase);
          if (b) { socsoEmp = r2(b.employee); socsoEr = r2(b.employer); }
        } 
        if (!socsoBrs.length) {
          // soft fallback if you haven't loaded the table yet
          socsoEmp = r2(socsoBase * 0.005);
          socsoEr  = r2(socsoBase * 0.0175);
        }
      }

      // EIS — OFFICIAL TABLE (Act 800). If table empty, fallback to 0.2% each.
      let eisEmp = 0, eisEr = 0;
      const eisEnabled = !!(s.eis_enabled ?? true) && !(s.is_foreign_worker ?? false);
      if (eisEnabled) {
        if (eisBrs.length) {
          const b = pickBracket(eisBrs, eisBase);
          if (b) { eisEmp = r2(b.employee); eisEr = r2(b.employer); }
        }
        if (!eisBrs.length) {
          eisEmp = r2(eisBase * 0.002);
          eisEr  = r2(eisBase * 0.002);
        }
      }

      // HRD (leave at 0 unless you want a rate)
      const hrdEr = 0;

      // BASIC
      if (basic > 0) {
        rows.push({ employee_id: email, period_id: periodId, type: 'EARN', code: 'BASIC', label: 'Basic Salary', amount: r2(basic), meta: { name } });
      }
      // One-off earnings/deductions (do NOT affect statutory)
      for (const e of earns) rows.push({ employee_id: email, period_id: periodId, type: 'EARN',   code: e.code, label: e.code === 'COMM' ? 'Commission' : e.code, amount: r2(Number(e.amount) || 0), meta: { name } });
      for (const d of deducts) rows.push({ employee_id: email, period_id: periodId, type: 'DEDUCT', code: d.code, label: d.code === 'ADV'  ? 'Advance/Deduction' : d.code, amount: r2(Math.abs(Number(d.amount) || 0)), meta: { name } });

      // Statutory lines
      rows.push(
        { employee_id: email, period_id: periodId, type: 'STAT_EMP_PCB',   code: 'STAT_EMP_PCB',   label: 'PCB (Emp)',    amount: 0,        meta: { name } },
        { employee_id: email, period_id: periodId, type: 'STAT_EMP_EPF',   code: 'STAT_EMP_EPF',   label: 'EPF (Emp)',    amount: epfEmp,   meta: { name } },
        { employee_id: email, period_id: periodId, type: 'STAT_EMP_SOCSO', code: 'STAT_EMP_SOCSO', label: 'SOCSO (Emp)',  amount: socsoEmp, meta: { name } },
        { employee_id: email, period_id: periodId, type: 'STAT_EMP_EIS',   code: 'STAT_EMP_EIS',   label: 'EIS (Emp)',    amount: eisEmp,   meta: { name } },

        { employee_id: email, period_id: periodId, type: 'STAT_ER_EPF',    code: 'STAT_ER_EPF',    label: 'EPF (Er)',     amount: epfEr,    meta: { name } },
        { employee_id: email, period_id: periodId, type: 'STAT_ER_SOCSO',  code: 'STAT_ER_SOCSO',  label: 'SOCSO (Er)',   amount: socsoEr,  meta: { name } },
        { employee_id: email, period_id: periodId, type: 'STAT_ER_EIS',    code: 'STAT_ER_EIS',    label: 'EIS (Er)',     amount: eisEr,    meta: { name } },
        { employee_id: email, period_id: periodId, type: 'STAT_ER_HRD',    code: 'STAT_ER_HRD',    label: 'HRD (Er)',     amount: hrdEr,    meta: { name } },
      );
    }

    if (rows.length) {
      const { error: insErr } = await supabase.from('payroll_items').insert(rows);
      if (insErr) throw insErr;
    }

    // 5) Return the payslip view
    const { data: payslips, error: vErr } = await supabase
      .from('v_payslip')
      .select('*')
      .eq('period_id', periodId);
    if (vErr) throw vErr;

    return NextResponse.json({ ok: true, year, month, periodId, employees: staff.length, inserted: rows.length, payslips: payslips || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Run payroll failed' }, { status: 500 });
  }
}