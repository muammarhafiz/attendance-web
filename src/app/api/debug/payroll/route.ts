export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function makeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    url,
    hasUrl: !!url,
    hasKey: !!key,
    supabase: url && key
      ? createClient(url, key, { auth: { persistSession: false } })
      : null,
  };
}

async function probe(year: number, month: number) {
  const { url, hasUrl, hasKey, supabase } = makeClient();

  if (!hasUrl || !hasKey) {
    return {
      ok: false,
      reason: 'Missing env',
      env: {
        NEXT_PUBLIC_SUPABASE_URL: hasUrl ? '[present]' : '[missing]',
        SUPABASE_SERVICE_ROLE_KEY: hasKey ? '[present]' : '[missing]',
      },
    };
  }

  // project info (from JWT)
  const projRef = (() => {
    try {
      const parts = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        return payload?.iss || null;
      }
    } catch {}
    return null;
  })();

  // simple DB checks the finalize route relies on
  const period = await supabase
    .schema('pay_v2')
    .from('periods')
    .select('id,status,created_at')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  const counts = await supabase
    .schema('pay_v2')
    .from('v_payslip_admin_summary')
    .select('year', { count: 'exact', head: true })
    .eq('year', year)
    .eq('month', month);

  return {
    ok: true,
    supabaseUrl: url,
    serviceKeyIssuer: projRef,         // helps spot if key belongs to another project
    foundPeriod: !!period.data,
    periodRow: period.data ?? null,
    periodError: period.error?.message ?? null,
    adminSummaryCount: counts.count ?? null,
    adminSummaryError: counts.error?.message ?? null,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get('year'));
  const month = Number(searchParams.get('month'));
  if (!year || !month) {
    return NextResponse.json({ error: 'year & month required' }, { status: 400 });
  }
  const result = await probe(year, month);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}