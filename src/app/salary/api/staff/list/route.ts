// src/app/api/staff/list/route.ts
import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

export async function GET() {
  try {
    const supabase = createClientServer();
    const { data, error } = await supabase
      .from('staff')
      .select('email, name, is_admin, base_salary, created_at')
      .order('name', { ascending: true });
    if (error) throw error;
    return NextResponse.json(
      (data || []).map((r: any) => ({ ...r, base_salary: Number(r.base_salary || 0) }))
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list staff' }, { status: 500 });
  }
}