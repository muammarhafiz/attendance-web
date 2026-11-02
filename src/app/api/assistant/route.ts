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

DATABASE (for query_database — Postgres, money = RM; "today" = (now() at time zone 'Asia/Kuala_Lumpur')::date). Count only real PAID money as revenue. Key tables:

SALES & MONEY:
- v_niagawan_paid_inv(inv, day, customer, staff, amount, cogs, gross_profit, has_cost_row) — the canonical PAID-ONLY invoice view (already filtered to status='paid' AND amount>0, pre-joined to COGS). USE THIS for revenue / gross profit / margin by day or month (margin% = 100*sum(gross_profit)/nullif(sum(amount),0)); has_cost_row=false = cost not captured (GP understated). Prefer it over hand-joining the two tables below.
- niagawan_sale_inv(inv, day, sale_id, customer, amount, paid, status, staff) — one row per invoice; customer often holds the plate; status ∈ ('paid','unpaid','partial'); staff = the SALESPERSON/cashier, NOT the mechanic. LIST unpaid/"belum bayar" for a day = where day=<date> and status <> 'paid' (NOT invoice_lookup, which only finds one specific invoice). niagawan_daily.unpaid_count = per-day count of unpaid.
- niagawan_invoice_cogs(inv, day, amount, cogs, gross_profit); sale_line(inv, sale_id, day, code, description, qty, price, amount) — itemised invoice lines.
- niagawan_outstanding(sale_id, sale_inv_no, customer, total, paid, balance, status ∈ {unpaid,partial}, sale_date, delivered_date) — the open accounts-receivable / debtors snapshot WITH customer name; total owed = SUM(balance), top debtors = GROUP BY customer; it carries years-old stale/unrecoverable debt so filter sale_date for "recent/real".
- niagawan_daily(day, invoices, sales, cogs, profit, unpaid_count) = daily rollup (sales = BILLED incl unpaid); niagawan_cash_daily(day, cash_in, qr_in, card_in, transfer_in) = system takings; niagawan_cash_count(day, counted_total, card_counted, qr_counted, transfer_counted, counted_by) = physical end-of-day count — reconcile per day: variance = counted − system.
- opex_bills(month TEXT 'YYYY-MM', label, amount, paid bool, paid_date) — monthly overhead bills; month is a STRING (compare with to_char(d,'YYYY-MM')); still owing = where not paid.

INVENTORY & STOCK (keyed by code):
- niagawan_products(sku, code, descp, price, cost) — code = "<basecode>-<SUPPLIER>", the text after the LAST "-" is the SUPPLIER (no separate supplier column), e.g. "items supplied by X" = where code ILIKE '%-TAT SENG'. price = sell price; cost = OUR cost (OWNER-ONLY). products has DUPLICATE rows per code, so for stock value first pre-aggregate: with c as (select code, max(cost) cost from niagawan_products group by code).
- niagawan_inventory(code, balance) — LIVE stock; balance can be NEGATIVE (oversold before the supplier delivery is received), so "out of stock" = balance <= 0 and the most-negative = most urgent reorder; a code absent = not tracked.
- niagawan_min_stock(code, description, min_balance, category, auto_po, supplier_name) — per-item reorder thresholds AND the only per-item category (free text: 'Proton','Oil - Liquimoly','Oil - Mannol','Oil - Gulf','Oil - Shell','Other'). "below minimum / to reorder" = join niagawan_inventory ON code where balance < min_balance (shortfall = min_balance − balance).
- niagawan_sales_velocity(code, sold_30d, last_sold) — units sold per item; fast movers = order by sold_30d desc, dead stock = balance>0 AND sold_30d=0; IGNORE sold_7d (always NULL).
- Reorder cards: inventory_po_groups(id, name, supplier_name) + inventory_po_group_items(group_id, code, descp, carton_size, avg_monthly, keep_level) + niagawan_group_avg(sku, code, avg_monthly ≈ 3-mo monthly usage).
(Ignore the generic placeholder code '0001'; niagawan_category is a standalone lookup NOT joinable to products.)

