// BACKUP of deployed Supabase Edge Function `niagawan-pinv` (project naefauflkisldxftxuhq), version 19.
// Captured 2026-08-16. verify_jwt = false. Auth = app_secrets.niagawan_ingest_token (x-ingest-token OR body.token).
// Not captured by `supabase db dump`. Re-deploy with: supabase functions deploy niagawan-pinv
// ⚠ PORT NOTE: line marked below HARD-CODES https://attendancezp-web.vercel.app/api/pinv/extract — after any
//    host move this must be repointed or the email-bot's invoice uploads silently post to the OLD host.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }
function codesOf(it: any): string[] { const c = it.codes; const arr = Array.isArray(c) ? c : []; const list = arr.map((x: any) => String(x ?? "").trim()).filter(Boolean); if (list.length === 0 && it.item_code) { const s = String(it.item_code).trim(); if (s) list.push(s); } return list; }

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

  if (action === "getMailSuppliers") {
    const { data, error } = await admin.from("mail_suppliers").select("name,match_terms,folder_id,folder_name").eq("enabled", true);
    if (error) return json({ error: error.message }, 500);
    const suppliers = (data || []).map((s: any) => ({
      name: String(s.name || ""),
      terms: Array.isArray(s.match_terms) ? s.match_terms.map((t: any) => String(t ?? "").toLowerCase().trim()).filter(Boolean) : [],
      folder_id: s.folder_id ? String(s.folder_id) : null,
      folder_name: s.folder_name ? String(s.folder_name) : null,
    })).filter((s: any) => s.terms.length > 0);
    return json({ ok: true, suppliers });
  }

  if (action === "putDriveFolders") {
    const raw = Array.isArray(body?.folders) ? body.folders : [];
    const rows = raw.filter((f: any) => f && f.id).map((f: any) => ({ folder_id: String(f.id).slice(0, 80), name: String(f.name || "").slice(0, 200), updated_at: new Date().toISOString() }));
    const { error: delErr } = await admin.from("drive_folders").delete().neq("folder_id", "");
    if (delErr) return json({ error: delErr.message }, 500);
    if (rows.length) { const { error } = await admin.from("drive_folders").upsert(rows, { onConflict: "folder_id" }); if (error) return json({ error: error.message }, 500); }
    return json({ ok: true, count: rows.length });
  }

  if (action === "countApproved") {
    const { count, error } = await admin.from("pinv").select("id", { count: "exact", head: true }).eq("status", "approved");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, count: count || 0 });
  }

  if (action === "countJobs") {
    const [a, c, r] = await Promise.all([
      admin.from("pinv").select("id", { count: "exact", head: true }).eq("status", "approved"),
      admin.from("pinv").select("id", { count: "exact", head: true }).eq("check_status", "queued"),
      admin.from("pinv").select("id", { count: "exact", head: true }).eq("resolve_status", "queued"),
    ]);
    const err = a.error || c.error || r.error;
    if (err) return json({ error: err.message }, 500);
    return json({ ok: true, counts: { approved: a.count || 0, check: c.count || 0, resolve: r.count || 0 } });
  }

  if (action === "getApproved") {
    const { data: invs, error } = await admin.from("pinv")
      .select("id,supplier_name,ref_no,do_no,invoice_date,total").eq("status", "approved").limit(10);
    if (error) return json({ error: error.message }, 500);
    if (!invs || !invs.length) return json({ ok: true, invoices: [] });
    const ids = invs.map((i: any) => i.id);
    const { data: items } = await admin.from("pinv_item")
      .select("pinv_id,line_no,item_code,codes,description,qty,unit_price,discount,category,sku_id,will_create").in("pinv_id", ids).order("line_no");
    const { data: cats } = await admin.from("niagawan_category").select("id,name");
    const catMap: Record<string, string> = {};
    (cats || []).forEach((c: any) => { catMap[String(c.name).toUpperCase()] = String(c.id); });
    const fallback = catMap["SPARE PARTS ITEM"] || "";
    const byInv: Record<string, any[]> = {};
    (items || []).forEach((it: any) => {
      (byInv[it.pinv_id] = byInv[it.pinv_id] || []).push({
        line_no: it.line_no, item_code: it.item_code, codes: codesOf(it), description: it.description,
        qty: Number(it.qty) || 0, unit_price: Number(it.unit_price) || 0, discount: Number(it.discount) || 0,
        category: it.category || null, cat_id: catMap[String(it.category || "").toUpperCase()] || fallback,
        sku_id: it.sku_id ? String(it.sku_id) : null, will_create: it.will_create === true,
      });
    });
    await admin.from("pinv").update({ status: "creating", updated_at: new Date().toISOString() }).in("id", ids);
    return json({ ok: true, invoices: invs.map((i: any) => ({ ...i, items: byInv[i.id] || [] })) });
  }

  if (action === "markResult") {
    const id = body?.id; if (!id) return json({ error: "id required" }, 400);
    const patch: any = { status: body?.status === "error" ? "error" : "created", updated_at: new Date().toISOString() };
    if (body?.niagawan_pi_no) patch.niagawan_pi_no = String(body.niagawan_pi_no);
    if (body?.creditor_id) patch.creditor_id = String(body.creditor_id);
    if (body?.note) patch.note = String(body.note).slice(0, 500);
    const { error } = await admin.from("pinv").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "requeueStuck") {
    const { error } = await admin.from("pinv").update({ status: "approved" }).eq("status", "creating");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "countCheckJobs") {
    const { count, error } = await admin.from("pinv").select("id", { count: "exact", head: true }).eq("check_status", "queued");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, count: count || 0 });
  }

  if (action === "getCheckJobs") {
    const { data: invs, error } = await admin.from("pinv").select("id,invoice_date").eq("check_status", "queued").limit(5);
    if (error) return json({ error: error.message }, 500);
    if (!invs || !invs.length) return json({ ok: true, jobs: [] });
    const ids = invs.map((i: any) => i.id);
    const { data: items } = await admin.from("pinv_item").select("pinv_id,line_no,item_code,codes").in("pinv_id", ids).order("line_no");
    const byInv: Record<string, any[]> = {};
    (items || []).forEach((it: any) => { (byInv[it.pinv_id] = byInv[it.pinv_id] || []).push({ line_no: it.line_no, item_code: it.item_code, codes: it.codes }); });
    await admin.from("pinv").update({ check_status: "checking" }).in("id", ids);
    return json({ ok: true, jobs: invs.map((i: any) => ({ id: i.id, invoice_date: i.invoice_date, items: byInv[i.id] || [] })) });
  }

  if (action === "markCheck") {
    const id = body?.id; if (!id) return json({ error: "id required" }, 400);
    if (body?.status === "error") { await admin.from("pinv").update({ check_status: "error", checked_at: new Date().toISOString() }).eq("id", id); return json({ ok: true }); }
    const results = Array.isArray(body?.results) ? body.results : [];
    for (const r of results) {
      const ss = r.sold_status === "found" ? "found" : (r.sold_status === "check" ? "check" : "not_found");
      await admin.from("pinv_item").update({ sold_status: ss, sold_on: r.sold_on ? String(r.sold_on).slice(0, 400) : null }).eq("pinv_id", id).eq("line_no", r.line_no);
    }
    await admin.from("pinv").update({ check_status: "checked", checked_at: new Date().toISOString() }).eq("id", id);
    return json({ ok: true });
  }

  if (action === "countResolveJobs") {
    const { count, error } = await admin.from("pinv").select("id", { count: "exact", head: true }).eq("resolve_status", "queued");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, count: count || 0 });
  }

  if (action === "getResolveJobs") {
    const { data: invs, error } = await admin.from("pinv").select("id,ref_no,do_no").eq("resolve_status", "queued").limit(5);
    if (error) return json({ error: error.message }, 500);
    if (!invs || !invs.length) return json({ ok: true, jobs: [] });
    const ids = invs.map((i: any) => i.id);
    const { data: items } = await admin.from("pinv_item").select("pinv_id,line_no,item_code,codes").in("pinv_id", ids).order("line_no");
    const byInv: Record<string, any[]> = {};
    (items || []).forEach((it: any) => { (byInv[it.pinv_id] = byInv[it.pinv_id] || []).push({ line_no: it.line_no, item_code: it.item_code, codes: codesOf(it) }); });
    await admin.from("pinv").update({ resolve_status: "resolving" }).in("id", ids);
    return json({ ok: true, jobs: invs.map((i: any) => ({ id: i.id, ref_no: i.ref_no, do_no: i.do_no, items: byInv[i.id] || [] })) });
  }

  if (action === "markResolve") {
    const id = body?.id; if (!id) return json({ error: "id required" }, 400);
    if (body?.status === "error") { await admin.from("pinv").update({ resolve_status: "error", resolved_at: new Date().toISOString() }).eq("id", id); return json({ ok: true }); }
    const results = Array.isArray(body?.results) ? body.results : [];
    for (const r of results) {
      const matches = Array.isArray(r.matches)
        ? r.matches.slice(0, 10).map((m: any) => ({ sku: String(m.sku || ""), code: String(m.code || "").slice(0, 60), descp: String(m.descp || "").slice(0, 160), price: String(m.price || "").slice(0, 20), bal: String(m.bal || "").slice(0, 20) }))
        : null;
      await admin.from("pinv_item").update({ in_niagawan: r.in_niagawan === true, niagawan_category: r.niagawan_category ? String(r.niagawan_category).slice(0, 80) : null, niagawan_matches: matches }).eq("pinv_id", id).eq("line_no", r.line_no);
    }
    const dup = (typeof body?.dup_pi === "string" && body.dup_pi.trim()) ? body.dup_pi.trim().slice(0, 200) : null;
    await admin.from("pinv").update({ resolve_status: "resolved", resolved_at: new Date().toISOString(), dup_pi_no: dup }).eq("id", id);
    return json({ ok: true });
  }

  if (action === "kivLog") {
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const clean = rows.map((r: any) => ({
      sale_inv_no: String(r.sale_inv_no || "").slice(0, 40),
      sale_id: r.sale_id ? String(r.sale_id).slice(0, 20) : null,
      customer: r.customer ? String(r.customer).slice(0, 120) : null,
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
      original_date: r.original_date || null,
      new_date: r.new_date || null,
    })).filter((r: any) => r.sale_inv_no);
    if (clean.length) {
      const { error } = await admin.from("niagawan_moved_sale").insert(clean);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, inserted: clean.length });
  }

  if (action === "kivPartial") {
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const clean = rows.map((r: any) => ({
      sale_inv_no: String(r.sale_inv_no || "").slice(0, 40),
      sale_id: r.sale_id ? String(r.sale_id).slice(0, 20) : null,
      customer: r.customer ? String(r.customer).slice(0, 120) : null,
      total: Number.isFinite(Number(r.total)) ? Number(r.total) : null,
      paid: Number.isFinite(Number(r.paid)) ? Number(r.paid) : null,
      balance: Number.isFinite(Number(r.balance)) ? Number(r.balance) : null,
      sale_date: r.sale_date || null,
    })).filter((r: any) => r.sale_inv_no);
    const { error: delErr } = await admin.from("niagawan_partial_sale").delete().gte("id", 0);
    if (delErr) return json({ error: delErr.message }, 500);
    if (clean.length) {
      const { error } = await admin.from("niagawan_partial_sale").insert(clean);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, inserted: clean.length });
  }

  if (action === "pinvUpload") {
    const filename = String(body?.filename || "").trim();
    const b64 = String(body?.base64 || "");
    if (!filename || !b64) return json({ error: "filename + base64 required" }, 400);
    const safe = filename.replace(/[^\w.\-]+/g, "_");
    const { data: existing } = await admin.from("pinv").select("id,status").like("file_path", "%" + safe).limit(1);
    if (existing && existing.length) return json({ ok: true, dup: true, id: existing[0].id });
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return json({ error: "bad base64" }, 400); }
    const path = Date.now() + "_" + safe;
    const { error: upErr } = await admin.storage.from("pinv").upload(path, bytes, { contentType: "application/pdf" });
    if (upErr) return json({ error: upErr.message }, 500);
    const { data: rowIns, error: insErr } = await admin.from("pinv").insert({ file_path: path, status: "uploaded", created_by: "email-bot" }).select("id").single();
    if (insErr) return json({ error: insErr.message }, 500);
    const readReq = fetch("https://attendancezp-web.vercel.app/api/pinv/extract", {  // ⚠ HARDCODED HOST — repoint on move
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-token": secret.value },
      body: JSON.stringify({ id: rowIns.id }),
    }).then(() => {}).catch(() => {});
    try {
      // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
      if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) (EdgeRuntime as any).waitUntil(readReq);
      else await readReq;
    } catch { /* best-effort */ }
    return json({ ok: true, id: rowIns.id, read: "triggered" });
  }

  return json({ error: "unknown action" }, 400);
});
