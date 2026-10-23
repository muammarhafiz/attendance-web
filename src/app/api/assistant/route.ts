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

const clampInt = (v: unknown, def: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
};

// The assistant's read-only "skills". Each maps to a SECURITY-DEFINER RPC that re-checks the
// caller's access internally, so a skill can never return more than the caller may see. `feature`
// is the permission the caller needs for the skill to be offered at all (financial skills -> 'pnl',
// so staff without P&L access never even see them). `params` maps the model's args to the RPC call.
type Skill = {
  rpc: string;
  feature: 'assistant' | 'pnl';
  decl: Record<string, unknown>;
  params: (args: Record<string, unknown>) => Record<string, unknown>;
};

const SKILLS: Record<string, Skill> = {
  product_search: {
    rpc: 'assistant_product_search', feature: 'assistant',
    params: (a) => ({ q: String(a.query ?? '').slice(0, 200) }),
    decl: {
      name: 'product_search',
      description:
        'Search the shop parts/products catalogue for price and live stock. Use for ANY question about a part, product, engine oil, its price, or whether it is in stock. Pass concise keywords including the car model and part, e.g. "x70 brake pad front" or "perodua 5w30 4l".',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'search keywords' } }, required: ['query'] },
    },
  },
  invoice_lookup: {
    rpc: 'assistant_invoice_lookup', feature: 'assistant',
    params: (a) => ({ q: String(a.query ?? '').slice(0, 200) }),
    decl: {
      name: 'invoice_lookup',
      description:
        'Look up sales invoices by invoice number (e.g. "S2605112") or by car plate / customer (e.g. "WYU6175"). Returns date, amount, paid amount and status.',
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'invoice number, plate, or customer name' } }, required: ['query'] },
    },
  },
  car_history: {
    rpc: 'assistant_car_history', feature: 'assistant',
    params: (a) => ({ plate: String(a.plate ?? '').slice(0, 20) }),
    decl: {
      name: 'car_history',
      description:
        "Look up a car's past visits by its number plate — the engine oil it used and how many items, each visit, newest first. Use for \"what oil did this car take last time\", \"what oil for plate X\", or a car's service history. (Older visits may show no oil until history is fully captured.)",
      parameters: { type: 'OBJECT', properties: { plate: { type: 'STRING', description: 'the car number plate, e.g. WXM7689' } }, required: ['plate'] },
    },
  },
  low_stock: {
    rpc: 'assistant_low_stock', feature: 'assistant',
    params: (a) => ({ limit_n: clampInt(a.limit, 20, 40) }),
    decl: {
      name: 'low_stock',
      description: 'List products that are below their minimum stock level (what needs reordering), most-short first, with the total count low. Use for "what is running low / need to reorder". No input needed.',
      parameters: { type: 'OBJECT', properties: { limit: { type: 'INTEGER', description: 'how many items to list (default 20)' } } },
    },
  },
  sales_summary: {
    rpc: 'assistant_sales_summary', feature: 'pnl',
    params: (a) => ({ period: String(a.period ?? 'today').slice(0, 20) }),
    decl: {
      name: 'sales_summary',
      description:
        'Get the shop sales & profit figures for a day or a month. For sales/profit/revenue/margin questions. period must be one of: "today", "yesterday", "this month", "last month", a month as "YYYY-MM", or a day as "YYYY-MM-DD". Convert natural phrases (e.g. a month name) to those forms using today\'s date.',
      parameters: { type: 'OBJECT', properties: { period: { type: 'STRING' } }, required: ['period'] },
    },
  },
  debtors: {
    rpc: 'assistant_debtors', feature: 'pnl',
    params: (a) => ({ limit_n: clampInt(a.limit, 15, 30) }),
    decl: {
      name: 'debtors',
      description: 'List customers/invoices that still owe money (unpaid or partial), biggest balance first, with the total amount owed and how many invoices. Use for "who owes money / debtors / receivables / belum bayar".',
      parameters: { type: 'OBJECT', properties: { limit: { type: 'INTEGER', description: 'how many to list (default 15)' } } },
    },
  },
  cash_count: {
    rpc: 'assistant_cash_count', feature: 'pnl',
    params: (a) => ({ period: String(a.period ?? 'today').slice(0, 20) }),
    decl: {
      name: 'cash_count',
      description:
        "Cash reconciliation for a day or a date range: how much cash Niagawan recorded vs how much the staff physically counted at end of day, and the difference — plus any day that wasn't counted. Use for \"cash count\", \"berapa cash hari ni / semalam\", \"cash this month\", reconcile. period: \"today\", \"yesterday\", \"this month\", \"last month\", a month \"YYYY-MM\", or a day \"YYYY-MM-DD\".",
      parameters: { type: 'OBJECT', properties: { period: { type: 'STRING' } }, required: ['period'] },
    },
  },
};

