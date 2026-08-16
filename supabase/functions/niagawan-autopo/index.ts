// BACKUP of deployed Supabase Edge Function `niagawan-autopo` (project naefauflkisldxftxuhq), version 6.
// Captured 2026-08-16 via get_edge_function. verify_jwt = false. Auth = app_secrets.niagawan_ingest_token
// (header x-ingest-token OR body.token). This source existed ONLY as deployed code — it is not produced by
// `supabase db dump`. Re-deploy with: supabase functions deploy niagawan-autopo
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any; try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: secret, error: se } = await admin.from("app_secrets").select("value").eq("name", "niagawan_ingest_token").single();
  if (se || !secret) return json({ error: "server auth misconfigured" }, 500);
  const provided = body?.token ?? req.headers.get("x-ingest-token");
  if (!provided || provided !== secret.value) return json({ error: "unauthorized" }, 401);
  const action = body?.action ?? "";

  if (action === "getConfig") {
    let q = admin.from("niagawan_min_stock").select("code,description,supplier_id,supplier_name,category").eq("auto_po", true).not("supplier_id", "is", null);
    const cats = Array.isArray(body?.categories) ? body.categories.filter((c: unknown) => typeof c === "string" && c) : [];
    if (cats.length) q = q.in("category", cats);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, items: data || [] });
  }

  if (action === "getSchedule") {
    const { data, error } = await admin.from("automation_tasks").select("key,enabled,schedule");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, tasks: data || [] });
  }

  if (action === "putSuggestions") {
    const from = body?.period_from || null, to = body?.period_to || null;
    const sugg = Array.isArray(body?.suggestions) ? body.suggestions : [];
    // Only clear the legacy auto-PO scan's own pending rows (source IS NULL).
    // Inventory-v3 rows carry source='inventory-v3' and must never be deleted by a scan.
    await admin.from("po_suggestions").delete().eq("status", "pending").eq("period_from", from).eq("period_to", to).is("source", null);
    if (sugg.length) {
      const rows = sugg.map((s: any) => ({ period_from: from, period_to: to, supplier_id: String(s.supplier_id), supplier_name: s.supplier_name ?? null, items: s.items ?? [], total: s.total ?? null, status: "pending", updated_at: new Date().toISOString() }));
      const { error } = await admin.from("po_suggestions").insert(rows);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, inserted: sugg.length });
  }

  if (action === "getApproved") {
    const { data, error } = await admin.from("po_suggestions").select("id,supplier_id,supplier_name,items,period_from,period_to").eq("status", "approved").limit(20);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, suggestions: data || [] });
  }

  if (action === "markResult") {
    const id = body?.id; if (!id) return json({ error: "id required" }, 400);
    const patch: any = { status: body?.status === "error" ? "error" : "created", updated_at: new Date().toISOString() };
    if (body?.po_id) patch.po_id = String(body.po_id);
    if (body?.po_number) patch.po_number = String(body.po_number);
    if (body?.note) patch.note = String(body.note).slice(0, 500);
    const { error } = await admin.from("po_suggestions").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
