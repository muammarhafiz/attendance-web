import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Service-role client — ONLY to read the shared Gemini key from app_secrets. The caller is
// authenticated + admin-checked below before anything runs.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const PROMPT =
  'Read this TYRE supplier price list (a PDF or photo) and extract every tyre line. ' +
  'Return ONLY JSON of this shape: {"rows":[{"brand":string,"model":string,"size":string,"cost":number,"retail":number,"origin":string,"load_speed":string}]}. ' +
  'One object per tyre line. Rules: ' +
  'brand = the tyre brand (e.g. Kumho, Goodyear, Kinto, Leao). ' +
  'model = the pattern / model name or code (e.g. "HP71", "Ecsta PS31", "V-36"); use "" if the line shows only a brand with no model. ' +
  'size = the tyre size as WIDTH/PROFILE R RIM joined like "225/55R19" (normalise "225/55/19", "225 55 19", "225/55 R19" all to "225/55R19"; for a light-truck size keep it like "265/65R17"). ' +
  'cost = the DEALER / NETT price for ONE piece in Malaysian Ringgit, as a plain number. If the list shows both a 4-piece price and a 1-piece (unit) price, use the 1-piece price. If ONLY a set-of-4 price is shown, divide it by 4. If both a nett/cost and a suggested retail are shown, cost is the lower nett/dealer price. ' +
  'retail = the suggested RETAIL / selling price per piece as a number IF the list prints one (some lists do, e.g. Kinto); otherwise use "" (empty). Do NOT invent a retail. ' +
  'origin = country of manufacture if shown (Thailand, Vietnam, China, Indonesia, Korea…), else "". ' +
  'load_speed = the load/speed index if shown (e.g. "91V", "103W XL"), else "". ' +
  'Include EVERY tyre row. Ignore headers, column titles, totals, page numbers and promo footnotes. ' +
  'Use "" for any missing text field, and omit a row only if it has no price at all.';

// Same overload-resilient tiering as the invoice reader: try the accurate 3.5-flash, fall back to
// 2.5-flash if Google is returning 503/429/500 for the newer model.
const READ_TIERS = [
  { name: 'gemini-3.5-flash', untilMs: 22000 },
  { name: 'gemini-2.5-flash', untilMs: 52000 },
];
const OVERALL_MS = 52000;
const ATTEMPT_MS = 30000;

async function geminiExtract(base64: string, mimeType: string, key: string): Promise<string> {
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: PROMPT }] }],
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
      if (Date.now() - start < tierDeadline - 3000) await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw new Error('AI read failed: ' + lastErr);
}

// Normalise a size the model returned to WIDTH/PROFILERRIM (digits + R), tolerant of odd spacing.
function normSize(s: string): string {
  const m = String(s ?? '').toUpperCase().match(/(\d{2,3})\D+(\d{2})\D*R?\D*(\d{2})/);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : String(s ?? '').trim();
}
const num = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

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
    // Guard the payload size (base64 of ~10MB). Vercel body limit + Gemini sanity.
    if (data.length > 14_000_000) return NextResponse.json({ error: 'File too large — please send a smaller PDF (under ~10MB).' }, { status: 413 });

    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
    if (!secret?.value) return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });

    const text = await geminiExtract(data, mimeType, secret.value as string);
    let parsed: { rows?: unknown };
    try { parsed = JSON.parse(text); } catch { return NextResponse.json({ error: 'AI returned invalid data — try a clearer PDF.' }, { status: 502 }); }
    const raw = Array.isArray(parsed?.rows) ? parsed.rows : (Array.isArray(parsed) ? (parsed as unknown[]) : []);
    const rows = raw.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        brand: String(o.brand ?? '').trim(),
        model: String(o.model ?? o.pattern ?? '').trim(),
        size: normSize(String(o.size ?? '')),
        cost: num(o.cost),
        retail: num(o.retail),
        origin: String(o.origin ?? '').trim(),
        load_speed: String(o.load_speed ?? o.loadSpeed ?? '').trim(),
      };
    }).filter((r) => r.brand && r.size && r.cost); // keep only usable, priced rows

    return NextResponse.json({ rows, count: rows.length });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
