# ZORDAQ Port — Outbound Contract (NAS producer → 4 edge functions)

The exact shape of every payload the NAS Niagawan scraper POSTs into the four token-authenticated edge
functions, so **ZORDAQ can become the producer with zero changes to the attendance app**. Derived from
the **edge-function source** (the write side — authoritative for fields *and* write semantics), not from
the app's read side. Every line is tagged **[V]** verified (read in the code / confirmed against the live
schema) or **[I]** inferred.

**Scope — "the 13":** the NAS Niagawan **business-data feeds** — snapshots of Niagawan POS state the app
consumes. Excluded and documented separately in the Appendix so nothing is hidden: `grabMeals` (posted by
the **Apps Script mailbox bot**, not the Niagawan scraper), the robot **job-coordination callbacks**
(`claim/complete/getIntake/markIntake/getAddItems/markAddItem` and the auto-PO / purchase-invoice
pipeline), which are a request/response job protocol that **collapses to direct in-DB writes in ZORDAQ**
(see `04`), not producer feeds. If the decisions-log's "13" draws the line slightly differently (e.g.
counts `grabMeals`, drops `cogsZeros`), the shapes for those are all documented here regardless.

---

## 🛑 DATA-LOSS RISK — READ FIRST: 7 of the 13 have destructive write semantics
**A windowed producer must never drive a full-replace consumer.** The 3,878 sale invoices and their COGS
exist **only** in the hosted attendance DB (sales history is excluded from the ZORDAQ import). These 7
actions delete before they load — if ZORDAQ posts a rolling window (or a partial population) into them,
data is gone, not just a screen broken.

| # | Action → table | Destructive semantics | VERDICT for the swap |
|---|---|---|---|
| **8** | **`salesRows` → `niagawan_sale_inv`** (holds the **3,878 invoices**) | **REPLACE-BY-DAY**: upserts the payload, then **deletes every invoice for that `day` not in the payload** | **HIGHEST RISK.** ZORDAQ must post `salesRows` **only for days ≥ its own go-live**, and never re-post a historical day (a rolling "last N days" window would delete the hosted history for those days). Safest: **change the delete-day step to pure upsert** before the swap. |
| **5** | **`outstanding` → `niagawan_outstanding`** | **WIPE-AND-LOAD**: deletes the **entire table** then upserts | ZORDAQ must send the **full** current unpaid+partial population on **every** post, or change to upsert+reconcile. A partial post empties the debts picture. |
| **1** | **`products` → `niagawan_products`** | **WIPE-AND-LOAD** on `first:true` batch | Send the **full catalog** with the `first:true` batch. Regenerable (catalog), lower stakes — but a partial first-batch still wipes. |
| **2** | **`customers` → `niagawan_customers`** | **WIPE-AND-LOAD** on `first:true` batch | Send the **full** customer list with `first:true`. |
| **13** | **`putSuppliers` → `niagawan_suppliers`** | **WIPE-AND-LOAD** on `first:true` batch | Send the **full** supplier list with `first:true`. |
| **4** | **`cashEntries` → `niagawan_cash_entries`** | **REPLACE-BY-DAY**: deletes all lines for `day`, then inserts | Post **complete** lines for each day; never touch a historical day with partial data. |
| **6** | **`cogsZeros` → `niagawan_cogs_zeros`** | **REPLACE-BY-AUDIT-DATE**: deletes all rows for `audit_date`, then inserts | Post the **complete** set per audit date. |

