import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClientServer } from '@/lib/supabaseServer';
import { logAiUsage } from '@/lib/aiUsage';

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
  proton_quote: {
    rpc: 'assistant_proton_quote', feature: 'assistant',
    params: (a) => ({ p_model: String(a.model ?? '').slice(0, 40), p_km: clampInt(a.mileage, 0, 500000) }),
    decl: {
      name: 'proton_quote',
      description:
        'Build a Proton scheduled-service quote for a Geely-platform model at a given mileage. Covers X50, X70 (CBU / CKD / 1.5) and S70. Returns the service items DUE at that mileage, each with our live Niagawan price, a subtotal, and optional add-ons (e.g. brake fluid). Use for "service quote", "sebut harga service", "jadual service / servis" for a Proton X50 / X70 / S70. Pass the model (e.g. "X50", "X70 CKD", "X70 CBU", "X70 1.5", "S70") and the mileage in km (e.g. 80000).',
      parameters: { type: 'OBJECT', properties: { model: { type: 'STRING', description: 'Proton model, e.g. X50, X70 CKD, X70 CBU, X70 1.5, S70' }, mileage: { type: 'INTEGER', description: 'mileage in km, e.g. 80000' } }, required: ['model', 'mileage'] },
    },
  },
  query_database: {
    rpc: 'assistant_query', feature: 'assistant',
    params: (a) => ({ p_sql: String(a.sql ?? '').slice(0, 4000) }),
    decl: {
      name: 'query_database',
      description:
        'Answer ANY data question the other tools do not cover by running a single READ-ONLY SQL SELECT on the shop database (Postgres / Supabase). Use for stock, sales, attendance, suppliers, "what needs reordering", counts, lists, and anything ad-hoc. Only SELECT/WITH, one statement, no writes — it is read-only. Returns up to 100 rows. Prefer the dedicated tools (product_search, proton_quote, sales_summary, invoice_lookup, car_history) when they fit; use this for everything else. See the DATABASE section in the system instructions for the tables and rules.',
      parameters: { type: 'OBJECT', properties: { sql: { type: 'STRING', description: 'a single read-only Postgres SELECT against the tables listed in the DATABASE section' } }, required: ['sql'] },
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
- Parts, products, oil, price or stock -> product_search. "What's running low / need to reorder" -> low_stock. A car's past oil / service history by plate ("what oil did this car take last time") -> car_history. A Proton service quote / "sebut harga service" / service schedule for an X50, X70 (CBU/CKD/1.5) or S70 at a mileage -> proton_quote (pass the model and the mileage in km). A sales invoice -> invoice_lookup. Sales / profit / revenue / margin for a day or month -> sales_summary. Cash count / cash reconcile (Niagawan recorded cash vs the staff's end-of-day physical count) -> cash_count. Who owes money / debtors / receivables -> debtors.
- For sales_summary on a DAY it returns total_invoiced (all invoices billed that day, paid + unpaid) AND collected_so_far (money actually received) — when the person asks "sales today", give both and make the difference clear; don't present total_invoiced as if it were money collected.
- NEVER recall or guess a price, SKU, stock level or figure — only state values a tool actually returned in this conversation. If a tool returns nothing, say you couldn't find it; do not invent an answer.
- For sales_summary, convert the person's words into "today", "yesterday", "this month", "last month", a "YYYY-MM" month, or a "YYYY-MM-DD" day, using today's date above.
- When you list products, show each option with its price and whether it is in stock (stock > 0) or an "order item" (stock 0 / not tracked). Keep it short; the staff will pick. Money is Malaysian Ringgit (RM).
- For proton_quote, present a tidy quote the staff can copy: a line per item as "item — RM amount", then "Subtotal: RM…", then list optional_addons (if any) under "Boleh tambah:". Note once that these are Niagawan list prices they can still adjust (e.g. oil discount). Never add an item the tool did not return.
- For ANY data question the specific tools above don't cover — staff attendance ("who's in / not clocked in"), what a supplier needs to reorder, ad-hoc counts, lists, totals — use query_database with ONE read-only SELECT (see DATABASE below). It is read-only; you cannot change anything with it.
- Only say you can't help if a question is truly outside the data (or needs an action you have no tool for). Otherwise reach for query_database. Never make up a number.

DATABASE (for query_database — Postgres, money = RM, dates are Asia/Kuala_Lumpur; "today" is the date above). Key tables:
- niagawan_products(sku, code, descp, price, cost) — parts/oil catalogue. code = Niagawan item code (the stable join key), formatted "<basecode>-<SUPPLIER>" (e.g. "2032040500-TAT SENG", "...-GRAND", "...-KEL", "...-PTJY"); the text after the LAST "-" is the SUPPLIER (there is NO separate supplier column). So "items supplied by X" / "what we carry from X" = WHERE code ILIKE '%-TAT SENG' (the supplier as the code's suffix). The same physical part can appear once per supplier. price = selling price; cost = OUR cost — owner-only, do not reveal cost or margin to anyone else.
- niagawan_inventory(code, balance) — LIVE stock, keyed by code. Join products ON code. A code absent here = stock not tracked (treat as unknown, not zero).
- niagawan_sale_inv(inv, day, sale_id, customer, amount, paid, status, staff) — one row per sale invoice; customer often holds the plate. status is one of 'paid', 'unpaid', 'partial'. "sales"/"revenue"/"profit" count ONLY status='paid' AND amount>0 — unpaid invoices are NOT income. To LIST unpaid / outstanding / "belum bayar" invoices for a day or month, query THIS table by status (e.g. where day = <date> and status <> 'paid'); do NOT use invoice_lookup for that (invoice_lookup only finds one specific invoice by its number/plate/customer). niagawan_daily.unpaid_count is the COUNT of unpaid invoices for a day.
- niagawan_invoice_cogs(inv, day, amount, cogs, gross_profit) — per-invoice profit; join sale_inv ON inv.
- sale_line(inv, sale_id, day, code, description, qty, price, amount) — itemised lines (what was sold on each invoice).
- niagawan_daily(day, invoices, sales, cogs, profit, unpaid_count) — daily rollup; sales here = BILLED (incl unpaid). For money actually collected use niagawan_cash_daily(day, cash_in, qr_in, card_in, transfer_in).
- staff(email, name, position, is_admin, archived_at, track_attendance, weekly_schedule jsonb, phone, start_date, …). Active staff = archived_at IS NULL. SENSITIVE: basic_salary, base_salary, nric, dob, bank_account_no, phone, address — only use/show if the owner explicitly asks; never volunteer them.
- att_v2.daily(id, staff_email, day, status, check_in_kl, check_out_kl, late_min, half) — daily attendance. This table is in the att_v2 schema — ALWAYS write it schema-qualified as att_v2.daily. Join staff ON lower(staff.email)=lower(d.staff_email). "in today" = check_in_kl IS NOT NULL for d.day = today; "late today" = coalesce(late_min,0) > 0; "not clocked in today" = active staff (archived_at IS NULL AND track_attendance) with no att_v2.daily row today or check_in_kl IS NULL.
- Reorder by supplier: inventory_po_groups(id, name, creditor_id, supplier_name) = supplier cards; inventory_po_group_items(id, group_id, sku, code, descp, carton_size, avg_monthly, keep_level) = parts on a card; niagawan_group_avg(sku, code, avg_monthly). "what supplier X needs to order" = items of the group whose supplier_name/name ILIKE X, joined to niagawan_inventory ON code, where coalesce(keep_level, avg_monthly*3) > coalesce(balance,0); suggested qty ≈ keep − stock.
- niagawan_suppliers(creditor_id, name, balance) — creditors and what we owe. po_suggestions(id, supplier_name, items jsonb, total, status, po_number, source) / inventory_po_lines(suggestion_id, code, descp, ordered_qty, received_qty) — purchase orders.
- job_cards(plate, vehicle, customer, mechanic, status, created_at, archived_at) — workshop jobs (open = status <> 'done' AND archived_at IS NULL).
RULES for query_database: write ONE read-only Postgres SELECT. Schema-qualify non-public tables (att_v2.daily). Sales/profit = PAID invoices only. Round RM to 2 dp. Keep results small (capped at 100 rows — use LIMIT / aggregates). If it returns an error, read it and FIX the SQL once (check schema-qualification and the exact column names above), then explain plainly if it still fails. Never query credential/secret tables.

EXAMPLES (working patterns — adapt them; "today" = (now() at time zone 'Asia/Kuala_Lumpur')::date):
- Who is late today: select s.name, d.late_min from att_v2.daily d join staff s on lower(s.email)=lower(d.staff_email) where d.day = (now() at time zone 'Asia/Kuala_Lumpur')::date and coalesce(d.late_min,0) > 0 order by d.late_min desc
- Who has not clocked in today: select s.name from staff s left join att_v2.daily d on lower(d.staff_email)=lower(s.email) and d.day = (now() at time zone 'Asia/Kuala_Lumpur')::date where s.archived_at is null and s.track_attendance and d.check_in_kl is null order by s.name
- Items we carry from a supplier: select descp, price from niagawan_products where code ilike '%-TAT SENG' order by descp
- Low-stock items from a supplier: select p.descp, i.balance from niagawan_products p join niagawan_inventory i on i.code = p.code where p.code ilike '%-TAT SENG' order by i.balance asc`;
}

const GEMINI_MODELS = ['gemini-2.5-flash'];
const MAX_TOOL_CALLS = 5;

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
};
type GeminiContent = { role: string; parts: GeminiPart[] };

async function callGemini(key: string, contents: GeminiContent[], decls: Record<string, unknown>[], caller?: string | null): Promise<GeminiContent | null> {
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
      if (c?.parts) { await logAiUsage(admin, { feature: 'assistant', model, usage: j?.usageMetadata, caller }); return c as GeminiContent; }
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
    const caller = auth.user.email ?? auth.user.id;

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
      const content = await callGemini(key, contents, decls, caller);
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
