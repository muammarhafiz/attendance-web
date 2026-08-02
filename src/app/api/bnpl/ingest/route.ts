import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Service-role client — used only for the token-authed path (the email robot has no user session).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type Row = Record<string, unknown>;

// ATOME prints dates DD/MM/YYYY (e.g. "31/07/2026 14:44:55"). Turn that into an ISO instant in
// Malaysia time (+08:00) so the timestamptz stores the right moment. Returns null if unparseable.
function parseDMY(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const pad = (x: string) => x.padStart(2, '0');
  return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4] ?? '00')}:${pad(m[5] ?? '00')}:${pad(m[6] ?? '00')}+08:00`;
}

// "3,200.00" / "541.60" -> number; null when blank / non-numeric.
function parseNum(v: unknown): number | null {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function POST(req: Request) {
  try {
    // Two ways in: the email robot (shared x-ingest-token — the same secret the purchase-invoice
    // robot uses), or a logged-in office user (Bearer JWT + can_access('month_end')).
    let client: SupabaseClient;
    const ingestToken = (req.headers.get('x-ingest-token') || '').trim();
    if (ingestToken) {
      const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'niagawan_ingest_token').single();
      if (!secret?.value || ingestToken !== secret.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      client = admin;
    } else {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const sb = createClientServer(req);
      const { data: auth, error: aErr } = await sb.auth.getUser(token);
      if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const { data: ok } = await sb.rpc('can_access', { p_feature: 'month_end' });
      if (ok !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      client = sb as unknown as SupabaseClient;
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    const provider = (String(form.get('provider') || 'atome').trim().toLowerCase()) || 'atome';

    const buf = Buffer.from(await file.arrayBuffer());
    const XLSX = await import('xlsx');
    let wb: ReturnType<typeof XLSX.read>;
    try {
      wb = XLSX.read(buf, { type: 'buffer' });
    } catch {
      return NextResponse.json({ error: 'Could not read that file — is it the .xlsx ATOME emailed you?' }, { status: 400 });
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ error: 'The spreadsheet has no sheets.' }, { status: 400 });

    const headerRow = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] ?? []) as unknown[];
    const headers = new Set(headerRow.map((h) => String(h ?? '').trim()));
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as Row[];

    // This importer wants the SETTLEMENT / payout report (it carries Payout ID + Payout Amount).
    // The transaction report has the itemised fees but no payout linkage, so we can't reconcile with it.
    if (!headers.has('Payout ID') || !headers.has('Payout Amount')) {
      const looksTxn = headers.has('MDR Fee') || headers.has('Transaction Status');
      return NextResponse.json(
        {
          error: looksTxn
            ? 'That looks like the ATOME transaction report. Please upload the settlement / payout report — the one with "Payout ID" and "Payout Amount" columns.'
            : 'This doesn’t look like an ATOME settlement report — the "Payout ID" / "Payout Amount" columns are missing.',
        },
        { status: 400 }
      );
    }

    const norm = rows
      .map((r) => ({
        transaction_id: str(r['Transaction ID']),
        order_id: str(r['Atome Order ID']),
        payout_id: str(r['Payout ID']),
        payout_date: parseDMY(r['Payout Date']),
        transaction_type: str(r['Transaction Type']),
        transaction_date: parseDMY(r['Transaction Date']),
        gross_amount: parseNum(r['Transaction Amount']),
        net_amount: parseNum(r['Amount Receivable']),
        payout_amount: parseNum(r['Payout Amount']),
        currency: str(r['Payout Currency']),
        outlet_id: str(r['Outlet ID']),
      }))
      .filter((r) => r.transaction_id);

    if (norm.length === 0) {
      const dbg = `size=${buf.length} sig=${buf.slice(0, 4).toString('hex')} sheets=${wb.SheetNames.length} ref=${ws['!ref'] || '?'} rows=${rows.length} k=${rows[0] ? Object.keys(rows[0]).length : 0}`;
      return NextResponse.json({ error: 'No rows. ' + dbg }, { status: 400 });
    }

    const { data, error } = await client.rpc('bnpl_ingest_settlement', { p_provider: provider, p_rows: norm });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, file: file.name, result: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
