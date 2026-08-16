# ZORDAQ Port — Domain Inventory

The map of what attendance-web *is*, grouped so each block can be reasoned about and ported as a unit.
For every domain: **purpose · key tables · key RPCs/functions · pages & API routes · self-contained? ·
cross-dependencies · PORT ACTION**. This file stands alone — the receiving session cannot see the repo
or DB.

**PORT ACTION legend**
- **VERBATIM** — port the tables + logic as-is (SQL in `db/functions/` and `02-STATUTORY-VERBATIM.sql`).
- **RE-POINT** — the *logic* is worth keeping, but it currently **reads the `niagawan_*` mirror**; in
  ZORDAQ it must read ZORDAQ's own POS tables. Not a table-copy — a re-wire. (See 00 for the principle.)
- **REBUILD** — a NAS-robot / off-platform round-trip that collapses into a direct in-DB write in ZORDAQ.
- **RETIRE** — exists only to feed the mirror; deleted in ZORDAQ.

Cluster letters (A–G) match the move-together clusters in `04-PORTING-ORDER.md`.

---

## Group 0 — Shared substrate (Cluster A)  ·  PORT ACTION: VERBATIM
The spine everything else stands on. Nothing works until this exists.

- **Tables:** `staff` (keyed by lowercased **email** — this is the real identity key, not the auth UUID;
  holds `start_date`, `weekly_schedule` jsonb, `work_start_time`, `track_attendance`, `archived_at`,
  `position`), `staff_allowlist` (who may sign in), `position_access` (the position→feature matrix),
  `app_secrets` (the DB secret vault — 9 rows, names in `db/SECRETS-EXPECTED.md`), `config` (single row
  id=1: geofence `workshop_lat/lon/radius_m` + shop settings).
- **RPCs/functions:** `can_access(feature text)`, `is_admin()`, `my_access()` — the authorization
  primitives called by ~all RLS policies and pages.
- **Pages/routes:** admin user management (`/api/admin/set-login-access`, `/api/admin/delete-employee`),
  Settings.
- **Self-contained:** Yes. No Niagawan coupling.
- **Cross-deps:** consumed by *every* other group.
- **Port notes:** VERBATIM. Two live traps carried in memory: (1) a new `position` needs its
  `position_access` rows or that staff can't use any gated feature; (2) `checkin` is the **only**
  hard-coded-open feature — everything else is deny-by-default. Preserve both behaviours.

---

## Group 1 — Attendance + Leave + Requests (Cluster B)  ·  PORT ACTION: VERBATIM
The safety-critical core and the single most portable domain — **zero Niagawan coupling**.

- **Tables:** `att_v2.events` (raw check-in/out punches, geofenced), `att_v2.daily` (computed daily
  row: status/check_in_kl/check_out_kl/late_min/half), `day_status` (manual status overrides),
  `day_half` (AM/PM half-day), `day_time_override` (manual in/out times), `emergency_absences`,
  `public_holidays` (with `handling` + `swap_to_date`), `leave_settings` (`track_from`, `carry_forward`
  — currently ignored), the request tables (leave/off-day/emergency).
- **RPCs/functions:** `att_v2.check_in`/`check_out` (geofence enforced via `_distance_m` +
  `_get_geofence`), `att_v2.recompute_daily_for(day, cutoff)` (the daily engine — status precedence:
  manual `day_status` > present > weekly_schedule home/off > public holiday > absent), the `approve_*`
  request RPCs, and **`leave_balances(int)` / `my_leave_balance(int)`** (entitlement tiers by tenure:
  annual 8/12/16, MC 14/18/22; Sundays + holidays excluded; floored at `track_from`). All in
  `db/functions/att_v2.sql` except the leave/request RPCs.
- **Pages/routes:** attendance page (geolocated check-in), leave/off-day requests + approvals
  (`/api/offday/edit`, `/api/supervisors`), the 10am daily attendance report, Holidays settings.
