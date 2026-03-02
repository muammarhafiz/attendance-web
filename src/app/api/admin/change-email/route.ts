import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
  try {
    const { oldEmail, newEmail } = await req.json();

    if (!oldEmail || !newEmail) return bad("oldEmail and newEmail are required");
    const oldE = String(oldEmail).trim().toLowerCase();
    const newE = String(newEmail).trim().toLowerCase();
    if (!oldE.includes("@") || !newE.includes("@")) return bad("Invalid email format");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!url || !anon || !service) {
      return bad("Missing Supabase env vars (URL/ANON/SERVICE_ROLE_KEY)", 500);
    }

    // 1) Verify caller is logged-in admin (use ANON + caller JWT)
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) return bad("Missing Authorization bearer token", 401);

    const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });

    const { data: adminFlag, error: adminErr } = await caller.rpc("is_admin");
    if (adminErr || adminFlag !== true) return bad("Admins only", 403);

    // 2) Use service role to update Auth + run data migration
    const svc = createClient(url, service, { auth: { persistSession: false } });

    // Find user by old email
    // Supabase Admin API doesn't guarantee "getUserByEmail", so we list and filter.
    const { data: list, error: listErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) return bad(`listUsers failed: ${listErr.message}`, 500);

    const user = (list?.users || []).find(u => (u.email || "").toLowerCase() === oldE);
    if (!user) return bad("Auth user not found for old email", 404);

    // Update auth email
    const { error: updErr } = await svc.auth.admin.updateUserById(user.id, { email: newE });
    if (updErr) return bad(`Auth update failed: ${updErr.message}`, 500);

    // Migrate app tables
    const { error: migErr } = await svc.rpc("admin_change_staff_email_data", {
      p_old_email: oldE,
      p_new_email: newE,
    });
    if (migErr) return bad(`Data migration failed: ${migErr.message}`, 500);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return bad(e?.message ?? "Unknown error", 500);
  }
}