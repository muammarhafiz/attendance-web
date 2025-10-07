// src/app/salary/api/run/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** ---- Fixed brackets (basic-salary only) ----
 * SOCSO (Act 4) First Category – fixed RM amounts by wage band
 * Source: your pasted schedule
 */
const SOCSO_TABLE: Array<{ max: number; er: number; ee: number }> = [
  { max: 30, er: 0.40, ee: 0.10 },
  { max: 50, er: 0.70, ee: 0.20 },
  { max: 70, er: 1.10, ee: 0.30 },
  { max: 100, er: 1.50, ee: 0.40 },
  { max: 140, er: 2.10, ee: 0.60 },
  { max: 200, er: 2.95, ee: 0.85 },
  { max: 300, er: 4.35, ee: 1.25 },
  { max: 400, er: 6.15, ee: 1.75 },
  { max: 500, er: 7.85, ee: 2.25 },
  { max: 600, er: 9.65, ee: 2.75 },
  { max: 700, er: 11.35, ee: 3.25 },
  { max: 800, er: 13.15, ee: 3.75 },
  { max: 900, er: 14.85, ee: 4.25 },
  { max: 1000, er: 16.65, ee: 4.75 },
  { max: 1100, er: 18.35, ee: 5.25 },
  { max: 1200, er: 20.15, ee: 5.75 },
  { max: 1300, er: 21.65, ee: 6.25 },
  { max: 1400, er: 23.65, ee: 6.75 },
  { max: 1500, er: 25.35, ee: 7.25 },
  { max: 1600, er: 27.15, ee: 7.75 },
  { max: 1700, er: 28.85, ee: 8.25 },
  { max: 1800, er: 30.65, ee: 8.75 },
  { max: 1900, er: 32.35, ee: 9.25 },
  { max: 2000, er: 34.15, ee: 9.75 },
  { max: 2100, er: 35.85, ee: 10.25 },
  { max: 2200, er: 37.65, ee: 10.75 },
  { max: 2300, er: 39.35, ee: 11.25 },
  { max: 2400, er: 41.15, ee: 11.75 },
  { max: 2500, er: 42.85, ee: 12.25 },
  { max: 2600, er: 44.65, ee: 12.75 },
  { max: 2700, er: 46.35, ee: 13.25 },
  { max: 2800, er: 48.15, ee: 13.75 },
  { max: 2900, er: 49.85, ee: 14.25 },
  { max: 3000, er: 51.65, ee: 14.75 },
  { max: 3100, er: 53.35, ee: 15.25 },
  { max: 3200, er: 55.15, ee: 15.75 },
  { max: 3300, er: 56.85, ee: 16.25 },
  { max: 3400, er: 58.65, ee: 16.75 },
  { max: 3500, er: 60.35, ee: 17.25 },
  { max: 3600, er: 62.15, ee: 17.75 },
  { max: 3700, er: 63.85, ee: 18.25 },
  { max: 3800, er: 65.65, ee: 18.75 },
  { max: 3900, er: 67.35, ee: 19.25 },
  { max: 4000, er: 69.15, ee: 19.75 },
  { max: 4100, er: 70.85, ee: 20.25 },
  { max: 4200, er: 72.65, ee: 20.75 },
  { max: 4300, er: 74.35, ee: 21.25 },
  { max: 4400, er: 76.15, ee: 21.75 },
  { max: 4500, er: 77.85, ee: 22.25 },
  { max: 4600, er: 79.65, ee: 22.75 },
  { max: 4700, er: 81.35, ee: 23.25 },
  { max: 4800, er: 83.15, ee: 23.75 },
  { max: 4900, er: 84.85, ee: 24.25 },
  { max: 5000, er: 86.65, ee: 24.75 },
  { max: 5100, er: 88.35, ee: 25.25 },
  { max: 5200, er: 90.15, ee: 25.75 },
  { max: 5300, er: 91.85, ee: 26.25 },
  { max: 5400, er: 93.65, ee: 26.75 },
  { max: 5500, er: 95.35, ee: 27.25 },
  { max: 5600, er: 97.15, ee: 27.75 },
  { max: 5700, er: 98.85, ee: 28.25 },
  { max: 5800, er: 100.65, ee: 28.75 },
  { max: 5900, er: 102.35, ee: 29.25 },
  { max: 6000, er: 104.15, ee: 29.75 },
  { max: Number.POSITIVE_INFINITY, er: 104.15, ee: 29.75 },
];

