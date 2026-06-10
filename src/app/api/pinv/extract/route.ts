import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
import { extractText, getDocumentProxy } from 'unpdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Normalise a code/text for matching: uppercase, strip everything except letters+digits.
// Used to verify each AI-returned code literally appears in the invoice's own text layer.
const normForMatch = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Pull the real text layer out of a (digital) PDF. Returns '' for image-only/scanned PDFs.
async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n') : String(text ?? '');
  } catch {
    return '';
  }
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function buildPrompt(categoryNames: string[], invoiceText: string): string {
  const catLine = categoryNames.length
    ? ' For each item also pick the single best "category" from EXACTLY this list (copy the name verbatim, do not invent new ones): ' +
      categoryNames.join(' | ') + '. If unsure, use "SPARE PARTS ITEM".'
    : '';
  // The PDF's own text layer is provided as the AUTHORITATIVE source for codes. This is exact
  // text from the file (not OCR), so the model must copy codes from it verbatim rather than
  // "reading" them off the image — that is what prevents misreads like VF21 -> VF17.
  const textBlock = invoiceText.trim()
    ? '\n\nThe EXACT text of this invoice (extracted directly from the PDF, character-for-character) is between the markers below. ' +
      'Treat this text as the AUTHORITATIVE source for every product code: copy codes EXACTLY as they appear here, character for character. ' +
      'Use the attached PDF only for layout/structure if helpful. Do NOT invent or alter any code.\n' +
      '<<<INVOICE_TEXT>>>\n' + invoiceText.slice(0, 24000) + '\n<<<END_INVOICE_TEXT>>>'
    : '';
  return (
    'Read this supplier auto-parts purchase invoice. Return ONLY JSON with this shape: ' +
    '{"supplier_name":string,"ref_no":string,"invoice_date":"YYYY-MM-DD","total":number,' +
    '"items":[{"codes":[string],"description":string,"qty":number,"unit_price":number,"amount":number,"category":string}]}. ' +
    'For each line item, "codes" = the list of ALL product/part codes for that item. ' +
    'A part code is a short alphanumeric token (letters and/or digits, may contain dashes or a brand prefix such as "APM 927Q"), e.g. "CXA-0578","1643ZY","CD-2119BB","720505","KM7194","FEW-R126". ' +
    'A code is NOT: a vehicle model (JAZZ, FREED, CRZ), a part type (CONDENSER, RADIATOR), a generic word (OEM, HQ, NEW), a unit (UNIT, PCS), or any shelf / "Group" / location column value (e.g. "A6.1") — IGNORE those. ' +
    'If the invoice has a clean Item Code column, that single code is the only entry in "codes". If several codes are embedded in the description, include them ALL, in the order they appear. ' +
    '"description" = a clean human description of the item WITHOUT the codes: item type + vehicle model + year, e.g. "CONDENSER W/DRIER JAZZ FREED CRZ 09". ' +
    'Include every line item. ref_no is the supplier invoice number. If a field is missing use null.' +
    catLine +
    textBlock
  );
}

// PRIMARY model is gemini-3.5-flash — it reads part codes accurately (the old gemini-2.0-flash
// misread e.g. HUB227->HUB2327, and is now retired). "thinking" is OFF (thinkingBudget:0): for a
// plain read-and-extract job it adds latency without improving accuracy.
//
// The newest models get transiently overloaded on Google's side (HTTP 503/429/500 — verified:
// 3.5-flash can return 100% 503 for stretches in mid-2026 while OTHER models on the SAME key work
// fine). So we (a) RETRY 3.5-flash within its own time window, then (b) fall back to gemini-2.5-flash
// ONLY if 3.5 is still down. 2.5-flash is a strong, accurate model (NOT the 2.0-flash that misread)
// and stays healthy when 3.5 is swamped. The review screen flags which model was used so a backup
// read gets extra human scrutiny before it reaches Niagawan.
type ReadTier = { name: string; untilMs: number };
const READ_TIERS: ReadTier[] = [
  { name: 'gemini-3.5-flash', untilMs: 32000 }, // primary gets the first ~32s
  { name: 'gemini-2.5-flash', untilMs: 52000 }, // backup uses the remainder (it answers in ~2s)
];
const OVERALL_MS = 52000; // stay safely under Vercel's 60s function cap
const ATTEMPT_MS = 28000; // per-attempt hard timeout (a slow-but-working read can take ~30s)