**The reassuring half:** the **COGS is safe** — `cogsInv → niagawan_invoice_cogs` is **upsert-by-inv with
no delete** (#7), and the daily P&L rollup `niagawan_daily` is **upsert-by-day** (#9). So the COGS records
are not at risk from the producer swap; **the single history-losing exposure is `salesRows` (#8)**, plus
the wipe-all of `outstanding` (#5) if fed a partial. The other 6 of 13 are plain upserts — safe by design.

---

## Authentication (identical across all 4 functions)
- **`verify_jwt = false`** on all four (deploy config, captured 2026-08-16) — they do **not** use Supabase
  Auth. **[V]**
- **Token check (in code, all four):** `provided = body.token ?? req.headers.get("x-ingest-token")`,
  compared to `public.app_secrets.value WHERE name = 'niagawan_ingest_token'`. So the token may be sent
  **either** as JSON body field `token` **or** as HTTP header **`x-ingest-token`**. Mismatch → `401`. **[V]**
- **Header name:** `x-ingest-token` (also whitelisted in each function's CORS `Access-Control-Allow-Headers`). **[V]**
- **Token storage — DB side:** `public.app_secrets`, row `name='niagawan_ingest_token'`, opaque ~36-char
  string (value never recorded here). **[V]** (length verified; value not read into this file)
- **Token storage — NAS side:** held by the scraper on the Synology (its own config/env) — it must carry
  the matching token to authenticate. Exact location on the NAS not visible from here. **[I]**
- Note: `pinvUpload` forwards this **same** token as `x-ingest-token` when it calls the app's
  `/api/pinv/extract` (the one hardcoded host — see `03` §E2). **[V]**
- **Transport:** HTTPS POST, JSON body, `action` field selects the handler (default `"upsert"` in
  `niagawan-ingest`; required elsewhere). Non-POST → 405; bad JSON → 400. **[V]**

---

## The 13 feeds

Notation: **req** = required (row dropped/blocked if missing), **num** = JS `Number`-coerced (non-finite →
null), string lengths are the server-side `.slice(n)` truncation caps. `updated_at`/`scanned_at`/`checked_at`
are stamped **server-side**, never sent. Examples use placeholders for any real name/plate/customer.

### 1 · `products` — product catalog  ·  fn `niagawan-ingest`  ·  table `niagawan_products` (PK `sku`)
Envelope: `{ action:"products", token, first?:boolean, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `sku` | string ≤20 | **req** | `"12345"` |
| `code` | string ≤80 | yes | `"NGK-BKR6E"` |
| `descp` | string ≤240 | yes | `"SPARK PLUG NGK"` |
| `price` | num | yes | `12.50` |
| `cost` | num | yes | `8.00` |

**Write semantics [V]:** if `first===true` → `DELETE FROM niagawan_products` (all rows) → then
`upsert(rows, onConflict:"sku")`. **WIPE-AND-LOAD (first batch).** Subsequent batches upsert-only. Rows with no `sku` dropped.

### 2 · `customers` — customer catalog  ·  `niagawan-ingest`  ·  `niagawan_customers` (PK `customer_id`)
Envelope: `{ action:"customers", token, first?:boolean, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `customer_id` | string ≤20 | **req** | `"C00123"` |
| `name` | string ≤200 | yes | `"CUSTOMER NAME"` |
| `phone` | string ≤60 | yes | `"+60XXXXXXXXX"` |

**Write semantics [V]:** `first===true` → wipe whole table → then `upsert(onConflict:"customer_id")`. **WIPE-AND-LOAD (first batch).**

### 3 · `cashDaily` — daily cash-book totals  ·  `niagawan-ingest`  ·  `niagawan_cash_daily` (PK `day`)
Envelope (single record, not `rows`): **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `day` | string `YYYY-MM-DD` | **req** (regex-validated) | `"2026-08-16"` |
| `cash_in` | num | yes | `1500.00` |
| `cash_out` | num | yes | `200.00` |
| `qr_in` | num | yes (column only written if finite) | `800.00` |
| `card_in` | num | yes (only if finite) | `450.00` |
| `transfer_in` | num | yes (only if finite) | `300.00` |

**Write semantics [V]:** `upsert(onConflict:"day")`. **SAFE (upsert-by-day).**

### 4 · `cashEntries` — per-day cash-book lines  ·  `niagawan-ingest`  ·  `niagawan_cash_entries` (PK `id` serial)
Envelope: `{ action:"cashEntries", token, day:"YYYY-MM-DD" (req), rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `method` | string ≤32 | **req** | `"CASH"` / `"QR"` / `"CARD"` / `"TRANSFER"` |
| `label` | string ≤60 | yes | `"Receipt for (S#00012)"` |
| `descp` | string ≤300 | yes | `"…"` |
| `amount` | num | yes | `120.00` |

**Write semantics [V]:** `DELETE WHERE day=:day` → then `INSERT rows` (no upsert; PK is serial `id`).
**REPLACE-BY-DAY.** (BNPL discovery reads this via a `descp ~ 'Receipt for (S#…)'` regex — see `04`.)

### 5 · `outstanding` — unpaid+partial snapshot (all years)  ·  `niagawan-ingest`  ·  `niagawan_outstanding` (PK `sale_id`)
Envelope: `{ action:"outstanding", token, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `sale_id` | string ≤20 | **req** | `"S00012"` |
| `sale_inv_no` | string ≤40 | yes | `"INV-2026-0012"` |
| `customer` | string ≤200 | yes | `"CUSTOMER NAME"` |
| `total` | num | yes | `500.00` |
| `paid` | num | yes | `200.00` |
| `balance` | num | yes | `300.00` |
| `status` | string ≤20 | yes | `"partial"` |
| `sale_date` | string `YYYY-MM-DD` | yes | `"2026-08-01"` |
| `delivered_date` | string `YYYY-MM-DD` | yes | `"2026-08-03"` |

**Write semantics [V]:** `DELETE FROM niagawan_outstanding` (all) → then `upsert(onConflict:"sale_id")`.
**WIPE-AND-LOAD.**

### 6 · `cogsZeros` — zero-cost audit rows  ·  `niagawan-ingest`  ·  `niagawan_cogs_zeros` (PK `id` serial)
Envelope: `{ action:"cogsZeros", token, auditDate:"DD/MM/YYYY" (req), rows:[…] }` (note `DD/MM/YYYY`, converted server-side to ISO). Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `inv` | string | yes | `"INV-2026-0012"` |
| `invDate` | string | yes | `"01/08/2026"` |
| `item` | string ≤300 | yes | `"ITEM DESC"` |
| `code` | string | yes | `"NGK-BKR6E"` |
| `price` | string (stored as text) | yes | `"0"` |

**Write semantics [V]:** `DELETE WHERE audit_date=:iso` → `INSERT rows`. **REPLACE-BY-AUDIT-DATE.**

### 7 · `cogsInv` — per-invoice cost / gross profit  ·  `niagawan-ingest`  ·  `niagawan_invoice_cogs` (PK `inv`)
Envelope: `{ action:"cogsInv", token, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `inv` | string ≤40 | **req** | `"INV-2026-0012"` |
| `day` | string `YYYY-MM-DD` or `DD/MM/YYYY` | yes | `"2026-08-16"` |
| `amount` | num | yes | `500.00` |
| `cogs` | num | yes | `320.00` |
| `gross_profit` | num | yes | `180.00` |

**Write semantics [V]:** `upsert(onConflict:"inv")`, **no delete**. **SAFE.** ← this is the COGS store; it is
NOT at risk from the swap.

### 8 · `salesRows` — per-day sale invoices  ·  `niagawan-ingest`  ·  `niagawan_sale_inv` (PK `inv`)  ·  ⚠ HOLDS THE 3,878 INVOICES
Envelope: `{ action:"salesRows", token, day:"YYYY-MM-DD" (req), rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `inv` | string ≤40 | **req** | `"INV-2026-0012"` |
| `sale_id` | string ≤20 | yes | `"S00012"` |
| `customer` | string ≤160 | yes | `"CUSTOMER NAME"` |
| `amount` | num | yes | `500.00` |
| `paid` | num | yes | `500.00` |
| `status` | string ≤20 | yes | `"paid"` |
| `staff` | string ≤80 | yes | `"MECHANIC NAME"` |

**Write semantics [V]:** `upsert(onConflict:"inv")` → THEN
`DELETE WHERE day=:day AND inv NOT IN (payload invs)`. **REPLACE-BY-DAY.** ← **the one action that can lose
sales history.** Verdict in the risk table above. (Also touched by `markIntake`/`markAddItem` as single-row
upserts — Appendix.)

### 9 · `daily` (default action) — daily P&L rollup  ·  `niagawan-ingest`  ·  `niagawan_daily` (PK `day`)
Envelope: `{ token, rows:[…] }` **or** `{ token, row:{…} }` — **no `action` field** (this is the default
handler when `action` is absent/`"upsert"`). Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `day` | string | **req** | `"2026-08-16"` |
| `invoices` | num (→0) | no (defaults 0) | `12` |
| `sales` | num (→0) | no (defaults 0) | `4200.00` |
| `cogs` | num (→0) | no (defaults 0) | `2600.00` |
| `profit` | num (→0) | no (defaults 0) | `1600.00` |
| `unpaid_count` | num | yes (null allowed) | `3` |

**Write semantics [V]:** `upsert(onConflict:"day")`. **SAFE (upsert-by-day).**

### 10 · `putBalances` — stock balances  ·  fn `niagawan-inventory`  ·  `niagawan_inventory` (PK `code`)
Envelope: `{ action:"putBalances", token, checked_at?:"YYYY-MM-DD" (default today), rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `code` | string | **req** | `"NGK-BKR6E"` |
| `balance` | num (`""`/null → null) | yes | `24` |
| `suppliers` | num | yes | `2` |

**Write semantics [V]:** `upsert(onConflict:"code")` (+ non-fatal `rpc niagawan_clear_resolved_status`). **SAFE.**

### 11 · `putVelocity` — sales velocity  ·  `niagawan-inventory`  ·  `niagawan_sales_velocity` (PK `code`)
Envelope: `{ action:"putVelocity", token, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `code` | string | **req** | `"NGK-BKR6E"` |
| `sold_7d` | num | yes | `5` |
| `sold_30d` | num | yes | `20` |
| `last_sold` | string `YYYY-MM-DD` | yes | `"2026-08-15"` |

**Write semantics [V]:** `upsert(onConflict:"code")`. **SAFE.**

### 12 · `putGroupAvg` — group monthly averages  ·  `niagawan-inventory`  ·  `niagawan_group_avg` (PK `sku`)
Envelope: `{ action:"putGroupAvg", token, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `sku` | string | **req** | `"12345"` |
| `code` | string | yes | `"NGK-BKR6E"` |
| `sold_90d` | num | yes | `60` |
| `avg_monthly` | num | yes | `20` |

**Write semantics [V]:** `upsert(onConflict:"sku")`. **SAFE.**

### 13 · `putSuppliers` — supplier/creditor list + balances  ·  `niagawan-inventory`  ·  `niagawan_suppliers` (PK `creditor_id`)
Envelope: `{ action:"putSuppliers", token, first?:boolean, rows:[…] }`. Row: **[V]**

| field | type | nullable | example |
|---|---|---|---|
| `creditor_id` | string ≤20 | **req** | `"CR0007"` |
| `name` | string ≤200 | yes | `"SUPPLIER SDN BHD"` |
| `balance` | num | yes | `3200.00` |

**Write semantics [V]:** `first===true` → wipe whole table → then `upsert(onConflict:"creditor_id")`.
**WIPE-AND-LOAD (first batch).**

---

## Dead feeds? — NONE. All 13 are actively read.
Checked the app read side (server-side `pg_proc`/`pg_views` + client `src/`). **Every one of the 13 target
tables is consumed** — there is no "13 minus one" to skip. **[V]** (function counts from live catalog):

| table | # reader fns | representative readers |
|---|---|---|
| `niagawan_sale_inv` | 14 | `staff_sales_report`, `all_staff_sales`, `sales_needs_mechanic`, `open_invoices_today`, … |
| `niagawan_cash_entries` | 12 | `bnpl_overview`, `bnpl_automatch`, `clerk_cash_entries`, `owner_recon_receipts`, … |
| `niagawan_cash_daily` | 8 | `clerk_daily_summary`, `owner_bank_transfers`, `_owner_digest_compose`, … |
| `niagawan_products` | 8 | `search_products`, `new_catalog_items`, `pinv_candidates`, `oil_list`, … |
| `niagawan_inventory` | 6 | `_notification_items`, `_po_created_items`, `oil_list`, `owner_dashboard`, … |
| `niagawan_customers` | 4 | `_intake_match_customer`, `board_card_customer`, `board_card_phones`, `queue_update_phone` |
| `niagawan_outstanding` | 4 (+1 view) | `owner_unpaid`, `clerk_home`, `close_stale_orphan_cards` |
| `niagawan_daily` | 3 | `owner_dashboard`, `sales_pending_days_count`, `_owner_digest_compose` |
| `niagawan_suppliers` | 3 | `clerk_home`, `month_end_status`, `owner_dashboard` |
| `niagawan_invoice_cogs` | 2 | `staff_sales_report`, `_owner_digest_compose` |
| `niagawan_cogs_zeros` | 2 | `cogs_zero_day_counts`, `clerk_cash_entries` |
| `niagawan_sales_velocity` | 2 | `clerk_home`, `reset_baselines_on_po_received` |
| `niagawan_group_avg` | 2 | `_notification_items`, `owner_dashboard` |

(Reads are almost entirely via SECURITY DEFINER RPCs — an app-read-side–only derivation would have missed
the field set each RPC ignores today, which is exactly why the shapes here come from the write side.)

---

## Appendix — writes NOT in the 13 (documented so the contract is complete)
- **`grabMeals`** (`niagawan-ingest`) — posted by the **Apps Script mailbox bot**, not the Niagawan
  scraper. `niagawan-ingest` → `grab_meals`, **upsert-by-`order_code`** (SAFE). Row:
  `{order_code req ≤40, meal_date YYYY-MM-DD, amount num, restaurant ≤160, payment_method ≤60, subject ≤200, item_count int, drink_count int}`. **[V]**
- **Robot job-coordination (request/response, collapses to direct writes in ZORDAQ):** `claim` (rpc
  `claim_sync_request`), `complete` (updates `sync_requests`), `getIntake`/`markIntake` (drains
  `intake_requests`; on done **upserts a stub into `niagawan_sale_inv` by `inv`** + rpc
  `stamp_intake_card`), `getAddItems`/`markAddItem` (drains `additem_requests`; updates
  `niagawan_sale_inv.amount` by `inv`). Single-row upserts — not bulk feeds. **[V]**
- **Auto-PO (`niagawan-autopo`):** `putSuggestions` → `po_suggestions` — **REPLACE-BY-PERIOD**: deletes
  `status='pending' AND period_from/to match AND source IS NULL`, then inserts (inventory-v3 rows with
  `source='inventory-v3'` are deliberately preserved). `markResult` updates a suggestion. **[V]** — if
  ZORDAQ ever drives this, note the period-scoped delete.
- **Purchase-invoice pipeline (`niagawan-pinv`):** `putDriveFolders` → `drive_folders` **WIPE-AND-LOAD**;
  `kivLog` → `niagawan_moved_sale` **INSERT (append-only)**; `kivPartial` → `niagawan_partial_sale`
  **WIPE-ALL then insert**; `pinvUpload` → storage + `pinv` insert (+ triggers `/api/pinv/extract`);
  `markResult/markCheck/markResolve/requeueStuck/getApproved/getCheckJobs/getResolveJobs/count*` are the
  OCR job protocol. **[V]** — this whole subsystem is a separate concern from the 13 business feeds; if
  kept, `putDriveFolders` and `kivPartial` are additional wipe-all actions to guard.

---

## COUNT (the number to report)
**Destructive actions among the 13 = 7** — **4 wipe-and-load** (`products`, `customers`, `outstanding`,
`putSuppliers`) + **3 replace-by-date** (`salesRows` by day, `cashEntries` by day, `cogsZeros` by audit
date). The remaining **6 of 13 are plain upserts** (safe): `cashDaily`, `cogsInv`, `daily`, `putBalances`,
`putVelocity`, `putGroupAvg`. The single history-losing exposure is **`salesRows` → `niagawan_sale_inv`**
(the 3,878 invoices); the COGS store (`cogsInv`) is a safe upsert. (Outside the 13, the Appendix adds 2
more wipe-all actions — `putDriveFolders`, `kivPartial` — and 1 replace-by-period — `putSuggestions` — if
ZORDAQ ever drives that subsystem.)