/** EIS (Act 800) – fixed RM amounts by wage band (equal ER/EE) */
const EIS_TABLE: Array<{ max: number; amount: number }> = [
  { max: 30, amount: 0.05 },
  { max: 50, amount: 0.10 },
  { max: 70, amount: 0.15 },
  { max: 100, amount: 0.20 },
  { max: 140, amount: 0.25 },
  { max: 200, amount: 0.35 },
  { max: 300, amount: 0.50 },
  { max: 400, amount: 0.70 },
  { max: 500, amount: 0.90 },
  { max: 600, amount: 1.10 },
  { max: 700, amount: 1.30 },
  { max: 800, amount: 1.50 },
  { max: 900, amount: 1.70 },
  { max: 1000, amount: 1.90 },
  { max: 1100, amount: 2.10 },
  { max: 1200, amount: 2.30 },
  { max: 1300, amount: 2.50 },
  { max: 1400, amount: 2.70 },
  { max: 1500, amount: 2.90 },
  { max: 1600, amount: 3.10 },
  { max: 1700, amount: 3.30 },
  { max: 1800, amount: 3.50 },
  { max: 1900, amount: 3.70 },
  { max: 2000, amount: 3.90 },
  { max: 2100, amount: 4.10 },
  { max: 2200, amount: 4.30 },
  { max: 2300, amount: 4.50 },
  { max: 2400, amount: 4.70 },
  { max: 2500, amount: 4.90 },
  { max: 2600, amount: 5.10 },
  { max: 2700, amount: 5.30 },
  { max: 2800, amount: 5.50 },
  { max: 2900, amount: 5.70 },
  { max: 3000, amount: 5.90 },
  { max: 3100, amount: 6.10 },
  { max: 3200, amount: 6.30 },
  { max: 3300, amount: 6.50 },
  { max: 3400, amount: 6.70 },
  { max: 3500, amount: 6.90 },
  { max: 3600, amount: 7.10 },
  { max: 3700, amount: 7.30 },
  { max: 3800, amount: 7.50 },
  { max: 3900, amount: 7.70 },
  { max: 4000, amount: 7.90 },
  { max: 4100, amount: 8.10 },
  { max: 4200, amount: 8.30 },
  { max: 4300, amount: 8.50 },
  { max: 4400, amount: 8.70 },
  { max: 4500, amount: 8.90 },
  { max: 4600, amount: 9.10 },
  { max: 4700, amount: 9.30 },
  { max: 4800, amount: 9.50 },
  { max: 4900, amount: 9.70 },
  { max: 5000, amount: 9.90 },
  { max: Number.POSITIVE_INFINITY, amount: 9.90 },
];

function pickSocso(basic: number) {
  for (const row of SOCSO_TABLE) {
    if (basic <= row.max) return { er: row.er, ee: row.ee };
  }
  return { er: 0, ee: 0 };
}
function pickEis(basic: number) {
  for (const row of EIS_TABLE) {
    if (basic <= row.max) return row.amount;
  }
  return 0;
}

// Simple EPF default (you can tweak later or make it per-staff)
const EPF_EE_RATE = 0.11; // 11%
const EPF_ER_RATE = 0.13; // 13%

type StaffRow = {
  email: string;
  name: string;
  base_salary: number | null;
  include_in_payroll: boolean;
};

export async function POST() {
  try {
    const cookieStore = cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            // route handlers can't set from here easily; ignore
          },
          remove(name: string, options: CookieOptions) {
            // ignore
          },
        },
      }
    );

    // Only included staff
    const { data, error } = await supabase
      .from('staff')
      .select('email,name,base_salary,include_in_payroll')
      .eq('include_in_payroll', true)
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const staff: StaffRow[] = (data ?? []).map((r) => ({
      email: String(r.email),
      name: String(r.name),
      base_salary:
        typeof r.base_salary === 'number'
          ? r.base_salary
          : r.base_salary == null
          ? 0
          : Number(r.base_salary) || 0,
      include_in_payroll: Boolean(r.include_in_payroll),
    }));

    const payslips = staff.map((s) => {
      const basic = Math.max(0, Number(s.base_salary) || 0);

      // EPF (basic only)
      const epf_ee = round2(basic * EPF_EE_RATE);
      const epf_er = round2(basic * EPF_ER_RATE);

      // SOCSO (table, basic only)
      const soc = pickSocso(basic);
      const socso_ee = round2(soc.ee);
      const socso_er = round2(soc.er);

      // EIS (table, equal EE/ER)
      const eisAmt = pickEis(basic);
      const eis_ee = round2(eisAmt);
      const eis_er = round2(eisAmt);

      // PCB not calculated here (0)
      const pcb = 0;

      const gross = round2(basic); // additions excluded by your rule
      const total_deduct = round2(epf_ee + socso_ee + eis_ee + pcb);
      const net = round2(gross - total_deduct);

      return {
        email: s.email,
        name: s.name,
        basic,
        gross,
        pcb,
        epf_ee,
        epf_er,
        socso_ee,
        socso_er,
        eis_ee,
        eis_er,
        net,
      };
    });

    const totals = payslips.reduce(
      (t, p) => {
        t.basic += p.basic;
        t.gross += p.gross;
        t.pcb += p.pcb;
        t.epf_ee += p.epf_ee;
        t.epf_er += p.epf_er;
        t.socso_ee += p.socso_ee;
        t.socso_er += p.socso_er;
        t.eis_ee += p.eis_ee;
        t.eis_er += p.eis_er;
        t.net += p.net;
        return t;
      },
      {
        basic: 0,
        gross: 0,
        pcb: 0,
        epf_ee: 0,
        epf_er: 0,
        socso_ee: 0,
        socso_er: 0,
        eis_ee: 0,
        eis_er: 0,
        net: 0,
      }
    );

    return NextResponse.json({ ok: true, count: payslips.length, payslips, totals });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}