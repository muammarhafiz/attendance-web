import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const maxDuration = 45;

// Service-role client — ONLY to read the shared Gemini key from app_secrets (service-role table).
// Every data skill is run through the USER's client below, so RLS + can_access() still apply per caller.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type ChatMsg = { role: 'user' | 'assistant'; content: string };

// The assistant's read-only "skills". Each maps to a SECURITY-DEFINER RPC that re-checks
// can_access('assistant') internally, so a skill can never return more than the caller may see.
// Declarations are sent to Gemini; `rpc` is the function the server runs when the model asks.
const SKILLS: Record<string, { rpc: string; arg: string; decl: Record<string, unknown> }> = {
  product_search: {
    rpc: 'assistant_product_search',
    arg: 'q',
    decl: {
      name: 'product_search',
      description:
        'Search the shop parts/products catalogue for price and live stock. Use this for ANY question about a part, product, engine oil, its price, or whether it is in stock. Pass concise keywords including the car model and part, e.g. "x70 brake pad" or "perodua 5w30 4l". Prefer fewer, broader words to get more options.',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'search keywords' } }, required: ['query'] },
    },
  },
  invoice_lookup: {
    rpc: 'assistant_invoice_lookup',
    arg: 'q',
    decl: {
      name: 'invoice_lookup',
      description:
        'Look up sales invoices by invoice number (e.g. "S2605112") or by car plate / customer (e.g. "WYU6175"). Returns invoice date, amount, paid amount and status.',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'invoice number, plate, or customer name' } }, required: ['query'] },
    },
  },
};

const SYSTEM_PROMPT = `You are ZORDAQ Auto Service's in-app assistant for workshop staff. ZORDAQ is a Malaysian car workshop (servicing, parts, engine oils). Reply briefly and practically, in the SAME language the person writes (Malay, English, or a mix).

You have tools that read the shop's REAL live data. Follow these rules strictly:
- For anything about a part, product, oil, price or stock, you MUST call product_search. Never recall or guess a price, SKU or stock level — only state values a tool actually returned in this conversation.
- For a sales invoice (by invoice number or car plate), call invoice_lookup.
- If a tool returns nothing, say you couldn't find it — do not invent an answer or a number.
- When you list products, show each option with its price and whether it is in stock (stock > 0) or an "order item" (stock 0 / not tracked). Keep it short; the staff will pick.
- If you are asked something none of your tools can answer (e.g. payroll, salaries, profit, sales totals), say briefly that you can't help with that yet. Do not make anything up.
- Money is Malaysian Ringgit (RM).`;

const GEMINI_MODELS = ['gemini-2.5-flash']; // cheap + supports tool calling; add a backup tier later if needed
const MAX_TOOL_CALLS = 5;

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
};
type GeminiContent = { role: string; parts: GeminiPart[] };

async function callGemini(key: string, contents: GeminiContent[]): Promise<GeminiContent | null> {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    tools: [{ function_declarations: Object.values(SKILLS).map((s) => s.decl) }],
    generationConfig: { temperature: 0.2 },
  });
  for (const model of GEMINI_MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal }
      );
      if (!r.ok) continue; // transient/overloaded — try the next model tier
      const j = await r.json();
      const c = j?.candidates?.[0]?.content;
      if (c?.parts) return c as GeminiContent;
    } catch {
      // timeout / network — fall through to next tier
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function POST(req: Request) {
  try {
    // Auth: a signed-in user whose position has the 'assistant' feature (or an Owner/admin).
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: allowed } = await sb.rpc('can_access', { p_feature: 'assistant' });
    if (allowed !== true) return NextResponse.json({ error: 'You do not have access to the assistant.' }, { status: 403 });

    const body = await req.json();
    const history: ChatMsg[] = Array.isArray(body?.messages) ? body.messages : [];
    const trimmed = history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-16);
    if (!trimmed.length || trimmed[trimmed.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'No question' }, { status: 400 });
    }

    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
    if (!secret?.value) return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
    const key = secret.value as string;

    // Seed Gemini contents from the chat history (assistant -> model).
    const contents: GeminiContent[] = trimmed.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const used: string[] = [];
    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      const content = await callGemini(key, contents);
      if (!content) return NextResponse.json({ error: 'The assistant is busy right now — please try again.' }, { status: 503 });

      const fcParts = content.parts.filter((p) => p.functionCall);
      if (!fcParts.length) {
        const reply = content.parts.map((p) => p.text).filter(Boolean).join('').trim();
        return NextResponse.json({ reply: reply || "Sorry, I didn't catch that — try rephrasing.", used });
      }

      // The model asked for one or more skills. Run each through the USER's client so access
      // rules (can_access / RLS) apply exactly as they would anywhere else in the app.
      contents.push(content); // the model's functionCall turn
      const responseParts: GeminiPart[] = [];
      for (const p of fcParts) {
        const fc = p.functionCall!;
        const skill = SKILLS[fc.name];
        let result: unknown = { error: 'unknown skill' };
        if (skill) {
          used.push(fc.name);
          const q = String((fc.args as Record<string, unknown>)?.query ?? '').slice(0, 200);
          const { data, error } = await sb.rpc(skill.rpc, { [skill.arg]: q });
          result = error ? { error: error.message } : { result: data ?? [] };
        }
        responseParts.push({ functionResponse: { name: fc.name, response: result } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    // Exhausted the tool-call budget without a final text answer.
    return NextResponse.json({ reply: 'That turned into a lot of steps — can you narrow the question a bit?', used });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
