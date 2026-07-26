import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { createClientServer } from '@/lib/supabaseServer';
import { parseMaybank, bankTransfersIn, parseQrCsv, reconcile, type Deposit, type NiaTransfer } from '@/lib/maybank';

// Owner-only reconciliation. kind='bank' → a Maybank PDF statement's transfers; kind='qr' → a DuitNow QR
// settlement CSV. The uploaded file is read here and DISCARDED — never written to storage. Owner is
// enforced via owner_recon_receipts (is_admin) called with the caller's own token. unpdf runs server-side
// because the browser's Turbopack build can't bundle pdfjs.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const b64 = body?.base64 ? String(body.base64) : '';
    const kind = body?.kind === 'qr' ? 'qr' : 'bank';
    if (!b64) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

    let deposits: Deposit[] = [];
    let method = 'transfer';
    let verified = false;
    let summary = '';

    if (kind === 'qr') {
      const text = Buffer.from(b64, 'base64').toString('utf8');
      const qr = parseQrCsv(text);
      if (!qr.rows.length) return NextResponse.json({ error: 'No QR transactions found — is this a DuitNow QR settlement CSV?' }, { status: 422 });
      deposits = qr.rows;
      method = 'qr';
      verified = qr.ok;
      summary = `${qr.rows.length} QR payments · ${qr.sum.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
    } else {
      const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const parsed = parseMaybank(text);
      if (!parsed.rows.length) return NextResponse.json({ error: 'No transactions found — is this a Maybank account-statement PDF?' }, { status: 422 });
      deposits = bankTransfersIn(parsed.rows);
      method = 'transfer';
      verified = parsed.valid.ok;
      summary = `${parsed.rows.length} transactions · ${deposits.length} transfers in`;
    }

    const dates = deposits.map((d) => d.date).sort();
    if (!dates.length) return NextResponse.json({ error: 'Could not read any dated rows from the file.' }, { status: 422 });
    const from = dates[0], to = dates[dates.length - 1];

    // is_admin-gated — both authorises the owner AND fetches the Niagawan side.
    const { data: rpc, error: rErr } = await sb.rpc('owner_recon_receipts', { p_method: method, p_from: from, p_to: to });
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    const r = rpc as { error?: string; receipts?: NiaTransfer[]; days_synced?: number } | null;
    if (r?.error) return NextResponse.json({ error: 'This page is for the owner.' }, { status: 403 });

    const nia = (r?.receipts || []).map((t) => ({ day: String(t.day), amount: Number(t.amount), descp: t.descp }));
    const recon = reconcile(nia, deposits, kind === 'qr' ? 2 : 3);
    const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

    return NextResponse.json({
      kind,
      verified,
      summary,
      recon,
      synced: { days: Number(r?.days_synced || 0), span: spanDays },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
