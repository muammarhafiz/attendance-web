import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (x: unknown) => `RM ${Number(x ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safe = (s: string) => s.replace(/[^\w\-]+/g, '_');

type SummaryRow = { staff_name: string | null; staff_email: string; net_pay: string | number };

export async function POST(req: Request) {
  try {
    // ---- admin gate (uses the service-role key below, so verify the caller) ----
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin !== true) return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });
    const actor = auth.user.email || 'admin';

    const notifyUrl = process.env.NOTIFY_URL;
    const notifyToken = process.env.NOTIFY_TOKEN;
    if (!notifyUrl || !notifyToken) {
      return NextResponse.json({ error: 'Email is not configured (NOTIFY_URL / NOTIFY_TOKEN missing on the server).' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year'));
    const month = Number(searchParams.get('month'));
    // Test mode: send ONE email to the admin's own inbox so they can verify
    // formatting + delivery before emailing real staff. Never sends to staff.
    const isTest = searchParams.get('test') === '1';
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'valid year & month required' }, { status: 400 });
    }
    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
    const basePath = `${year}-${String(month).padStart(2, '0')}`;

    // Payslips only exist once a period is finalized (locked).
    const { data: period } = await supabaseAdmin.schema('pay_v2').from('periods').select('status').eq('year', year).eq('month', month).maybeSingle();
    if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 });
    if (!isTest && period.status === 'OPEN') return NextResponse.json({ error: 'Finalize this period first — payslips have not been generated yet.' }, { status: 400 });

    const { data: rows, error: sErr } = await supabaseAdmin
      .schema('pay_v2').from('v_payslip_admin_summary')
      .select('staff_name, staff_email, net_pay')
      .eq('year', year).eq('month', month)
      .order('staff_name', { ascending: true });
    if (sErr) throw new Error(sErr.message);

    const { data: staffData } = await supabaseAdmin.from('staff').select('email, full_name, name');
    const nameByEmail = new Map<string, string>();
    (staffData ?? []).forEach((s: { email: string; full_name: string | null; name: string | null }) => nameByEmail.set(s.email, s.full_name || s.name || s.email));

    // ---- TEST MODE: one email to the admin's own inbox, using any existing payslip PDF ----
    if (isTest) {
      for (const r of (rows ?? []) as SummaryRow[]) {
        const email = r.staff_email;
        const name = nameByEmail.get(email) || r.staff_name || email;
        const path = `${basePath}/payslips/${safe(name)}_${basePath}.pdf`;
        const { data: file } = await supabaseAdmin.storage.from('payroll').download(path);
        if (!file) continue;
        const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
        const body = `This is a TEST of the payslip email feature.\n\nAttached is the ${monthLabel} payslip for ${name}, sent only to you (${actor}) so you can confirm the formatting and delivery before emailing real staff. No staff member received this message.\n\nZordaq Auto Services`;
        const res = await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: notifyToken,
            action: 'sendMail',
            to: actor,
            subject: `[TEST] Payslip — ${monthLabel}`,
            body,
            filename: `TEST_Payslip_${safe(name)}_${basePath}.pdf`,
            pdfBase64,
          }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) return NextResponse.json({ error: j?.error || `mail send failed (${res.status})` }, { status: 502 });
        return NextResponse.json({ test: true, sentTo: actor, usedPayslipOf: name }, { status: 200 });
      }
      return NextResponse.json({ error: 'No payslip PDF found for this period to test with — finalize a period that has generated payslips first.' }, { status: 404 });
    }

    const results: { email: string; status: 'sent' | 'error'; error?: string }[] = [];

    for (const r of (rows ?? []) as SummaryRow[]) {
      const email = r.staff_email;
      const name = nameByEmail.get(email) || r.staff_name || email;
      try {
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('no valid email on file');
        const path = `${basePath}/payslips/${safe(name)}_${basePath}.pdf`;
        const { data: file, error: dErr } = await supabaseAdmin.storage.from('payroll').download(path);
        if (dErr || !file) throw new Error('payslip PDF not found — re-finalize the period');
        const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');

        const body = `Dear ${name},\n\nPlease find attached your payslip for ${monthLabel}.\nNet pay: ${money(r.net_pay)}.\n\nThis document is confidential and intended only for you. If anything looks incorrect, please contact the office.\n\nZordaq Auto Services`;
        const res = await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: notifyToken,
            action: 'sendMail',
            to: email,
            subject: `Payslip — ${monthLabel}`,
            body,
            filename: `Payslip_${safe(name)}_${basePath}.pdf`,
            pdfBase64,
          }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) throw new Error(j?.error || `mail send failed (${res.status})`);

        results.push({ email, status: 'sent' });
      } catch (e) {
        results.push({ email, status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Log the run (best-effort)
    if (results.length) {
      await supabaseAdmin.from('payslip_email_log').insert(
        results.map((x) => ({ year, month, staff_email: x.email, status: x.status, error: x.error ?? null, sent_by: actor }))
      );
    }

    const sent = results.filter((x) => x.status === 'sent').length;
    return NextResponse.json({ sent, failed: results.length - sent, results }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
