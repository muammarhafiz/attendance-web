// BACKUP of deployed Supabase Edge Function `niagawan-ingest` (project naefauflkisldxftxuhq), version 29.
// Captured 2026-08-16. verify_jwt = false. Auth = app_secrets.niagawan_ingest_token (x-ingest-token OR body.token).
// This is the ENTIRE NAS-to-database job router. Not captured by `supabase db dump`.
// Re-deploy with: supabase functions deploy niagawan-ingest
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function toISODate(s: string): string | null {
  const m = String(s ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function klToday(): string {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: secretRow, error: secErr } = await admin
    .from("app_secrets")
    .select("value")
    .eq("name", "niagawan_ingest_token")
    .single();
  if (secErr || !secretRow) return json({ error: "server auth misconfigured" }, 500);

  const provided = body?.token ?? req.headers.get("x-ingest-token");
  if (!provided || provided !== secretRow.value) return json({ error: "unauthorized" }, 401);

  const action = body?.action ?? "upsert";

  if (action === "claim") {
    const { data, error } = await admin.rpc("claim_sync_request");
    if (error) return json({ error: error.message }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    return json({ ok: true, claimed: row ?? null });
  }

  if (action === "complete") {
    const id = body?.id;
    if (!id) return json({ error: "id required" }, 400);
    const status = body?.status === "error" ? "error" : "done";
    const { error } = await admin
      .from("sync_requests")
      .update({ status, finished_at: new Date().toISOString(), result: String(body?.result ?? "").slice(0, 1000) })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "getIntake") {
    const { data: rows, error } = await admin.from("intake_requests")
      .select("id,plate,model,phone,cust_name,cust_id,remark").eq("status", "pending").order("id").limit(5);
    if (error) return json({ error: error.message }, 500);
    if (!rows || !rows.length) return json({ ok: true, jobs: [] });
    const ids = rows.map((r: any) => r.id);
    await admin.from("intake_requests").update({ status: "processing" }).in("id", ids);
    return json({ ok: true, jobs: rows });
  }

  if (action === "markIntake") {
    const id = body?.id;
    if (!id) return json({ error: "id required" }, 400);
    const status = body?.status === "done" ? "done" : "error";
    const patch: any = { status, finished_at: new Date().toISOString() };
    if (body?.inv_no) patch.inv_no = String(body.inv_no).slice(0, 40);
    if (body?.sale_id) patch.sale_id = String(body.sale_id).slice(0, 20);
    if (body?.note) patch.note = String(body.note).slice(0, 300);
    const { error } = await admin.from("intake_requests").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    if (status === "done" && body?.inv_no && body?.sale_id) {
      await admin.from("niagawan_sale_inv").upsert({
        inv: String(body.inv_no).slice(0, 40), day: klToday(),
        sale_id: String(body.sale_id).slice(0, 20),
        customer: body?.customer ? String(body.customer).slice(0, 160) : null,
        amount: 0, paid: 0, status: "unpaid", staff: null, updated_at: new Date().toISOString(),
      }, { onConflict: "inv" });
      await admin.rpc("stamp_intake_card", {
        p_inv: String(body.inv_no), p_sale_id: String(body.sale_id),
        p_label: body?.customer ? String(body.customer) : "",
      });
    }
    return json({ ok: true });
  }

  if (action === "getAddItems") {
    const { data: rows, error } = await admin.from("additem_requests")
      .select("id,inv,sale_id,plate_label,code,qty,sku,descp,price,is_new,barcode,cost").eq("status", "pending").order("id").limit(10);
    if (error) return json({ error: error.message }, 500);
    if (!rows || !rows.length) return json({ ok: true, jobs: [] });
    const ids = rows.map((r: any) => r.id);
    await admin.from("additem_requests").update({ status: "processing" }).in("id", ids);
    return json({ ok: true, jobs: rows });
  }

  if (action === "markAddItem") {
    const id = body?.id;
    if (!id) return json({ error: "id required" }, 400);
    const status = body?.status === "done" ? "done" : "error";
    const patch: any = { status, finished_at: new Date().toISOString() };
    if (body?.result) patch.result = String(body.result).slice(0, 300);
    const { error } = await admin.from("additem_requests").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    if (status === "done" && body?.inv && body?.new_total != null) {
      await admin.from("niagawan_sale_inv").update({ amount: Number(body.new_total) || 0, updated_at: new Date().toISOString() }).eq("inv", String(body.inv));
    }
    return json({ ok: true });
  }

  // --- product catalog refresh (batched; first batch wipes the table) ---
  if (action === "products") {
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.sku).map((r: any) => ({
      sku: String(r.sku).slice(0, 20),
      code: r.code ? String(r.code).slice(0, 80) : null,
      descp: r.descp ? String(r.descp).slice(0, 240) : null,
      price: Number.isFinite(Number(r.price)) ? Number(r.price) : null,
      cost: Number.isFinite(Number(r.cost)) ? Number(r.cost) : null,
      updated_at: new Date().toISOString(),
    }));
    if (body?.first === true) {
      const { error: delErr } = await admin.from("niagawan_products").delete().neq("sku", "");
      if (delErr) return json({ error: delErr.message }, 500);
    }
    if (rows.length) {
      const { error: upErr } = await admin.from("niagawan_products").upsert(rows, { onConflict: "sku" });
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, count: rows.length });
  }

  // --- customer catalog refresh (batched; first batch wipes the table) ---
  if (action === "customers") {
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.customer_id).map((r: any) => ({
      customer_id: String(r.customer_id).slice(0, 20),
      name: r.name ? String(r.name).slice(0, 200) : null,
      phone: r.phone ? String(r.phone).slice(0, 60) : null,
      updated_at: new Date().toISOString(),
    }));
    if (body?.first === true) {
      const { error: delErr } = await admin.from("niagawan_customers").delete().neq("customer_id", "");
      if (delErr) return json({ error: delErr.message }, 500);
    }
    if (rows.length) {
      const { error: upErr } = await admin.from("niagawan_customers").upsert(rows, { onConflict: "customer_id" });
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, count: rows.length });
  }

  // --- GrabFood staff-meal receipts (parsed by the mailbox script; deduped by booking code) ---
  if (action === "grabMeals") {
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.order_code).map((r: any) => ({
      order_code: String(r.order_code).slice(0, 40),
      meal_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.meal_date || "")) ? r.meal_date : null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      restaurant: r.restaurant ? String(r.restaurant).slice(0, 160) : null,
      payment_method: r.payment_method ? String(r.payment_method).slice(0, 60) : null,
      subject: r.subject ? String(r.subject).slice(0, 200) : null,
      item_count: Number.isFinite(Number(r.item_count)) ? Math.trunc(Number(r.item_count)) : null,
      drink_count: Number.isFinite(Number(r.drink_count)) ? Math.trunc(Number(r.drink_count)) : null,
    }));
    if (rows.length) {
      const { error } = await admin.from("grab_meals").upsert(rows, { onConflict: "order_code" });
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, count: rows.length });
  }

  // --- daily cash-book totals from Niagawan (CASH in/out + QR/CARD/TRANSFER receipts) ---
  if (action === "cashDaily") {
    const day = String(body?.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day must be YYYY-MM-DD" }, 400);
    const rec: any = {
      day,
      cash_in: Number.isFinite(Number(body?.cash_in)) ? Number(body.cash_in) : null,
      cash_out: Number.isFinite(Number(body?.cash_out)) ? Number(body.cash_out) : null,
      updated_at: new Date().toISOString(),
    };
    if (Number.isFinite(Number(body?.qr_in))) rec.qr_in = Number(body.qr_in);
    if (Number.isFinite(Number(body?.card_in))) rec.card_in = Number(body.card_in);
    if (Number.isFinite(Number(body?.transfer_in))) rec.transfer_in = Number(body.transfer_in);
    const { error } = await admin.from("niagawan_cash_daily").upsert(rec, { onConflict: "day" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, day });
  }

  // --- individual cash-book payment lines per day + method (replace-by-day) ---
  if (action === "cashEntries") {
    const day = String(body?.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day must be YYYY-MM-DD" }, 400);
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.method).map((r: any) => ({
      day,
      method: String(r.method).slice(0, 32),
      label: r.label ? String(r.label).slice(0, 60) : null,
      descp: r.descp ? String(r.descp).slice(0, 300) : null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      updated_at: new Date().toISOString(),
    }));
    const { error: delErr } = await admin.from("niagawan_cash_entries").delete().eq("day", day);
    if (delErr) return json({ error: delErr.message }, 500);
    if (rows.length) {
      const { error: insErr } = await admin.from("niagawan_cash_entries").insert(rows);
      if (insErr) return json({ error: insErr.message }, 500);
    }
    return json({ ok: true, day, count: rows.length });
  }

  // --- full unpaid + partial snapshot (all years) -> workshop "Debts" cards (replace-all) ---
  if (action === "outstanding") {
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.sale_id).map((r: any) => ({
      sale_id: String(r.sale_id).slice(0, 20),
      sale_inv_no: r.sale_inv_no ? String(r.sale_inv_no).slice(0, 40) : null,
      customer: r.customer ? String(r.customer).slice(0, 200) : null,
      total: Number.isFinite(Number(r.total)) ? Number(r.total) : null,
      paid: Number.isFinite(Number(r.paid)) ? Number(r.paid) : null,
      balance: Number.isFinite(Number(r.balance)) ? Number(r.balance) : null,
      status: r.status ? String(r.status).slice(0, 20) : null,
      sale_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.sale_date || "")) ? r.sale_date : null,
      delivered_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.delivered_date || "")) ? r.delivered_date : null,
      scanned_at: new Date().toISOString(),
    }));
    const { error: delErr } = await admin.from("niagawan_outstanding").delete().neq("sale_id", "");
    if (delErr) return json({ error: delErr.message }, 500);
    if (rows.length) {
      const { error: upErr } = await admin.from("niagawan_outstanding").upsert(rows, { onConflict: "sale_id" });
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, inserted: rows.length });
  }

  if (action === "cogsZeros") {
    const iso = toISODate(body?.auditDate);
    if (!iso) return json({ error: "auditDate must be DD/MM/YYYY" }, 400);
    const nowIso = new Date().toISOString();
    const rawRows = Array.isArray(body?.rows) ? body.rows : [];
    const rows = rawRows.map((r: any) => ({
      audit_date: iso,
      inv: r?.inv ? String(r.inv) : null,
      inv_date: r?.invDate ? String(r.invDate) : null,
      item: r?.item ? String(r.item).slice(0, 300) : null,
      code: r?.code ? String(r.code) : null,
      price: r?.price != null ? String(r.price) : null,
      updated_at: nowIso,
    }));
    const { error: delErr } = await admin.from("niagawan_cogs_zeros").delete().eq("audit_date", iso);
    if (delErr) return json({ error: delErr.message }, 500);
    if (rows.length) {
      const { error: insErr } = await admin.from("niagawan_cogs_zeros").insert(rows);
      if (insErr) return json({ error: insErr.message }, 500);
    }
    return json({ ok: true, audit_date: iso, count: rows.length });
  }

  // --- per-invoice cost/gross-profit (upsert-by-inv, no wipe) ---
  if (action === "cogsInv") {
    const nowIso = new Date().toISOString();
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.inv).map((r: any) => ({
      inv: String(r.inv).slice(0, 40),
      day: /^\d{4}-\d{2}-\d{2}$/.test(String(r.day || "")) ? r.day : (toISODate(r.day) ?? null),
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      cogs: Number.isFinite(Number(r.cogs)) ? Number(r.cogs) : null,
      gross_profit: Number.isFinite(Number(r.gross_profit)) ? Number(r.gross_profit) : null,
      updated_at: nowIso,
    }));
    if (rows.length) {
      const { error: upErr } = await admin.from("niagawan_invoice_cogs").upsert(rows, { onConflict: "inv" });
      if (upErr) return json({ error: upErr.message }, 500);
    }
    return json({ ok: true, count: rows.length });
  }

  if (action === "salesRows") {
    const day = String(body?.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day must be YYYY-MM-DD" }, 400);
    const nowIso = new Date().toISOString();
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const rows = raw.filter((r: any) => r && r.inv).map((r: any) => ({
      inv: String(r.inv).slice(0, 40),
      day,
      sale_id: r.sale_id != null ? String(r.sale_id).slice(0, 20) : null,
      customer: r.customer ? String(r.customer).slice(0, 160) : null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      paid: Number.isFinite(Number(r.paid)) ? Number(r.paid) : null,
      status: r.status ? String(r.status).slice(0, 20) : null,
      staff: r.staff ? String(r.staff).slice(0, 80) : null,
      updated_at: nowIso,
    }));
    if (rows.length) {
      const { error: upErr } = await admin.from("niagawan_sale_inv").upsert(rows, { onConflict: "inv" });
      if (upErr) return json({ error: upErr.message }, 500);
    }
    const keep = rows.map((r: any) => '"' + String(r.inv).replace(/"/g, "") + '"');
    let q = admin.from("niagawan_sale_inv").delete().eq("day", day);
    if (keep.length) q = q.not("inv", "in", "(" + keep.join(",") + ")");
    const { error: delErr } = await q;
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true, day, count: rows.length });
  }

  // --- default action "upsert": daily P&L rollup into niagawan_daily (upsert-by-day) ---
  const rawRows = Array.isArray(body?.rows) ? body.rows : body?.row ? [body.row] : [];
  if (!rawRows.length) return json({ error: "no rows provided" }, 400);

  const nowIso = new Date().toISOString();
  const rows = [] as Array<Record<string, unknown>>;
  for (const r of rawRows) {
    if (!r || !r.day) continue;
    rows.push({
      day: String(r.day),
      invoices: Number(r.invoices) || 0,
      sales: Number(r.sales) || 0,
      cogs: Number(r.cogs) || 0,
      profit: Number(r.profit) || 0,
      unpaid_count: r.unpaid_count == null ? null : (Number(r.unpaid_count) || 0),
      updated_at: nowIso,
    });
  }
  if (!rows.length) return json({ error: "no valid rows (each needs a day)" }, 400);

  const { error: upErr } = await admin
    .from("niagawan_daily")
    .upsert(rows, { onConflict: "day" });
  if (upErr) return json({ error: upErr.message }, 500);

  return json({
    ok: true,
    upserted: rows.length,
    day_range: [rows[0].day, rows[rows.length - 1].day],
    synced_at: nowIso,
  });
});
