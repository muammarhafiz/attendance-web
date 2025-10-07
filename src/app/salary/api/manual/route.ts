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

async function getCurrentPeriodId(supabase: ReturnType<typeof createServerClient>) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  // 1) try to find existing
  const { data: found, error: findErr } = await supabase
    .from("payroll_periods")
    .select("id, year, month")
    .eq("year", y)
    .eq("month", m)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (found?.id && isUuid(found.id)) return found.id;

  // 2) create if missing
  const { error: insErr } = await supabase
    .from("payroll_periods")
    .insert({ year: y, month: m, status: "draft" });
  if (insErr) throw insErr;

  // 3) re-fetch to get its UUID (avoid relying on RETURNING when RLS transforms)
  const { data: re, error: reErr } = await supabase
    .from("payroll_periods")
    .select("id")
    .eq("year", y)
    .eq("month", m)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reErr) throw reErr;
  if (!re?.id || !isUuid(re.id)) {
    throw new Error("Could not resolve a valid period UUID");
  }
  return re.id;
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

    // who is calling
    const { data: ures } = await supabase.auth.getUser();
    const userEmail = ures?.user?.email ?? "";

    // must be admin
    const { data: me, error: meErr } = await supabase
      .from("staff")
      .select("email,is_admin")
      .eq("email", userEmail)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me?.is_admin) {
      return NextResponse.json({ ok: false, error: "Admins only" }, { status: 403 });
    }

    // payload
    const body = await req.json();
    const staff_email = String(body?.staff_email ?? "").trim();
    const kind = String(body?.kind ?? "").trim().toUpperCase(); // 'EARN' | 'DEDUCT'
    const amount = Number(body?.amount ?? 0);
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

    // resolve period UUID (this is where prior error came from)
    const period_id = await getCurrentPeriodId(supabase);
    if (!isUuid(period_id)) {
      return NextResponse.json(
        { ok: false, error: "Internal: invalid period UUID" },
        { status: 500 }
      );
    }

    // insert
    const { error: insErr } = await supabase.from("manual_items").insert({
      period_id,     // UUID ✅
      staff_email,   // TEXT
      kind,          // 'EARN' | 'DEDUCT'
      amount,        // numeric
      label,
      created_by: userEmail,
    });
    if (insErr) throw insErr;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Error";
    // You were seeing: “The string did not match the expected pattern.” (UUID)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}