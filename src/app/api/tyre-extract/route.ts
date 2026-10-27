import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
import { extractText, getDocumentProxy } from 'unpdf';
import { logAiUsage } from '@/lib/aiUsage';

export const runtime = 'nodejs';
export const maxDuration = 60;

// WHY THIS ROUTE IS SPLIT INTO MODES
// ----------------------------------
// A serverless function is hard-killed by Vercel at 60s. A supplier tyre price list can be 7+ pages
// and ~200 rows — reading the whole thing in one request simply cannot finish inside 60s (and firing
// many Gemini calls at once on one key makes Google serialise them, which is even slower). The invoice
// reader (pinv/extract) survives the 60s cap only because an invoice is ONE small call.
//
// So the page LOOP lives in the browser instead (src/app/tyres-admin/page.tsx), which has no time cap.
// This route only ever does ONE bounded unit of work per request, and therefore always finishes well
// under 60s:
//   • mode:'split'  — pull the PDF's per-page text layer with unpdf (no AI). Fast; one upload.
//   • mode:'page'   — read ONE page's text with ONE Gemini call. ~10-30s.
//   • mode:'vision' — read ONE image/photo (or a scanned file) with ONE Gemini call. ~10-30s.
// The browser calls 'split' once, then 'page' once per page (limited concurrency + a progress bar),
// and merges the rows. A single file with no text layer (a photo) goes straight to 'vision'.

// Service-role client — ONLY to read the shared Gemini key from app_secrets. The caller is
// authenticated + admin-checked below before anything runs.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Shared field rules — same meaning for the per-page text path and the image/vision path.
const RULES =
  'Return ONLY JSON of this shape: {"rows":[{"brand":string,"model":string,"size":string,"cost":number,"retail":number,"origin":string,"load_speed":string}]}. ' +
  'One object per tyre line. Rules: ' +
  'brand = the tyre brand (e.g. Kumho, Goodyear, Kinto, Leao, Rovelo). If the whole list is for ONE brand named only in its header/title and not repeated on each line, use that brand for every row; if no brand is shown anywhere, use "". ' +
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

// Each request makes AT MOST ONE Gemini call, so it gets the WHOLE function budget — no need to
// chop time between models. Try the newest Flash first with a real window + retry on overload
// (503/429/500), then fall back only if it stays down. Models current Oct 2026: gemini-3.8-flash is
// the newest GA Flash; gemini-3.6-flash is the live successor to the deprecated gemini-3.5-flash;
// gemini-2.5-flash is a known-good last resort on this key.
type ReadTier = { name: string; untilMs: number };
const READ_TIERS: ReadTier[] = [
  { name: 'gemini-3.8-flash', untilMs: 38000 }, // primary — generous window for one page/image
  { name: 'gemini-3.6-flash', untilMs: 48000 },
  { name: 'gemini-2.5-flash', untilMs: 54000 },
];
const OVERALL_MS = 54000; // stay safely under the 60s function cap
const ATTEMPT_MS = 40000; // one page/image read of ~25 rows takes ~10-30s; allow headroom

async function gemini(parts: Record<string, unknown>[], key: string): Promise<string> {
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  });
  const start = Date.now();
  let lastErr = '';
  for (const tier of READ_TIERS) {
    const tierDeadline = Math.min(tier.untilMs, OVERALL_MS);
    while (Date.now() - start < tierDeadline - 1500) {
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
          if (text) { await logAiUsage(admin, { feature: 'tyre', model: tier.name, usage: j?.usageMetadata }); return text as string; }
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
      if (Date.now() - start < tierDeadline - 3000) await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw new Error(lastErr || 'no response');
}

// Pull the real text layer of a (digital) PDF, one string per page. '' / near-empty pages are dropped.
// NOTE: unpdf/pdf.js THROWS "Please provide binary data as `Uint8Array`, rather than `Buffer`" if given
// a Node Buffer, so always hand it a plain Uint8Array (a Buffer is a Uint8Array subclass but is rejected).
// This exact bug made split return 0 pages -> the client fell back to a whole-PDF vision call that timed out.
async function extractPageTexts(buf: Uint8Array): Promise<string[]> {
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

// Turn one model response into clean, usable rows (normalise + drop unpriced + dedupe within the call).
// The browser dedupes AGAIN across pages when it merges, so a tyre repeated across page breaks is fine.
type OutRow = { brand: string; model: string; size: string; cost: number | null; retail: number | null; origin: string; load_speed: string };
function normalizeRows(resp: string): OutRow[] {
  const seen = new Set<string>();
  const rows: OutRow[] = [];
  for (const r of parseRows(resp)) {
    const row: OutRow = {
      brand: String(r.brand ?? '').trim(),
      model: String(r.model ?? r.pattern ?? '').trim(),
      size: normSize(String(r.size ?? '')),
      cost: num(r.cost),
      retail: num(r.retail),
      origin: String(r.origin ?? '').trim(),
      load_speed: String(r.load_speed ?? r.loadSpeed ?? '').trim(),
    };
    if (!row.size || !row.cost) continue; // keep priced rows; brand may be blank on single-brand lists (filled in the UI)
    const k = `${row.brand}|${row.size}|${row.model}|${row.cost}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(row);
  }
  return rows;
}

async function geminiKey(): Promise<string> {
  const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
  if (!secret?.value) throw new Error('AI key not configured');
  return secret.value as string;
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
    const mode = typeof body?.mode === 'string' ? body.mode : '';

    // ---- mode:'split' — just pull the per-page text layer (no AI). The browser then reads each page.
    if (mode === 'split') {
      const data = typeof body?.data === 'string' ? body.data : '';
      if (!data) return NextResponse.json({ error: 'No file' }, { status: 400 });
      if (data.length > 14_000_000) return NextResponse.json({ error: 'File too large — please send a smaller PDF (under ~10MB).' }, { status: 413 });
      const pages = await extractPageTexts(Buffer.from(data, 'base64'));
      // pages:[] means no readable text layer (a scanned/photo PDF) → the browser falls back to vision.
      return NextResponse.json({ pages });
    }

    // ---- mode:'page' — read ONE page's extracted text with ONE Gemini call.
    if (mode === 'page') {
      const pageText = typeof body?.pageText === 'string' ? body.pageText : '';
      if (pageText.trim().length < 10) return NextResponse.json({ rows: [] });
      const key = await geminiKey();
      const resp = await gemini(
        [{ text: `${TEXT_PROMPT}\n\n<<<PAGE_TEXT>>>\n${pageText.slice(0, 26000)}\n<<<END_PAGE_TEXT>>>` }],
        key
      );
      return NextResponse.json({ rows: normalizeRows(resp) });
    }

    // ---- mode:'vision' (and the default) — read ONE image/photo (or scanned file) with ONE call.
    const data = typeof body?.data === 'string' ? body.data : '';
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType ? body.mimeType : 'application/pdf';
    if (!data) return NextResponse.json({ error: 'No file' }, { status: 400 });
    if (data.length > 14_000_000) return NextResponse.json({ error: 'File too large — please send a smaller file (under ~10MB).' }, { status: 413 });
    const key = await geminiKey();
    const resp = await gemini([{ inline_data: { mime_type: mimeType, data } }, { text: VISION_PROMPT }], key);
    return NextResponse.json({ rows: normalizeRows(resp) });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'AI read failed: ' + m }, { status: 500 });
  }
}
