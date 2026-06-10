import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 60;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function buildPrompt(categoryNames: string[]): string {
  const catLine = categoryNames.length
    ? ' For each item also pick the single best "category" from EXACTLY this list (copy the name verbatim, do not invent new ones): ' +
      categoryNames.join(' | ') + '. If unsure, use "SPARE PARTS ITEM".'
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
    catLine
  );
}

// We use ONE model — gemini-3.5-flash — because it reads part codes accurately (the old
// gemini-2.0-flash misread e.g. HUB227->HUB2327). "thinking" is turned OFF (thinkingBudget:0):
// for a plain read-and-extract job it adds latency without improving accuracy, so disabling it
// makes the model fast enough to finish inside Vercel's 60s cap.
//
// The model itself can be transiently overloaded on Google's side (HTTP 503 / 429 / 500), which
// shows up as the request hanging then failing. So instead of falling back to a different model,
// we RETRY gemini-3.5-flash a few times within an overall deadline. Non-transient errors
// (400/403/404) stop immediately — retrying those is pointless.
const READ_MODEL = 'gemini-3.5-flash';

async function geminiExtract(base64: string, key: string, prompt: string): Promise<string> {
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: base64 } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  });
  const OVERALL_MS = 52000; // stay safely under Vercel's 60s function cap
  // Per-attempt timeout is generous: when 3.5-flash is slow-but-working (overloaded but not
  // refusing), a big invoice can need 30-45s to finish. A short cap would chop a read that
  // would have succeeded. Fast failures (503) still return in ~1s, so retries still happen for
  // those; this long cap only matters when the model actually accepts and is grinding.
  const ATTEMPT_MS = 46000;
  const start = Date.now();
  let lastErr = '';
  let attempts = 0;

  while (Date.now() - start < OVERALL_MS - 1500) {
    attempts++;
    const remaining = OVERALL_MS - (Date.now() - start);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(ATTEMPT_MS, remaining));
    let transient = false;
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${READ_MODEL}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal }
      );
      if (r.ok) {
        const j = await r.json();
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
        lastErr = `${READ_MODEL} empty response`;
        transient = true; // worth one more try
      } else if (r.status === 503 || r.status === 429 || r.status === 500) {
        lastErr = `${READ_MODEL} HTTP ${r.status} — Google is overloaded, please try again shortly`;
        transient = true;
      } else {
        lastErr = `${READ_MODEL} HTTP ${r.status}`; // non-transient — stop
        break;
      }
    } catch (e: unknown) {
      lastErr = `${READ_MODEL} ${e instanceof Error && e.name === 'AbortError' ? 'timed out' : (e instanceof Error ? e.message : String(e))}`;
      transient = true; // timeout — Google was slow, retry if time allows
    } finally {
      clearTimeout(timer);
    }
    if (!transient) break;
    // brief backoff before retrying, only if meaningful time remains
    if (Date.now() - start < OVERALL_MS - 3000) {
      await new Promise((res) => setTimeout(res, 1200));
    }
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
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');

    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
    if (!secret?.value) throw new Error('AI key not configured');

    const { data: cats } = await admin.from('niagawan_category').select('name').order('name');
    const categoryNames = (cats ?? []).map((c: { name: string }) => c.name).filter(Boolean);
    const validCats = new Set(categoryNames.map((n) => n.toUpperCase()));

    const text = await geminiExtract(base64, secret.value, buildPrompt(categoryNames));
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
        };
      });
      await admin.from('pinv_item').insert(rows);
    }

    return NextResponse.json({ ok: true, items: items.length });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    if (id) { try { await admin.from('pinv').update({ status: 'error', note: m.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id); } catch { /* ignore */ } }
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
