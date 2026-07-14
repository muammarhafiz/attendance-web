import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

// Service-role client (used ONLY after we've verified the caller and scoped everything to
// their own identity below).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Same name→filename rule the finalize step uses when it writes the PDF.
const safe = (s: string) => s.replace(/[^\w\-]+/g, '_');

// Returns a short-lived signed URL to the SIGNED-IN staff's OWN payslip PDF for a month.
// The file is derived from the authenticated user's identity — never from a client-supplied
// name or path — so a staff can only ever reach their own payslip.
export async function GET(req: Request) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    const email = auth?.user?.email;
    if (aErr || !email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'valid year & month required' }, { status: 400 });
    }

    // Payslips exist only for a finalized (LOCKED) period.
    const { data: period } = await admin.schema('pay_v2').from('periods')
      .select('status').eq('year', year).eq('month', month).maybeSingle();
    if (!period || period.status !== 'LOCKED') {
      return NextResponse.json({ error: 'Payslip not available for that month yet.' }, { status: 404 });
    }

    // The caller MUST have a payslip row for that month — self-scope check.
    const { data: slip } = await admin.schema('pay_v2').from('v_payslip_admin_summary')
      .select('staff_email').eq('year', year).eq('month', month).ilike('staff_email', email).maybeSingle();
    if (!slip) return NextResponse.json({ error: 'No payslip found for you in that month.' }, { status: 404 });

    // Build the path from the CALLER's own name (from their own staff row) — never client input.
    const { data: staff } = await admin.from('staff').select('full_name,name').ilike('email', email).maybeSingle();
    const name = staff?.full_name || staff?.name || email;
    const basePath = `${year}-${String(month).padStart(2, '0')}`;
    const path = `${basePath}/payslips/${safe(name)}_${basePath}.pdf`;

    const { data: signed, error: sErr } = await admin.storage.from('payroll').createSignedUrl(path, 120);
    if (sErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Could not find your payslip file — ask the office to re-finalize the month.' }, { status: 404 });
    }
    return NextResponse.json({ url: signed.signedUrl }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
