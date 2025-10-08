// src/app/salary/api/manual/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookiesLike = { get(name: string): { value?: string } | undefined };
const readCookie = (n: string) => {
  try {
    const c = cookies() as unknown as CookiesLike;
    return c.get(n)?.value ?? "";
  } catch {
    return "";
  }
};

const isUuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );

/** Resolve (or create) the current month period and return its UUID. */
async function getCurrentPeriodId(supabase: ReturnType<typeof createServerClient>) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  // STEP A1: find existing
  const { data: found, error: findErr } = await supabase
    .from("payroll_periods")
    .select("id, year, month")
    .eq("year", y)
    .eq("month", m)
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`[STEP:A1] find period failed: ${findErr.message}`);
  if (found?.id && isUuid(found.id)) return found.id;

  // STEP A2: create if missing
  const { error: insErr } = await supabase
    .from("payroll_periods")
    .insert({ year: y, month: m, status: "draft" });
  if (insErr) throw new Error(`[STEP:A2] create period failed: ${insErr.message}`);

  // STEP A3: re-fetch
  const { data: re, error: reErr } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("year", y)
    .eq("month", m)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reErr) throw new Error(`[STEP:A3] read period after insert failed: ${reErr.message}`);
  if (!re?.id || !isUuid(re.id)) {
    throw new Error(`[STEP:A3] invalid period UUID read back: ${String(re?.id)}`);
  }
  return re.id;
}

/** Coerce amount from string/number to a safe number. */
function parseAmount(input: unknown): number {
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    // remove commas/spaces
    const cleaned = input.replace(/[, ]+/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

export async function POST(req: Request) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return readCookie(name);
          },
          set(_n: string, _v: string, _o: CookieOptions) {},
          remove(_n: string, _o: CookieOptions) {},
        },
      }
    );

    // STEP U1: who is calling
    const { data: ures, error: uerr } = await supabase.auth.getUser();
    if (uerr) throw new Error(`[STEP:U1] auth getUser failed: ${uerr.message}`);
    const userEmail = ures?.user?.email ?? "";

    // STEP ADM1: must be admin
    const { data: me, error: meErr } = await supabase
      .from("staff")
      .select("email,is_admin")
      .eq("email", userEmail)
      .maybeSingle();
    if (meErr) throw new Error(`[STEP:ADM1] admin check failed: ${meErr.message}`);
    if (!me?.is_admin) {
      return NextResponse.json({ ok: false, error: "Admins only" }, { status: 403 });
    }

    // STEP P1: read body
    const body = await req.json().catch(() => ({}));
    const staff_email = String(body?.staff_email ?? "").trim();
    const kind = String(body?.kind ?? "").trim().toUpperCase(); // 'EARN' | 'DEDUCT'
    const amount = parseAmount(body?.amount);
    const label = body?.label ? String(body.label).slice(0, 120) : null;

    if (!staff_email) {
      return NextResponse.json({ ok: false, error: "Select staff" }, { status: 400 });
    }
    if (!(kind === "EARN" || kind === "DEDUCT")) {
      return NextResponse.json({ ok: false, error: "Kind must be EARN or DEDUCT" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: "Amount must be > 0" }, { status: 400 });
    }

    // STEP PID: resolve period UUID
    const period_id = await getCurrentPeriodId(supabase);
    if (!isUuid(period_id)) {
      return NextResponse.json(
        { ok: false, error: `[STEP:PID] invalid period UUID computed: ${String(period_id)}` },
        { status: 500 }
      );
    }

    // STEP INS: insert into manual_items
    const { error: insErr } = await supabase.from("manual_items").insert({
      period_id,     // UUID (verified)
      staff_email,   // TEXT
      kind,          // 'EARN' | 'DEDUCT'
      amount,        // numeric
      label,
      created_by: userEmail,
    });

    if (insErr) {
      // include the values to see what DB rejected (esp. UUID)
      throw new Error(
        `[STEP:INS] insert failed: ${insErr.message} | period_id=${period_id} | staff_email=${staff_email} | kind=${kind} | amount=${amount}`
      );
    }

    return NextResponse.json({ ok: true, period_id });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}