function systemPrompt(): string {
  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `You are ZORDAQ Auto Service's in-app assistant for workshop staff. ZORDAQ is a Malaysian car workshop (servicing, parts, engine oils). Today is ${today}. Reply briefly and practically, in the SAME language the person writes (Malay, English, or a mix).

You have tools that read the shop's REAL live data. Follow these rules strictly:
- Parts, products, oil, price or stock -> product_search. "What's running low / need to reorder" -> low_stock. A car's past oil / service history by plate ("what oil did this car take last time") -> car_history. A sales invoice -> invoice_lookup. Sales / profit / revenue / margin for a day or month -> sales_summary. Cash count / cash reconcile (Niagawan recorded cash vs the staff's end-of-day physical count) -> cash_count. Who owes money / debtors / receivables -> debtors.
- For sales_summary on a DAY it returns total_invoiced (all invoices billed that day, paid + unpaid) AND collected_so_far (money actually received) — when the person asks "sales today", give both and make the difference clear; don't present total_invoiced as if it were money collected.
- NEVER recall or guess a price, SKU, stock level or figure — only state values a tool actually returned in this conversation. If a tool returns nothing, say you couldn't find it; do not invent an answer.
- For sales_summary, convert the person's words into "today", "yesterday", "this month", "last month", a "YYYY-MM" month, or a "YYYY-MM-DD" day, using today's date above.
- When you list products, show each option with its price and whether it is in stock (stock > 0) or an "order item" (stock 0 / not tracked). Keep it short; the staff will pick. Money is Malaysian Ringgit (RM).
- If you are asked something none of your available tools can answer, say briefly that you can't help with that yet. Do not make anything up.`;
}

const GEMINI_MODELS = ['gemini-2.5-flash'];
const MAX_TOOL_CALLS = 5;

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
};
type GeminiContent = { role: string; parts: GeminiPart[] };

async function callGemini(key: string, contents: GeminiContent[], decls: Record<string, unknown>[]): Promise<GeminiContent | null> {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt() }] },
    contents,
    tools: [{ function_declarations: decls }],
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
      if (!r.ok) continue;
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
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sb = createClientServer(req);
    const { data: auth, error: aErr } = await sb.auth.getUser(token);
    if (aErr || !auth?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: accessData } = await sb.rpc('my_access');
    const access = (accessData ?? {}) as Record<string, boolean>;
    if (access.assistant !== true) return NextResponse.json({ error: 'You do not have access to the assistant.' }, { status: 403 });

    // Only offer skills the caller is allowed to use (e.g. financial skills need 'pnl').
    const availableNames = Object.keys(SKILLS).filter((n) => access[SKILLS[n].feature] === true);
    const decls = availableNames.map((n) => SKILLS[n].decl);

    const body = await req.json();
    const history: ChatMsg[] = Array.isArray(body?.messages) ? body.messages : [];
    const trimmed = history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-16);
    if (!trimmed.length || trimmed[trimmed.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'No question' }, { status: 400 });
    }

    const { data: secret } = await admin.from('app_secrets').select('value').eq('name', 'gemini_key').single();
    if (!secret?.value) return NextResponse.json({ error: 'AI key not configured' }, { status: 500 });
    const key = secret.value as string;

    const contents: GeminiContent[] = trimmed.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const used: string[] = [];
    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      const content = await callGemini(key, contents, decls);
      if (!content) return NextResponse.json({ error: 'The assistant is busy right now — please try again.' }, { status: 503 });

      const fcParts = content.parts.filter((p) => p.functionCall);
      if (!fcParts.length) {
        const reply = content.parts.map((p) => p.text).filter(Boolean).join('').trim();
        return NextResponse.json({ reply: reply || "Sorry, I didn't catch that — try rephrasing.", used });
      }

      // The model asked for one or more skills. Run each through the USER's client so access
      // rules (can_access / RLS) apply exactly as they would anywhere else in the app.
      contents.push(content);
      const responseParts: GeminiPart[] = [];
      for (const p of fcParts) {
        const fc = p.functionCall!;
        const skill = SKILLS[fc.name];
        let result: unknown = { error: 'unknown skill' };
        if (skill && availableNames.includes(fc.name)) {
          used.push(fc.name);
          const { data, error } = await sb.rpc(skill.rpc, skill.params(fc.args || {}));
          result = error ? { error: error.message } : { result: data ?? [] };
        } else if (skill) {
          result = { error: 'You do not have access to that.' };
        }
        responseParts.push({ functionResponse: { name: fc.name, response: result } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    return NextResponse.json({ reply: 'That turned into a lot of steps — can you narrow the question a bit?', used });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