PURCHASING (supplier costs — OWNER-ONLY):
- pinv(id, supplier_name, creditor_id, ref_no, invoice_date, total, status) — supplier purchase invoices; status ∈ {created,dismissed} and spend counts status='created' ONLY (dismissed ≈ half the rows = discarded/duplicate); total = whole-invoice cost; spend-by-supplier = sum(total) group by supplier_name (creditor_id joins niagawan_suppliers).
- pinv_item(pinv_id→pinv.id, item_code, description, qty, unit_price, amount, category) — purchase lines (unit_price/amount = our COST); join pinv and filter status='created'; category ∈ ENGINE OIL/BRAKE/OIL FILTER/ATF/AIRCOND/COOLANT/SPARE PARTS ITEM/…; gives what we actually paid a supplier for a part.
- niagawan_suppliers(creditor_id, name, balance) — balance = accounts-payable we still OWE (positive = owed, most = 0); pinv has NO paid flag, so "what we owe" / top creditors come only from here. po_suggestions(supplier_name, status ∈ {received,rejected} only, po_number, items jsonb) / inventory_po_lines(ordered_qty, received_qty).

STAFF & ATTENDANCE:
- staff(email, name, position, is_admin, archived_at, track_attendance, start_date, employment_end_date, weekly_schedule jsonb, …) — active = archived_at IS NULL; attendance-tracked board subset = track_attendance=true; probation = start_date >= today − interval '3 months'; weekly_schedule keyed '0'..'6' (EXTRACT(dow), 0=Sunday) value 'off' or a work location → off on date D = weekly_schedule->>(EXTRACT(dow FROM D)::int::text)='off'. SENSITIVE (owner-only): basic_salary, nric, bank_account_no, phone, address — never volunteer.
- today_ui_v1 — the LIVE "who is in today" board (one row per active tracked staff): staff_name, check_in_kl, check_out_kl, late_min (min after 09:30), status, no_check_in bool, auto_absent bool (true once past 15:30 KL with no check-in). USE THIS for anything about TODAY (att_v2.daily often isn't written until the evening rollup).
- att_v2.daily(id, staff_email, day, status, check_in_kl, check_out_kl, late_min, half) — end-of-day attendance rollup for PAST days; status is UPPERCASE: PRESENT / ABSENT / OFF (OFFDAY) / MC / PH / HOME. Schema-qualify att_v2.daily; join staff ON lower(email)=lower(staff_email); it holds future PH rows so bound day to the past.
- day_status(day, staff_email, status, leave_kind, paid_override, note) — the ONLY place leave TYPE lives (non-working days only): annual leave = status 'OFFDAY' + leave_kind 'ANNUAL' (also 'PATERNITY','UNPAID'); sick/MC = status 'MC' + leave_kind 'SICK' (also 'HOSPITALISATION'); status 'ABSENT' (leave_kind null) = unexcused. "on leave today" = day = today.
- offday_requests / halfday_requests(staff_email, date_from, date_to, reason, status) — staff leave-request inboxes; status LOWERCASE 'pending'/'approved'/'rejected' (pending = to approve).
- public_holidays(holiday_date, name, handling, is_compulsory, swap_to_date) — handling = 'open' (shop trades that holiday) / 'close' / 'swap'; "holidays we're open" = handling='open'.
- position_access(position, feature, allowed) — feature access by position (join staff.position; feature ∈ attendance, attendance_manage, payroll, pay_salaries, month_end, employees, access_admin, checkin, workshop, niagawan, intake, tyre, …).

PAYROLL (pay_v2 schema — CONFIDENTIAL salary data, OWNER-ONLY; never surface to anyone but the owner):
- pay_v2.v_payslip_admin_summary_v2(year, month, staff_name, staff_email, total_earn [=gross], base_wage, epf_emp, socso_emp, eis_emp, epf_er, socso_er, eis_er, total_deduct, net_pay) — one finalized payslip per staff per month; monthly payroll cost = SUM over a (year,month); employer statutory = epf_er+socso_er+eis_er.
- pay_v2.items(period_id, staff_email, kind, code, label, amount) JOIN pay_v2.periods(id, year, month, status ∈ {OPEN,LOCKED}) ON items.period_id=periods.id (items has no date) — kind EARN/DEDUCT/STAT_ER_*/STAT_EMP_* (ER=employer cost, EMP=staff deduction); codes BASE/COMM/OT/BONUS/ADVANCE/UNPAID/…; use periods.status (not locked_at) for "finalised".
- public.leave_balances(year int) → per active staff (name, years, annual_ent, annual_used, annual_left, mc_ent, mc_used, mc_left, unpaid) — entitlement by tenure (annual 8/12/16, MC 14/18/22 for <2y/2-4y/>=5y); use for "leave left / entitlement" (select * from public.leave_balances(2026)) instead of recomputing; if it errors, fall back to counting day_status.

WORKSHOP:
- job_cards(plate, vehicle, customer, mechanic, status, sale_inv, created_at, archived_at) — status ∈ {waiting, done}; cars in the shop now = status='waiting' AND archived_at IS NULL; plate & vehicle hold the SAME free-text "MODEL PLATE" (match with ILIKE); mechanic/customer almost always blank. A plate's itemised service/oil history = job_cards JOIN sale_line ON sale_line.inv = job_cards.sale_inv (no paid filter — include unpaid visits).
- tyre(brand, pattern, size [like '205/55R16', no spaces], rim, load_speed, retail [=our price], cost [owner-only], dealer, dealer_phone, hidden) — cheapest in a size = where hidden=false and size ILIKE <size> order by retail.
- tyre_enquiry(created_at, customer_name, customer_phone, car_plate, brand, pattern, size, qty, quote_total, status ∈ {new,contacted,closed}) — web tyre leads; open inbox = status='new'.

IGNORE (anti-guess): ecom_* tables belong to a SEPARATE self-hosted system and do NOT reconcile with this workshop data — never use them for workshop finance/purchasing. niagawan_sale_inv.staff is the salesperson, not the mechanic.

RULES: write ONE read-only SELECT. Schema-qualify non-public tables (att_v2.*, pay_v2.*). Revenue/profit = PAID money only. Round RM to 2 dp. Cap 100 rows (use LIMIT / aggregates). When matching a NAME (supplier_name, customer, dealer, staff name, item description) ALWAYS wrap it in wildcards both sides, e.g. supplier_name ILIKE '%grand auto%' (not ILIKE 'grand auto', which matches nothing). Payroll, salary and leave answers are confidential — owner only. If a query errors, read it and FIX once (check schema-qualification + the exact columns above), then explain plainly.

EXAMPLES ("today" = (now() at time zone 'Asia/Kuala_Lumpur')::date):
- Who is in / late today: select staff_name, check_in_kl, late_min from public.today_ui_v1 where not no_check_in order by late_min desc
- Who hasn't clocked in today: select staff_name from public.today_ui_v1 where no_check_in
- Items we carry from a supplier: select descp, price from niagawan_products where code ilike '%-TAT SENG' order by descp
- What to reorder from a supplier: select m.description, i.balance, m.min_balance from niagawan_min_stock m join niagawan_inventory i on i.code=m.code where i.balance<m.min_balance and m.supplier_name ilike '%TAT SENG%' order by (m.min_balance-i.balance) desc
- Sales & margin by month: select to_char(day,'YYYY-MM') mth, round(sum(amount),2) revenue, round(sum(gross_profit),2) gp from v_niagawan_paid_inv group by 1 order by 1 desc limit 6
- Cars in the shop now: select plate, created_at from job_cards where status='waiting' and archived_at is null order by created_at`;
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
