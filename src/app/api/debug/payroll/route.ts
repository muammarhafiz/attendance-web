import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/** Create a server-side Supabase client. Throws if env is missing. */
function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Parse `year` & `month` from query string and validate. */
function parseYearMonth(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('year & month required');
  }
  return { year, month };
}

export async function GET(req: Request) {
  try {
    const { year, month } = parseYearMonth(req);
    const supabase = getAdminClient();

    // 1) Period row
    const { data: period, error: perr } = await supabase
      .schema('pay_v2')
      .from('periods')
      .select('id,status,created_at,locked_at')
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (perr) throw perr;
    if (!period) {
      return NextResponse.json({ ok: false, reason: 'period_not_found' }, { status: 404 });
    }

    // 2) Summary row count (what the UI and finalize rely on)
    const { count: summaryCount, error: scErr } = await supabase
      .schema('pay_v2')
      .from('v_payslip_admin_summary')
      .select('*', { head: true, count: 'exact' })
      .eq('year', year)
      .eq('month', month);

    if (scErr) throw scErr;

    // 3) Items count for that period
    const { count: itemsCount, error: icErr } = await supabase
      .schema('pay_v2')
      .from('items')
      .select('id', { head: true, count: 'exact' })
      .eq('period_id', period.id);

    if (icErr) throw icErr;

    // 4) Storage bucket exists?
    const { data: bucketRow, error: bucketErr } = await supabase
      .from('buckets', { schema: 'storage' })
      .select('id, public')
      .eq('id', 'payroll')
      .maybeSingle();

    if (bucketErr) throw bucketErr;

    return NextResponse.json({
      ok: true,
      input: { year, month },
      period,
      counts: {
        admin_summary_rows: summaryCount ?? 0,
        items_rows: itemsCount ?? 0,
      },
      storage: {
        payroll_bucket_exists: !!bucketRow,
        payroll_bucket_public: bucketRow?.public ?? null,
      },
      hint: 'If ok=true and counts > 0, finalize route should work with same envs.',
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = /year & month required/i.test(msg) ? 400 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}