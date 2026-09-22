// src/app/api/robot/heartbeat/route.ts
// The email robots (ATOME import, etc.) POST a one-line status here every run so the system can see
// when one silently stops or starts failing. Auth = the same x-ingest-token the other robot endpoints
// use. Writes robot_heartbeats; a daily 9am health check (_robot_health_items) turns a stale/erroring
// heartbeat into an owner alert (push + bell). No new email/data path — status only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 15;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const token = (req.headers.get('x-ingest-token') || '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'niagawan_ingest_token').single();
    if (!secret?.value || token !== secret.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

    const name = (String(body?.name ?? 'atome').trim().toLowerCase().slice(0, 40)) || 'atome';
    const int0 = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
    const filesPosted = int0(body?.files_posted);
    const filesFailed = int0(body?.files_failed);
    const threadsLabelled = int0(body?.threads_labelled);
    const errText = body?.error ? String(body.error).slice(0, 500) : null;
    const nowIso = new Date().toISOString();

    // last_ok_at is only set on a clean run (0 failures); on a failing run we omit it so the last
    // successful time is preserved. last_result always carries the newest run for the alert copy.
    const patch: Record<string, unknown> = {
      name,
      last_run_at: nowIso,
      last_result: { files_posted: filesPosted, files_failed: filesFailed, threads_labelled: threadsLabelled, error: errText, at: nowIso },
      updated_at: nowIso,
    };
    if (filesFailed === 0) patch.last_ok_at = nowIso;

    const { error } = await admin.from('robot_heartbeats').upsert(patch, { onConflict: 'name' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, name });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
