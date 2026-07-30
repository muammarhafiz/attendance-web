import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

// Service-role client — used ONLY after the caller is verified as an attendance approver below.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// POST /api/offday/edit — a manager/owner (attendance access) edits a PENDING off-day
// request's dates/reason, e.g. when the staff agreed to a different date. offday_requests
// isn't client-updatable under RLS, so the update runs with the service role after the
// caller is confirmed to have attendance access. Only pending rows can be edited (an
// approved row has already written day_status).
export async function POST(req: Request) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: canAccess } = await sb.rpc('can_access', { p_feature: 'attendance' });
    if (canAccess !== true) return NextResponse.json({ error: 'You do not have access to edit requests.' }, { status: 403 });

    const body = await req.json().catch(() => null);
    const id = body?.id as string | undefined;
    const date_from = body?.date_from as string | undefined;
    const date_to = body?.date_to as string | undefined;
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    if (!id || !date_from || !date_to) return NextResponse.json({ error: 'id, date_from and date_to are required.' }, { status: 400 });
    if (date_from > date_to) return NextResponse.json({ error: 'The From date is after the To date.' }, { status: 400 });

    const { data: row, error: rErr } = await admin.from('offday_requests').select('status').eq('id', id).maybeSingle();
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    if (row.status !== 'pending') return NextResponse.json({ error: 'Only a pending request can be edited.' }, { status: 409 });

    const { error } = await admin.from('offday_requests').update({ date_from, date_to, reason }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
