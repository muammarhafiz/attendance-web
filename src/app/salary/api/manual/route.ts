// src/app/salary/api/manual/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** Light wrapper so we don’t use `any` for cookies */
type CookiesLike = { get(name: string): { value?: string } | undefined };

function readCookie(name: string): string {
  try {
    const store = cookies() as unknown as CookiesLike;
    return store.get(name)?.value ?? "";
  } catch {
    return "";
  }
}

// Get or create the current payroll period and return its UUID
async function getOrCreateCurrentPeriod(supabase: ReturnType<typeof createServerClient>) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  // try to find existing
  const { data: existing, error: findErr } = await supabase
    .from("payroll_periods")
    .select("id, year, month, status")
    .eq("year", y)
    .eq("month", m)
    .maybeSingle();

  if (findErr) throw findErr;
  if (existing?.id) return existing.id as string; // <-- UUID string

  // create one if missing (status draft)
  const { data: created, error: insErr } = await supabase
    .from("payroll_periods")
    .insert({ year: y, month: m, status: "draft" })
    .select("id")
    .single();

  if (insErr) throw insErr;
  return created.id as string;
}

export async function POST(req: Request) {
  try {
    // Supabase wired to Next cookies
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

    // who is calling?
    const { data: userRes } = await supabase.auth.getUser();
    const userEmail = userRes?.user?.email ?? "";

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

    // read payload
    const body = await req.json();
    const staff_email = String(body?.staff_email ?? "").trim();
    const rawKind = String(body?.kind ?? "").trim().toUpperCase();
    const amountNum = Number(body?.amount ?? 0);
    const label = body?.label ? String(body.label).slice(0, 120) : null;

    if (!staff_email) {
      return NextResponse.json({ ok: false, error: "Select staff" }, { status: 400 });
    }
    if (!(rawKind === "EARN" || rawKind === "DEDUCT")) {
      return NextResponse.json({ ok: false, error: "Kind must be EARN or DEDUCT" }, { status: 400 });
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ ok: false, error: "Amount must be > 0" }, { status: 400 });
    }

    // find or create the current period UUID (this is the part that fixes the error)
    const periodId = await getOrCreateCurrentPeriod(supabase); // <- a real UUID

    // insert into manual_items
    const { error: insErr2 } = await supabase.from("manual_items").insert({
      period_id: periodId,        // UUID ✅
      staff_email,                // TEXT  ✅
      kind: rawKind,              // 'EARN' | 'DEDUCT'
      amount: amountNum,          // numeric
      label,
      created_by: userEmail,
    });

    if (insErr2) throw insErr2;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}