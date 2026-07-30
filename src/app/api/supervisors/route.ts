import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

// Service-role client — used ONLY after the caller is verified below. Reads the `staff`
// table, which regular staff can't SELECT directly under RLS; this route lets any signed-in
// staff read the (low-sensitivity) list of supervisor names for the off-day request picker.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// GET /api/supervisors — active staff whose position is 'Supervisor', for the
// "Which supervisor did you ask?" selector on the staff off-day request.
export async function GET(req: Request) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await admin
      .from('staff')
      .select('email,name')
      .eq('position', 'Supervisor')
      .is('archived_at', null)
      .order('name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ supervisors: data ?? [] }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
