import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
import { extractText, getDocumentProxy } from 'unpdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Service-role client — ONLY to read the shared Gemini key from app_secrets. The caller is
// authenticated + admin-checked below before anything runs.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Shared field rules — same meaning for the text path and the image/vision fallback.
const RULES =
  'Return ONLY JSON of this shape: {"rows":[{"brand":string,"model":string,"size":string,"cost":number,"retail":number,"origin":string,"load_speed":string}]}. ' +
  'One object per tyre line. Rules: ' +
  'brand = the tyre brand (e.g. Kumho, Goodyear, Kinto, Leao, Rovelo). ' +
  'model = the pattern / model name or code (e.g. "HP71", "Ecsta PS31", "RHP-A68"); use "" if the line shows only a brand with no model. ' +
  'size = the tyre size as WIDTH/PROFILE R RIM joined like "225/55R19" (normalise "225/55/19", "225 55 19", "155 / 70 R 12" all to e.g. "155/70R12"). ' +
  'cost = the DEALER / NETT / INVOICE price for ONE piece in Malaysian Ringgit, as a plain number. If both a 4-piece and a 1-piece price are shown, use the 1-piece; if ONLY a set-of-4 price is shown, divide it by 4; if both a nett/cost and a retail are shown, cost is the lower nett/dealer/invoice price. ' +
  'retail = the suggested RETAIL / recommended selling price per piece as a number IF the list prints one (some lists do, e.g. Kinto); otherwise use "". Do NOT invent a retail. ' +
  'origin = country of manufacture if shown (Thailand, Vietnam, China, Indonesia, Korea…), else "". ' +
  'load_speed = the load/speed index if shown (e.g. "73T", "91V", "103W XL"), else "". ' +
  'Include EVERY tyre row. Ignore the supplier name/address, column titles, headers, totals, page numbers and promo footnotes. ' +
  'Use "" for any missing text field, and omit a row only if it has no price at all.';

const TEXT_PROMPT =
  'The text below was extracted directly from ONE page of a tyre supplier price list (character-for-character, not OCR). ' +
  'It is the authoritative source — copy sizes, codes and prices exactly as they appear. Extract every tyre line. ' + RULES;
const VISION_PROMPT = 'Read this TYRE supplier price list (a PDF or photo) and extract every tyre line. ' + RULES;

// Overload-resilient tiering (same idea as the invoice reader): try the LATEST Flash model first,
// retrying within its window, then fall back only if Google returns 503/429/500 or the model isn't
// available. Models current as of Oct 2026: gemini-3.8-flash is the newest GA Flash; gemini-3.6-flash
// is the live successor to the now-deprecated gemini-3.5-flash; gemini-2.5-flash is a known-good last
// resort on this key. The window/attempt are scaled per call so the per-page text calls (small output)
// run fast and the single vision call gets a long slot.
const READ_TIERS = [
  { name: 'gemini-3.8-flash', frac: 0.3 }, // latest (GA Sep 2026) — accurate primary
  { name: 'gemini-3.6-flash', frac: 0.6 }, // current prod successor to the deprecated 3.5-flash
  { name: 'gemini-2.5-flash', frac: 1.0 }, // known-good last resort on this key
];

async function gemini(parts: Record<string, unknown>[], key: string, overallMs: number, attemptMs: number): Promise<string> {
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  });
  const start = Date.now();
  let lastErr = '';
  for (const tier of READ_TIERS) {
    const tierDeadline = Math.min(Math.round(overallMs * tier.frac), overallMs);
    while (Date.now() - start < tierDeadline - 1200) {
      const remaining = tierDeadline - (Date.now() - start);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(attemptMs, remaining));
      let transient = false;
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${tier.name}:generateContent?key=${key}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal }
        );
        if (r.ok) {
          const j = await r.json();
          const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text as string;
          lastErr = `${tier.name} empty response`; transient = true;
        } else if (r.status === 503 || r.status === 429 || r.status === 500) {
          lastErr = `${tier.name} HTTP ${r.status} — overloaded`; transient = true;
        } else {
          lastErr = `${tier.name} HTTP ${r.status}`; break;
        }
      } catch (e: unknown) {
        lastErr = `${tier.name} ${e instanceof Error && e.name === 'AbortError' ? 'timed out' : (e instanceof Error ? e.message : String(e))}`;
        transient = true;
      } finally {
        clearTimeout(timer);
      }
      if (!transient) break;
      if (Date.now() - start < tierDeadline - 2500) await new Promise((res) => setTimeout(res, 800));
    }
  }
  throw new Error(lastErr);
}

