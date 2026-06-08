import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// POST { email } -> permanently delete an archived employee + all their data + login + MC files
export async function POST(req: Request) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin !== true) return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });

    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    // Delete all DB rows via the admin-gated function (runs as the caller, one transaction).
    // It enforces "must be archived first".
    const { data: paths, error: delErr } = await sb.rpc('delete_employee_data', { p_email: email });
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    // Remove MC certificate files from storage
    if (Array.isArray(paths) && paths.length) {
      try { await admin.storage.from('mc').remove(paths as string[]); } catch { /* non-fatal */ }
    }

    // Delete their login account
    try {
      let userId: string | null = null;
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) break;
        const u = data.users.find((x) => (x.email || '').toLowerCase() === email);
        if (u) userId = u.id;
        if (data.users.length < 200) break;
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
