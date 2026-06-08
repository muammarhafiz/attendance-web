import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// POST { email, archived: boolean }  -> ban (archived) or un-ban (active) the auth user
export async function POST(req: Request) {
  try {
    // --- admin gate ---
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin !== true) return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });

    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const archived = !!body?.archived;
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    // find the auth user by email (they only exist once they've logged in at least once)
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const u = data.users.find((x) => (x.email || '').toLowerCase() === email);
      if (u) userId = u.id;
      if (data.users.length < 200) break;
    }
    if (!userId) return NextResponse.json({ ok: true, note: 'no login account yet (never signed in)' });

    // ban_duration 'none' un-bans; a long duration effectively blocks login
    await admin.auth.admin.updateUserById(userId, { ban_duration: archived ? '876000h' : 'none' });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
