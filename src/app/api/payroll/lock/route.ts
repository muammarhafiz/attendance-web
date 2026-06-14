import { createClientServer, supabasePayV2 } from '@/lib/supabaseServer';

export async function POST(req: Request) {
  // Admins only (defense in depth — the pay_v2 RLS also enforces this).
  const { data: isAdmin } = await createClientServer(req).rpc('is_admin');
  if (isAdmin !== true) return Response.json({ ok: false, error: 'Admins only.' }, { status: 403 });

  let year: number | undefined, month: number | undefined;
  try {
    ({ year, month } = await req.json());
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const sb = supabasePayV2(req);
  const { data, error } = await sb.rpc('lock_period', { p_year: year, p_month: month });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 400 });
  return Response.json({ ok: true, data });
}
