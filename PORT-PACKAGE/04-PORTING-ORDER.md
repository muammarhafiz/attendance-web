# ZORDAQ Port — Recommended Order & Entanglement

Ordering is driven by two facts: (a) the **auth spine + `staff` + `app_secrets`** underpin everything, and (b) most "money/ops" features **read the Niagawan mirror**, so they can only be finished once **ZORDAQ's native POS tables (sales, invoices, COGS, customers, inventory, cash)** exist. So the POS core is the true gating dependency for half the app.

## Move-together clusters (atomic — port as a unit or it breaks)
- **A. Auth/identity spine:** `staff`, `staff_allowlist`, `position_access` + `can_access()`/`is_admin()`/`my_access()` + `app_secrets`. Nothing works without this.
- **B. Attendance + Leave + Requests:** `att_v2` (events/daily + recompute + check_in/geofence), `day_status`/`day_half`/`day_time_override`, `emergency_absences`, the request tables + `approve_*` RPCs, `public_holidays`, `leave_settings`, and `leave_balances()`/`my_leave_balance()`. The approve→day_status→recompute→balance chain must move whole. Storage bucket `mc`, `config` geofence row.
- **C. Payroll (`pay_v2` whole schema):** periods/items/item_types/settings, the 3 `ref_*` bands, all functions, both payslip views, the `payroll` storage bucket, the finalize/send API routes, and the check-in auto-build trigger.
- **D. Notifications:** `notification_feed()` + all 8 `_*_items` + `_filter_dismissed` + prefs/dismissed/subscriptions + `/api/push/dispatch` + `pushServer.ts` + `sw.js`. Feed errors if any source fn is missing.
- **E. Workshop board + Intake + Add-item:** `job_cards`/`intake_requests`/`additem_requests`/`workshop_settings`/`memos`/`oil_meta` + the two sale-invoice triggers + all board/intake RPCs + `plate_token` helpers.
- **F. Purchase-invoice OCR (Gemini):** `pinv`/`pinv_item` + `/api/pinv/extract` + `pinv_candidates` + `pinv` storage bucket + `gemini_key`. (The email/Drive watcher is off-platform — decide keep/rebuild.)
- **G. Finance/analytics:** staff-sales/commission RPCs, P&L page + `opex_bills`/`pnl_settings`/`trade_customers`/`grab_meals`, bank-recon + `maybank.ts`, office/month-end checklists + cash tables, BNPL (`bnpl_*` + automatch/overview + xlsx ingest), owner digest.

## Recommended sequence
**Step 0 — Cluster A (auth spine).** Prerequisite for all. Remember: a new `position` needs its `position_access` rows or staff can't use features; `checkin` is the only hard-coded-open feature.

**Step 1 — The ZORDAQ POS core must exist** (native sales, invoices, per-invoice COGS, customers, inventory, suppliers, cash — this is ZORDAQ's own build, not an attendance-web port). Everything in Steps 4–6 depends on it. Define these tables' shapes using `niagawan_*` (01) as the field reference.

**Step 2 — Cluster B (Attendance/Leave/Requests).** Highest independent value, **zero** Niagawan coupling, and it's the fallback's most safety-critical function. Fully portable now. Migrate leave *inputs* (see below), re-implement `leave_balances` verbatim.

**Step 3 — Cluster C (Payroll).** Depends only on A + B (reads `att_v2.daily`, `day_status`, holidays, `staff`). **No** Niagawan coupling — commission is manual/carry-forward. Port `pay_v2` verbatim (`02-STATUTORY-VERBATIM.sql`). Seed bands + a fresh first period; do not migrate history.

**Step 4 — Cluster D (Notifications).** Depends on A; the feed also reads B/C/E/G items. Port the logic verbatim; **re-host the transport** (pg_cron + pg_net + a NAS-reachable dispatch route). Its `lowstock`/`debt`/`owner-digest` source fns re-point to native inventory/sales (needs Step 1).

**Step 5 — Cluster E (Workshop/Intake/Add-item).** Needs Step 1 (native sales/customers/inventory). This is where the biggest re-pointing happens: reads → native tables; the add-item/intake **NAS-robot round-trips collapse into direct POS writes**.

**Step 6 — Clusters F + G (Purchasing OCR, Finance/analytics).** Need Step 1. Keep the Gemini OCR verbatim; **replace** the "hand to NAS robot / read the mirror" halves with native `ecom_create_purchase`/`ecom_create_po`/native sales+cash reads. BNPL's descp-regex sale-discovery becomes a native "payments where method in (bnpl)" query.

## Leave balances — what actually migrates (they are computed, not stored)
There is **no balance number to copy**. Migrate the **inputs**: `staff.start_date`, the full `day_status` history (+`paid_override`), `emergency_absences`, `public_holidays` (incl. handling/swap_to_date), and `leave_settings.track_from`. Then re-create `leave_balances(int)`/`my_leave_balance(int)` **verbatim** (entitlement tiers annual 8/12/16 & MC 14/18/22 by tenure; Sundays+holidays excluded; `track_from` floor). `leave_settings.carry_forward` exists but is currently **ignored** — don't silently change that on port (it's the open "leave balances still to design" item).

## The re-point acceptance checklist (don't ship a domain until these are native, not `niagawan_*`)
- staff-sales / commission / P&L → native sales + per-invoice COGS + daily rollup (`staff_sales_report`, `all_staff_sales`, `staff_sales_board`, `_owner_digest_compose`, pnl page).
- BNPL discovery → native payments (replace `descp ~ 'Receipt for (S#)'` on `niagawan_cash_entries`).
- office/daily line-ticking + bank recon → native payment lines (`clerk_cash_entries`, `owner_recon_receipts`, `cash_entry_checked` ekey scheme).
- workshop board triggers + `board_card_phones`/`board_card_customer`/`_intake_match_customer` + `sales_needs_mechanic` → native sales/customers; **re-key mechanic attribution off the native sale's mechanic field and retire `sales_staff_map`**.
- purchasing `pinv_candidates` + inventory-v4 reads + resolve/check queues → native catalog/stock/velocity; approve → `ecom_create_purchase`/`ecom_create_po`.
- notifications `_notification_items` (lowstock/debt) + `_owner_digest_items`/`_bnpl_payout_items` → native inventory/sales.
- **Delete:** `sync_requests`, `automation_tasks`, the 4 `niagawan-*` edge functions, `request_*_sync` pokes, `stg_nia_*` staging.
