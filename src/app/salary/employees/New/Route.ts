import { NextResponse } from 'next/server';
import { createClientServer } from '@/lib/supabaseServer';

export async function POST(req: Request) {
  const supabase = createClientServer();
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const username = String(form.get('username') || '').trim();
  const full_name = String(form.get('full_name') || '').trim();
  const base_salary = Number(form.get('base_salary') || 0);

  if (!username || !full_name || !base_salary) {
    return NextResponse.redirect(new URL('/employees?err=missing', req.url));
  }

  const { error } = await supabase.from('employees').insert({
    username, full_name, start_date: new Date().toISOString().slice(0,10),
    pay_type: 'MONTHLY', base_salary
  });
  if (error) return NextResponse.redirect(new URL('/employees?err=db', req.url));

  return NextResponse.redirect(new URL('/employees?ok=1', req.url));
}
