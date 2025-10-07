// src/app/salary/api/staff-save/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

type Body = { email: string; basic_salary: number; skip_payroll: boolean };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.email) {
      return NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );

    // RLS: your staff table already allows admins to update anyone (is_admin())
    const { error } = await supabase
      .from('staff')
      .update({
        basic_salary: body.basic_salary ?? 0,
        skip_payroll: !!body.skip_payroll,
      })
      .eq('email', body.email);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}