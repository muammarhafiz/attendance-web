import { supabasePayV2 } from '@/lib/supabaseServer';

export async function POST(req: Request) {
  const { year, month } = await req.json();
  const sb = supabasePayV2();

  const { data, error } = await sb.rpc('lock_period', { p_year: year, p_month: month });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true, data });
}