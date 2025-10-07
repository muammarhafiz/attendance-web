// src/app/salary/api/staff-list/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function GET() {
  try {
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

    // read from ATTENDANCE.public.staff
    const { data, error } = await supabase
      .from('staff')
      .select('email, name, basic_salary, skip_payroll')
      .order('name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}