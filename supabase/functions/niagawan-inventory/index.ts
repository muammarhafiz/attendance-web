// BACKUP of deployed Supabase Edge Function `niagawan-inventory` (project naefauflkisldxftxuhq), version 9.
// Captured 2026-08-16. verify_jwt = false. Auth = app_secrets.niagawan_ingest_token (x-ingest-token OR body.token).
// Not captured by `supabase db dump`. Re-deploy with: supabase functions deploy niagawan-inventory
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function groupItemsLive(admin: any): Promise<{ sku: string; code: string }[]> {
  const { data: gi } = await admin.from("inventory_po_group_items").select("sku,code");
  const skus = Array.from(new Set((gi || []).map((r: any) => String(r.sku)).filter(Boolean)));
  const liveBySku = new Map<string, string | null>();
  if (skus.length) {
    const { data: prod } = await admin.from("niagawan_products").select("sku,code").in("sku", skus);
    (prod || []).forEach((p: any) => liveBySku.set(String(p.sku), p.code));
  }
  return (gi || [])
    .map((r: any) => ({ sku: String(r.sku), code: liveBySku.get(String(r.sku)) ?? r.code }))
    .filter((x: any) => x.code);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: secretRow, error: secErr } = await admin
    .from("app_secrets").select("value").eq("name", "niagawan_ingest_token").single();
  if (secErr || !secretRow) return json({ error: "server auth misconfigured" }, 500);
  const provided = body?.token ?? req.headers.get("x-ingest-token");
  if (!provided || provided !== secretRow.value) return json({ error: "unauthorized" }, 401);

  const action = body?.action ?? "";

  if (action === "getWatchlist") {
    const { data, error } = await admin
      .from("niagawan_min_stock").select("code,description,min_balance,category");
    if (error) return json({ error: error.message }, 500);
    const items = (data || []).map((r: any) => ({ code: r.code, desc: r.description, min: r.min_balance, category: r.category }));
    return json({ ok: true, items });
  }

  if (action === "getGroupCodes") {
    const items = await groupItemsLive(admin);
    const codes = Array.from(new Set(items.map((x) => x.code).filter(Boolean)));
    return json({ ok: true, codes });
  }

  if (action === "getGroupItems") {
    const items = await groupItemsLive(admin);
    return json({ ok: true, items });
  }

  if (action === "seedWatchlist") {
    const rows = (Array.isArray(body?.rows) ? body.rows : []).map((r: any) => ({
      code: String(r.code),
      description: r.desc != null ? String(r.desc) : null,
      min_balance: Number(r.min) || 4,
      category: r.category != null ? String(r.category) : null,
      updated_at: new Date().toISOString(),
    })).filter((r: any) => r.code);
    if (!rows.length) return json({ error: "no rows" }, 400);
    const { error } = await admin.from("niagawan_min_stock").upsert(rows, { onConflict: "code" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, upserted: rows.length });
  }

  if (action === "putBalances") {
    const checked = body?.checked_at ? String(body.checked_at) : new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const rows = (Array.isArray(body?.rows) ? body.rows : []).map((r: any) => ({
      code: String(r.code),
      balance: (r.balance === "" || r.balance == null) ? null : Number(r.balance),
      suppliers: r.suppliers != null ? Number(r.suppliers) : null,
      checked_at: checked,
      updated_at: nowIso,
    })).filter((r: any) => r.code);
    if (!rows.length) return json({ error: "no rows" }, 400);
    const { error } = await admin.from("niagawan_inventory").upsert(rows, { onConflict: "code" });
    if (error) return json({ error: error.message }, 500);
    try { await admin.rpc("niagawan_clear_resolved_status"); } catch (_e) { /* non-fatal */ }
    return json({ ok: true, upserted: rows.length, checked_at: checked });
  }

  if (action === "putVelocity") {
    const nowIso = new Date().toISOString();
    const rows = (Array.isArray(body?.rows) ? body.rows : []).map((r: any) => ({
      code: String(r.code),
      sold_7d: Number.isFinite(Number(r.sold_7d)) ? Number(r.sold_7d) : null,
      sold_30d: Number.isFinite(Number(r.sold_30d)) ? Number(r.sold_30d) : null,
      last_sold: /^\d{4}-\d{2}-\d{2}$/.test(String(r.last_sold || "")) ? r.last_sold : null,
      updated_at: nowIso,
    })).filter((r: any) => r.code);
    if (!rows.length) return json({ ok: true, upserted: 0 });
    const { error } = await admin.from("niagawan_sales_velocity").upsert(rows, { onConflict: "code" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, upserted: rows.length });
  }

  if (action === "putGroupAvg") {
    const nowIso = new Date().toISOString();
    const rows = (Array.isArray(body?.rows) ? body.rows : []).map((r: any) => ({
      sku: String(r.sku),
      code: r.code != null ? String(r.code) : null,
      sold_90d: Number.isFinite(Number(r.sold_90d)) ? Number(r.sold_90d) : null,
      avg_monthly: Number.isFinite(Number(r.avg_monthly)) ? Number(r.avg_monthly) : null,
      updated_at: nowIso,
    })).filter((r: any) => r.sku);
    if (!rows.length) return json({ ok: true, upserted: 0 });
    const { error } = await admin.from("niagawan_group_avg").upsert(rows, { onConflict: "sku" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, upserted: rows.length });
  }

  if (action === "putSuppliers") {
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const nowIso = new Date().toISOString();
    const rows = raw.filter((r: any) => r && r.creditor_id).map((r: any) => ({
      creditor_id: String(r.creditor_id).slice(0, 20),
      name: r.name ? String(r.name).slice(0, 200) : null,
      balance: Number.isFinite(Number(r.balance)) ? Number(r.balance) : null,
      balance_updated_at: nowIso,
      updated_at: nowIso,
    }));
    if (body?.first === true) {
      const { error: delErr } = await admin.from("niagawan_suppliers").delete().neq("creditor_id", "");
      if (delErr) return json({ error: delErr.message }, 500);
    }
    if (rows.length) {
      const { error: upErr } = await admin.from("niagawan_suppliers").upsert(rows, { onConflict: "creditor_id" });
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, count: rows.length });
  }

  return json({ error: "unknown action" }, 400);
});
