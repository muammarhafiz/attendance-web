// src/app/api/staff/update/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const { email, name, is_admin, base_salary } = await req.json();
    if (!email || typeof name !== 'string' || typeof is_admin !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'email, name, is_admin required' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { error } = await admin
      .from('staff')
      .update({ name, is_admin, base_salary: Number(base_salary) || 0 })
      .eq('email', email);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Update failed' }, { status: 500 });
  }
}