// Pull the real text layer of a (digital) PDF, one string per page. '' pages are dropped.
async function extractPageTexts(buf: ArrayBuffer): Promise<string[]> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [String(text ?? '')];
    return pages.map((t) => String(t ?? '').trim()).filter((t) => t.length > 20);
  } catch {
    return [];
  }
}

function normSize(s: string): string {
  const m = String(s ?? '').toUpperCase().match(/(\d{2,3})\D+(\d{2})\D*R?\D*(\d{2})/);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : String(s ?? '').trim();
}
const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
function parseRows(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  const p = parsed as { rows?: unknown };
  const raw = Array.isArray(p?.rows) ? p.rows : (Array.isArray(parsed) ? (parsed as unknown[]) : []);
  return raw as Record<string, unknown>[];
}

export async function POST(req: Request) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: isAdmin } = await sb.rpc('is_admin');
    if (isAdmin !== true) return NextResponse.json({ error: 'Admins only' }, { status: 403 });

    const body = await req.json();
    const data = typeof body?.data === 'string' ? body.data : '';
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType ? body.mimeType : 'application/pdf';
    if (!data) return NextResponse.json({ error: 'No file' }, { status: 400 });
    if (data.length > 14_000_000) return NextResponse.json({ error: 'File too large — please send a smaller PDF (under ~10MB).' }, { status: 413 });

    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
    if (!secret?.value) return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
    const key = secret.value as string;

    // FAST PATH — a digital (text) PDF: pull its text layer locally (unpdf, no OCR, instant) and
    // structure it ONE PAGE AT A TIME in parallel. Keeping each call's output small (~a page of
    // tyres) is what stops a long multi-page list from timing out trying to emit ~hundreds of rows
    // in a single request. Mirrors how pinv/extract reads invoices, extended for big price lists.
    let responses: string[];
    let pageTexts: string[] = [];
    if (mimeType === 'application/pdf') {
      pageTexts = await extractPageTexts(Buffer.from(data, 'base64'));
    }
    if (pageTexts.length > 0 && pageTexts.reduce((n, t) => n + t.length, 0) > 300) {
      // run all pages in parallel; each call reads one page's text only. If ANY page fails after its
      // retries, the whole read fails (better than silently importing a partial price list).
      responses = await Promise.all(
        pageTexts.map((pt) => gemini([{ text: `${TEXT_PROMPT}\n\n<<<PAGE_TEXT>>>\n${pt.slice(0, 18000)}\n<<<END_PAGE_TEXT>>>` }], key, 45000, 28000))
      );
    } else {
      // VISION FALLBACK — a photo, or a scanned PDF with no readable text layer: one long call that
      // sends the file to the model directly (gets the full budget under the 60s function cap).
      responses = [await gemini([{ inline_data: { mime_type: mimeType, data } }, { text: VISION_PROMPT }], key, 55000, 50000)];
    }

    // merge every page's rows, normalise, and dedupe (a tyre repeated across pages / a header row).
    const seen = new Set<string>();
    const rows: { brand: string; model: string; size: string; cost: number | null; retail: number | null; origin: string; load_speed: string }[] = [];
    for (const resp of responses) {
      for (const r of parseRows(resp)) {
        const row = {
          brand: String(r.brand ?? '').trim(),
          model: String(r.model ?? r.pattern ?? '').trim(),
          size: normSize(String(r.size ?? '')),
          cost: num(r.cost),
          retail: num(r.retail),
          origin: String(r.origin ?? '').trim(),
          load_speed: String(r.load_speed ?? r.loadSpeed ?? '').trim(),
        };
        if (!row.brand || !row.size || !row.cost) continue; // keep only usable, priced rows
        const k = `${row.brand}|${row.size}|${row.model}|${row.cost}`.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push(row);
      }
    }

    return NextResponse.json({ rows, count: rows.length });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'AI read failed: ' + m }, { status: 500 });
  }
}