async function geminiExtract(base64: string, key: string, prompt: string): Promise<{ text: string; model: string }> {
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: base64 } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  });
  const start = Date.now();
  let lastErr = '';
  let attempts = 0;

  for (const tier of READ_TIERS) {
    const tierDeadline = Math.min(tier.untilMs, OVERALL_MS);
    while (Date.now() - start < tierDeadline - 1500) {
      attempts++;
      const remaining = tierDeadline - (Date.now() - start);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(ATTEMPT_MS, remaining));
      let transient = false;
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${tier.name}:generateContent?key=${key}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal }
        );
        if (r.ok) {
          const j = await r.json();
          const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return { text, model: tier.name };
          lastErr = `${tier.name} empty response`;
          transient = true;
        } else if (r.status === 503 || r.status === 429 || r.status === 500) {
          lastErr = `${tier.name} HTTP ${r.status} — overloaded`;
          transient = true;
        } else {
          lastErr = `${tier.name} HTTP ${r.status}`; // non-transient — give up on this tier, try next
          break;
        }
      } catch (e: unknown) {
        lastErr = `${tier.name} ${e instanceof Error && e.name === 'AbortError' ? 'timed out' : (e instanceof Error ? e.message : String(e))}`;
        transient = true;
      } finally {
        clearTimeout(timer);
      }
      if (!transient) break;
      if (Date.now() - start < tierDeadline - 3000) {
        await new Promise((res) => setTimeout(res, 1000));
      }
    }
    // tier exhausted (still failing) — fall through to the next (backup) model
  }
  throw new Error('AI read failed: ' + lastErr + ` (after ${attempts} attempt${attempts === 1 ? '' : 's'})`);
}

export async function POST(req: Request) {
  let id: string | null = null;
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    id = body?.id ?? null;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await admin.from('pinv').update({ status: 'extracting', updated_at: new Date().toISOString() }).eq('id', id);

    const { data: row } = await admin.from('pinv').select('file_path').eq('id', id).maybeSingle();
    if (!row?.file_path) throw new Error('No PDF on file');

    const { data: blob, error: dErr } = await admin.storage.from('pinv').download(row.file_path);
    if (dErr || !blob) throw new Error('Could not read the PDF: ' + (dErr?.message ?? ''));
    const ab = await blob.arrayBuffer();
    const base64 = Buffer.from(ab).toString('base64');

    // Extract the PDF's real text layer. For digital invoices this is exact (no OCR), and we
    // feed it to the AI as the authoritative source for codes. If there's essentially no text,
    // it's a scanned/photo PDF — stop rather than risk a silent misread.
    const invoiceText = await extractPdfText(ab);
    if (normForMatch(invoiceText).length < 40) {
      throw new Error('This looks like a scanned/photo PDF (no readable text layer). Please upload a digital PDF invoice.');
    }
    const textNorm = normForMatch(invoiceText);

    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
    if (!secret?.value) throw new Error('AI key not configured');

    const { data: cats } = await admin.from('niagawan_category').select('name').order('name');
    const categoryNames = (cats ?? []).map((c: { name: string }) => c.name).filter(Boolean);
    const validCats = new Set(categoryNames.map((n) => n.toUpperCase()));

    const { text, model: readModel } = await geminiExtract(base64, secret.value, buildPrompt(categoryNames, invoiceText));
    let parsed: { supplier_name?: string; ref_no?: string; invoice_date?: string; total?: number; items?: unknown[] };
    try { parsed = JSON.parse(text); } catch { throw new Error('AI returned invalid data'); }
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    await admin.from('pinv').update({
      supplier_name: parsed.supplier_name ?? null,
      ref_no: parsed.ref_no ?? null,
      invoice_date: typeof parsed.invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice_date) ? parsed.invoice_date : null,
      total: Number.isFinite(Number(parsed.total)) ? Number(parsed.total) : null,
      status: 'extracted',
      note: null,
      read_model: readModel, // which AI actually read it (primary 3.5 vs backup 2.5) — shown on review
      resolve_status: 'queued', // NAS will look up each item's existence + category in Niagawan
      updated_at: new Date().toISOString(),
    }).eq('id', id);

    await admin.from('pinv_item').delete().eq('pinv_id', id);
    if (items.length) {
      const rows = items.map((raw, i) => {
        const it = raw as { item_code?: unknown; codes?: unknown; description?: unknown; qty?: unknown; unit_price?: unknown; amount?: unknown; category?: unknown };
        const cat = String(it.category ?? '').trim();
        // Normalise the codes list (fallback to a single item_code if the model returned that).
        let codes = Array.isArray(it.codes) ? it.codes.map((c) => String(c ?? '').trim()).filter(Boolean) : [];
        if (codes.length === 0 && it.item_code) { const c = String(it.item_code).trim(); if (c) codes = [c]; }
        // Verify every code actually appears in the invoice's own text layer. If a code is NOT
        // found, the AI likely misread it — flag it so the Review screen can highlight it red.
        const code_verified = codes.length > 0 && codes.every((c) => textNorm.includes(normForMatch(c)));
        return {
          pinv_id: id,
          line_no: i + 1,
          item_code: codes[0] ?? null, // primary code, for display
          codes,
          description: String(it.description ?? '').trim() || null,
          qty: Number(it.qty) || 0,
          unit_price: Number(it.unit_price) || 0,
          amount: Number(it.amount) || 0,
          category: cat && validCats.has(cat.toUpperCase()) ? cat : 'SPARE PARTS ITEM',
          code_verified,
        };
      });
      await admin.from('pinv_item').insert(rows);
      const flagged = rows.filter((r) => !r.code_verified).length;
      return NextResponse.json({ ok: true, items: items.length, model: readModel, flagged });
    }

    return NextResponse.json({ ok: true, items: items.length, model: readModel, flagged: 0 });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    if (id) { try { await admin.from('pinv').update({ status: 'error', note: m.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id); } catch { /* ignore */ } }
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
