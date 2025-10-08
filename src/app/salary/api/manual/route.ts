// src/app/salary/api/manual/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/* --------------------------- helpers --------------------------- */

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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

function parseAmount(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const cleaned = x.replace(/[, ]+/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** uniform error response with step & context */
function fail(step: string, message: string, ctx?: Record<string, unknown>, status = 400) {
  return NextResponse.json({ ok: false, step, error: message, ctx }, { status });
}

/* ---------------------------- main ----------------------------- */

export async function POST(req: Request) {
  // STEP 0: construct supabase client
  let supabase: ReturnType<typeof createServerClient>;
  try {
    supabase = createServerClient(
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
  } catch (e: any) {
    return fail("STEP0_CLIENT", e?.message ?? "failed to create supabase client");
  }

  // STEP 1: auth
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return fail("STEP1_AUTH", error.message);
    const email = data?.user?.email ?? "";
    if (!email) return fail("STEP1_AUTH", "no user email from session");
  } catch (e: any) {
    return fail("STEP1_AUTH_THROW", e?.message ?? "auth getUser threw");
  }

  // STEP 2: admin check
  let callerEmail = "";
  try {
    const { data } = await supabase.auth.getUser();
    callerEmail = data?.user?.email ?? "";
    const { data: me, error: meErr } = await supabase
      .from("staff")
      .select("email,is_admin")
      .eq("email", callerEmail)
      .maybeSingle();
    if (meErr) return fail("STEP2_ADMIN_QUERY", meErr.message);
    if (!me?.is_admin) return fail("STEP2_ADMIN", "Admins only", { callerEmail }, 403);
  } catch (e: any) {
    return fail("STEP2_ADMIN_THROW", e?.message ?? "admin check threw", { callerEmail });
  }

  // STEP 3: read & validate body
  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const staff_email = String(payload?.staff_email ?? "").trim();
  const kind = String(payload?.kind ?? "").trim().toUpperCase(); // 'EARN' | 'DEDUCT'
  const amount = parseAmount(payload?.amount);
  const label = payload?.label ? String(payload.label).slice(0, 120) : null;

  if (!staff_email) return fail("STEP3_BODY", "staff_email required", { payload });
  if (!(kind === "EARN" || kind === "DEDUCT"))
    return fail("STEP3_BODY", "kind must be EARN or DEDUCT", { kind });
  if (!Number.isFinite(amount) || amount <= 0)
    return fail("STEP3_BODY", "amount must be a positive number", { amount, raw: payload?.amount });

  // STEP 4: resolve/create current period
  let period_id: string | null = null;
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // try find
    const { data: found, error: findErr } = await supabase
      .from("payroll_periods")
      .select("id,year,month")
      .eq("year", year)
      .eq("month", month)
      .limit(1)
      .maybeSingle();
    if (findErr) return fail("STEP4_PERIOD_FIND", findErr.message, { year, month });

    if (found?.id) {
      if (!isUuid(found.id))
        return fail("STEP4_PERIOD_UUID_INVALID", "period id is not a UUID", { id: found.id, year, month });
      period_id = found.id;
    } else {
      // create
      const { error: insErr } = await supabase
        .from("payroll_periods")
        .insert({ year, month, status: "draft" });
      if (insErr) return fail("STEP4_PERIOD_CREATE", insErr.message, { year, month });

      const { data: refetch, error: refErr } = await supabase
        .from("payroll_periods")
        .select("id")
        .eq("year", year)
        .eq("month", month)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (refErr) return fail("STEP4_PERIOD_REFETCH", refErr.message, { year, month });

      if (!refetch?.id || !isUuid(refetch.id))
        return fail("STEP4_PERIOD_UUID_INVALID", "re-fetched period id invalid", {
          id: refetch?.id,
          year,
          month,
        });

      period_id = refetch.id;
    }
  } catch (e: any) {
    return fail("STEP4_PERIOD_THROW", e?.message ?? "period resolution threw");
  }

  // STEP 5: insert manual_items
  try {
    const row = {
      period_id,         // uuid (validated)
      staff_email,       // text
      kind,              // 'EARN' | 'DEDUCT' (fits check constraint)
      amount,            // numeric
      label,             // text | null
      created_by: callerEmail,
      code: null as string | null, // optional column exists in schema
    };

    const { error: insErr } = await supabase.from("manual_items").insert(row);
    if (insErr) {
      return fail("STEP5_INSERT", insErr.message, { row });
    }
  } catch (e: any) {
    return fail("STEP5_INSERT_THROW", e?.message ?? "insert threw", {
      period_id,
      staff_email,
      kind,
      amount,
      label,
      created_by: callerEmail,
    });
  }

  return NextResponse.json({ ok: true, period_id, staff_email, kind, amount, label });
}