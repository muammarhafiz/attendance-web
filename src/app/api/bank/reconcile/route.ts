import { NextResponse } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import { createClientServer } from '@/lib/supabaseServer';
import { parseMaybank, bankTransfersIn, reconcile, type NiaTransfer } from '@/lib/maybank';

// Owner-only bank reconciliation. The PDF is extracted here (unpdf runs server-side; the browser's
// Turbopack build can't bundle pdfjs) and DISCARDED — never written to storage. Owner is enforced via
// the owner_bank_transfers RPC (is_admin) called with the caller's own token.
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
    if (!b64) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });

    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const parsed = parseMaybank(text);
    if (!parsed.rows.length) return NextResponse.json({ error: 'No transactions found — is this a Maybank account-statement PDF?' }, { status: 422 });

    const bankIn = bankTransfersIn(parsed.rows);
    const dates = parsed.rows.map((r) => r.date).sort();
    const from = dates[0], to = dates[dates.length - 1];

    // owner_bank_transfers is is_admin-gated — this both authorises the owner AND fetches the data.
    const { data: rpc, error: rErr } = await sb.rpc('owner_bank_transfers', { p_from: from, p_to: to });
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    const r = rpc as { error?: string; transfers?: NiaTransfer[]; days_synced?: number } | null;
    if (r?.error) return NextResponse.json({ error: 'This page is for the owner.' }, { status: 403 });

    const nia = (r?.transfers || []).map((t) => ({ day: String(t.day), amount: Number(t.amount), descp: t.descp }));
    const recon = reconcile(nia, bankIn);
    const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

    return NextResponse.json({
      valid: parsed.valid,
      txnCount: parsed.rows.length,
      transfersIn: bankIn.length,
      recon,
      synced: { days: Number(r?.days_synced || 0), span: spanDays },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