- **Storage:** `mc` bucket (MC certificates + off-day attachments), `config` geofence row.
- **Self-contained:** Yes — depends only on Group 0.
- **Cross-deps:** feeds Payroll (Group 2) via `att_v2.daily` + `day_status` + holidays.
- **Port notes:** VERBATIM, and portable **now** (doesn't wait for the POS core). Leave balances are
  **computed, not stored** — migrate the *inputs* (`staff.start_date`, full `day_status` history +
  `paid_override`, `emergency_absences`, `public_holidays`, `leave_settings.track_from`) and re-create
  the functions verbatim. The approve → `day_status` → recompute → balance chain must move whole.

---

## Group 2 — Payroll (`pay_v2` whole schema) (Cluster C)  ·  PORT ACTION: VERBATIM
Correctness-above-all. Malaysian statutory math; **no Niagawan coupling** (commission is manual /
carry-forward, not scraped).

- **Tables:** `pay_v2.periods`, `pay_v2.items`, `pay_v2.item_types`, `pay_v2.settings`, the three
  **`pay_v2.ref_*` statutory bands** (`ref_eis_bands` 55 rows, `ref_socso_bands` 65, `ref_skbbk_bands`
  65 — **the numbers ARE the logic**), plus the two payslip views. (Note: `public.eis_brackets`/
  `socso_brackets` are LEGACY/orphaned — do **not** port them.)
- **RPCs/functions:** the whole pipeline in `db/functions/pay_v2-pipeline.sql` (build_period,
  sync_base_items, sync_recurring_earnings with COMM carry-forward, sync_absent/unpaid-leave
  deductions, sync_ph_work_earnings, sync_punctuality_allowance, finalize/lock/unlock, item guards) +
  the statutory calc in `02-STATUTORY-VERBATIM.sql` (EPF ceil-to-RM20 → 11% / 13%-or-12%; SOCSO+SKBBK
  combined employee line; EIS; Temporary/Trainer exemptions; unpaid-divisor ×2; absent-days-from-report).
- **Pages/routes:** payroll admin, `/api/payroll/finalize`, `/api/payroll/send-payslips`,
  `/api/payroll/my-payslip`.
- **Storage:** `payroll` bucket (generated payslip + summary PDFs).
- **Self-contained:** Yes — reads `att_v2.daily`, `day_status`, holidays, `staff`. Depends on A + B only.
- **Cross-deps:** a check-in can auto-build the current period (trigger) — that trigger moves with C.
- **Port notes:** VERBATIM. Seed the bands + a **fresh** first period; **history does NOT migrate**
  (calendar-year tax boundary — see 00). Emailed payslip PDFs are the one external-signed-URL case —
  see 03.
- **⚠ REQUIREMENT (from the 2026-08-16 payroll audit) — commission must be statutory by construction.**
  In attendance-web, commission entered payroll as a **hand-typed `COMM` line with a stat-exempt flag
  nobody revisited**, so it silently sat outside the EPF/SOCSO/EIS wage base. (Harmless there only
  because the commission was unpaid test data — but it would under-contribute the moment a real
  commission was paid.) In ZORDAQ, **commission is posted automatically by the commission engine**, so
  the classification cannot live in a flag someone sets once: **any commission item the engine posts
  into payroll MUST be statutory-subject (EPF + SOCSO + EIS) by design.** More generally, carry the
  correct wage-base classification per earning type into the schema, not into per-row flags: cash
  allowances / incentives / arrears / additional-salary = EPF+SOCSO+EIS; **annual bonus = EPF only**
  (SOCSO/EIS-exempt); **overtime & travelling allowance = exempt from all three**. Also fix-forward two
  band issues the audit found before they bite: the **EIS table must reach the RM6,000 ceiling** (65
  bands, not the 55/RM5,000 attendance-web still has), and **do not carry the `salary_profiles`
  epf-rate default of `11`** (scale landmine — use `0.11` or drop the dead columns). See the audit's
  `db/proposed-fixes-2026-08-16.sql`.

---

## Group 3 — Notifications & Push (Cluster D)  ·  PORT ACTION: VERBATIM logic, RE-HOST transport, RE-POINT 2 sources
The in-app bell + web-push + owner end-of-day digest.

- **Tables:** notification prefs, dismissed, push `subscriptions` (VAPID endpoints).
- **RPCs/functions:** `notification_feed()` + the 8 `_*_items` source functions + `_filter_dismissed`;
  `notify_owner()` and `notify_new_request()` (both call `net.http_post`); the owner-digest composer
  (`_owner_digest_compose` / `build_owner_digest`).
- **Pages/routes:** the bell UI, PushToggle, **`/api/push/dispatch`** (drained every 60s by pg_cron),
  `/api/push/test`, `lib/pushServer.ts`, the service worker `public/sw.js`, Settings → Notifications.
- **Transport (fragile — see 03):** pg_cron job `push-dispatch` → `net.http_post` → `/api/push/dispatch`;
  `app_base_url` + `push_dispatch_token` + VAPID keys from `app_secrets`; email via `notify_url`
  (Google Apps Script relay).
- **Self-contained:** Partly. Feed *logic* depends on A; the feed *reads* items from B/C/E/G.
- **Cross-deps:** two source functions (`lowstock`/`debt` in `_notification_items`, and the
  `_owner_digest_items`/`_bnpl_payout_items`) **read the Niagawan mirror** → RE-POINT to native
  inventory/sales (needs the POS core).
- **Port notes:** the feed logic ports VERBATIM; the **transport must be re-hosted** on the NAS
  (pg_cron + pg_net enabled + a NAS-reachable dispatch route) or push + digest **stop silently**. Any
  notification change must also be wired into Settings → Notifications (a live invariant).

---

## Group 4 — Workshop board + Intake + Add-item (Cluster E)  ·  PORT ACTION: RE-POINT + REBUILD
The service-bay board: customer cards, job cards, walk-in intake, "add item to an open sale". This is
where the **heaviest re-pointing** lives.

- **Tables:** `job_cards`, `intake_requests`, `additem_requests`, `workshop_settings`, `memos`,
  `oil_meta`, `sales_staff_map` (the mechanic-attribution side-table — to be retired), `sales_needs_mechanic`.
- **RPCs/functions:** board/intake RPCs, `board_card_phones` / `board_card_customer`,
  `_intake_match_customer` (the guarded customer match — the wrong-phone bug fix lives here), the
  `plate_token` helpers, and the two **sale-invoice triggers** that fire the board off new sales.
- **Pages/routes:** the Workshop board page (customer cards + WhatsApp button), intake queue.
- **Self-contained:** No — reads Niagawan sales/customers/inventory heavily.
- **Cross-deps:** the whole board is downstream of the POS.
- **Port notes:** **RE-POINT** every read to ZORDAQ-native sales/customers/inventory. **REBUILD** the
  add-item and intake **NAS-robot round-trips as direct POS writes** (ZORDAQ owns the POS, so "hand to
  robot → robot writes back to Niagawan → we re-read the mirror" collapses to one in-DB write).
  **Re-key mechanic attribution off the native sale's mechanic field and retire `sales_staff_map`.**
  Keep `_intake_match_customer`'s tightened matching (guards against the cross-customer phone autofill).

---

## Group 5 — Purchasing: Purchase-invoice OCR + Inventory + Auto-PO (Cluster F)  ·  PORT ACTION: keep OCR VERBATIM, RE-POINT + REBUILD the rest
Supplier invoices in by email/Drive → Gemini OCR → stock + PO suggestions.

- **Tables:** `pinv`, `pinv_item`, `pinv_candidates`, the inventory-v4 watchlist / balances / velocity /
  group-avg / suppliers tables, auto-PO config/schedule/suggestions/approved.
- **RPCs/functions:** the inventory + auto-PO RPCs; the OCR route logic.
- **Edge functions (RETIRE):** `niagawan-inventory` (v9), `niagawan-autopo` (v6), `niagawan-pinv` (v19).
- **Pages/routes:** **`/api/pinv/extract`** (calls Google Gemini — keep verbatim), purchasing pages.
- **Storage:** `pinv` bucket (supplier invoice PDFs). Secret `gemini_key`.
- **Off-platform:** the Gmail + Drive watcher that drops invoices into the pipeline is **not** in the
  repo or DB (see 03) — decide keep-or-rebuild. Also: `niagawan-pinv` hardcodes
  `https://attendancezp-web.vercel.app/api/pinv/extract` — the one self-referential host that must be
  re-pointed on any move.
- **Self-contained:** No.
- **Port notes:** keep the **Gemini OCR extraction verbatim** (it's genuinely valuable and portable);
  **RE-POINT** inventory reads to native catalog/stock/velocity; **REBUILD** "approve → hand to NAS
  robot" as native `ecom_create_purchase` / `ecom_create_po` writes; RETIRE the 3 edge functions and
  the resolve/check queues.

---

## Group 6 — Finance / Sales / Commission / P&L / Cash / BNPL / Bank-recon (Cluster G)  ·  PORT ACTION: RE-POINT
The money-analytics layer. Almost entirely a **read-consumer of the mirror** → the biggest RE-POINT surface.

- **Tables:** `opex_bills`, `pnl_settings`, `trade_customers`, `grab_meals`, the cash tables
  (`clerk_cash_entries`, `owner_recon_receipts`, `cash_entry_checked` ekey scheme), `bnpl_*` (providers,
  transactions, matches), office/month-end checklists.
- **RPCs/functions:** `staff_sales_report`, `all_staff_sales`, `staff_sales_board` (staff sales +
  profit-per-mechanic), commission RPCs, the P&L builders, BNPL automatch/overview, bank-recon
  (`lib/maybank.ts`), `_owner_digest_compose`.
- **Pages/routes:** Staff Sales, P&L page, BNPL payment page, `/api/bank/reconcile`, `/api/bnpl/ingest`
  (xlsx import), office/daily checklists, receivables card.
- **Self-contained:** No — this domain *is* mirror reads.
- **Cross-deps:** every RPC here reads `niagawan_*` sales / cash / customers / COGS.
- **Port notes:** **RE-POINT** all of it to native sales + **per-invoice COGS** + daily rollup. BNPL
  sale-discovery (`descp ~ 'Receipt for (S#)'` on `niagawan_cash_entries`) becomes a native
  "payments where method in (bnpl…)" query. Office line-ticking + bank recon re-point to native payment
  lines. Commission re-keys off the native sale's mechanic field. The invoice **gross-profit → profit-
  per-mechanic** pipeline is app-side-shipped but its COGS capture (`cogsInv`) is the open NAS piece —
  in ZORDAQ this is native (no capture step).

---

## Substrate to RETIRE — the Niagawan ingestion pipeline
Not a feature — the plumbing that fills the mirror. **Deleted in ZORDAQ** (ZORDAQ *is* the POS).

- **Tables:** ~22 `niagawan_*` mirror tables (sales, cash_entries, customers, products, outstanding,
  COGS…), `sync_requests` (the poke queue), `automation_tasks`, `stg_nia_*` staging.
- **Edge functions:** `niagawan-ingest` (v29 — the NAS→DB job router), `niagawan-inventory`,
  `niagawan-autopo`, `niagawan-pinv` (all backed up verbatim in `supabase/functions/`).
- **Pokes:** `request_*_sync` functions, the `daily-customers-refresh` cron job.
- **Port notes:** treat `niagawan_*` as a **field-shape reference** for ZORDAQ's native tables, then
  RETIRE. Every consumer above that "reads the mirror" is a RE-POINT target; `04`'s acceptance
  checklist is the list to tick off before deleting any of this.

---

## One-screen summary

| Group | Cluster | Niagawan-coupled? | Port action | Gated by |
|---|---|---|---|---|
| 0 Shared substrate | A | No | VERBATIM | — |
| 1 Attendance/Leave/Requests | B | No | VERBATIM | A |
| 2 Payroll (`pay_v2`) | C | No | VERBATIM | A, B |
| 3 Notifications & Push | D | 2 sources only | VERBATIM logic + RE-HOST transport + RE-POINT 2 sources | A (+ POS for 2 sources) |
| 4 Workshop/Intake/Add-item | E | Heavily | RE-POINT + REBUILD | POS core |
| 5 Purchasing (OCR/Inv/AutoPO) | F | Heavily | OCR VERBATIM; rest RE-POINT + REBUILD | POS core |
| 6 Finance/Sales/P&L/Cash/BNPL | G | Almost entirely | RE-POINT | POS core |
| Ingestion pipeline | — | (is the mirror) | RETIRE | — |

**The shape of the work:** Groups 0–2 are a clean verbatim lift and deliver the safety-critical fallback
functions with no POS dependency. Everything from Group 3's two sources onward waits on ZORDAQ's native
POS core existing, because the dominant risk isn't a missing table — it's a silently-kept `niagawan_*`
read returning nothing in ZORDAQ.
