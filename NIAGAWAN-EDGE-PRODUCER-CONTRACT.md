# Niagawan Edge-Function Producer Contract

For the **ZORDAQ producer** to POST directly into attendance-web's Supabase, replacing the NAS→Niagawan
scraper. Extracted from the deployed source of all four edge functions in project
`naefauflkisldxftxuhq` (read-only). Cutover plan: ZORDAQ becomes the producer behind this same seam, so
attendance-web needs zero changes; run both producers in parallel and compare per table before switching off Niagawan.

---

## Transport & auth — identical for all four functions
- **Endpoint:** `https://naefauflkisldxftxuhq.supabase.co/functions/v1/<slug>` (slugs: `niagawan-ingest`, `niagawan-inventory`, `niagawan-autopo`, `niagawan-pinv`).
- **Method:** `POST` only (else 405); `OPTIONS` → `"ok"` (CORS preflight). Body must be valid JSON (else 400).
- **Auth (shared secret):** send **either** HTTP header `x-ingest-token: <token>` **or** JSON body field `"token":"<token>"` — **body.token wins** if both present. Compared strict-equal (`!==`) to `app_secrets` row `name='niagawan_ingest_token'`, column `value`. Missing/mismatch → 401 `{"error":"unauthorized"}`; secret unreadable → 500 `{"error":"server auth misconfigured"}`.
- **`verify_jwt = false`** on all four — no Supabase JWT/apikey needed, the token IS the auth. Writes run under the **service-role key** (RLS bypassed).
- **Dispatch:** on JSON field `action`. Unknown action → 400 `{"error":"unknown action"}`.

## Replay-safety legend (you will be replaying windows)
| Symbol | Class | Meaning for replay |
|---|---|---|
| ✅ | upsert-by-key | Re-send same window → overwrites by key. Fully idempotent. |
| 🟡 | replace-by-date | Re-send a day/date → that slice is wiped & reloaded cleanly. Idempotent per slice. |
| 🔴 | full-snapshot (wipe-then-load) | **Deletes rows before loading.** A partial window = data loss. **Must send the COMPLETE set every call.** |
| ⛔ | insert-only | Re-send → **duplicate rows**. NOT idempotent. Truncate/dedupe before replay. |
| ⚙️ | worker/read | Job-queue or read-only; not a bulk data window. |

---

## 1. `niagawan-ingest` — the primary data feed
**Data-feed actions ZORDAQ must produce** (these fill the `niagawan_*` mirror the app renders):

| action | table | mode | required + key payload fields |
|---|---|---|---|
| *(omit action, or `"upsert"`)* | `niagawan_daily` | ✅ by `day` | `rows[]` (or single row) of `{day*, invoices, sales, cogs, profit, unpaid_count}`. ⚠ `day` is **not** format-validated here (stored as-given); numerics coerce `Number(x)||0`. |
| `salesRows` | `niagawan_sale_inv` | 🟡 by `day` | top-level `day*` (strict `YYYY-MM-DD`) + `rows[]{inv*, sale_id, customer, amount, paid, status, staff}`. Upserts by `inv`, then **prunes** any `inv` stamped with that `day` not in this batch (empty rows ⇒ clears the day). `staff` = the mechanic name (see attribution note). |
| `cogsInv` | `niagawan_invoice_cogs` | ✅ by `inv` | `rows[]{inv*, day (ISO **or** DD/MM/YYYY), amount, cogs, gross_profit}`. `gross_profit` **stored as-given** (not recomputed). |
| `cogsZeros` | `niagawan_cogs_zeros` | 🟡 by `audit_date` | top-level `auditDate*` **must be DD/MM/YYYY** (converted to ISO) + `rows[]{inv, invDate, item, code, price}`. `price` stored as **string**. |
| `outstanding` | `niagawan_outstanding` | 🔴 **full-snapshot** | `rows[]{sale_id*, sale_inv_no, customer, total, paid, balance, status, sale_date, delivered_date}`. **Deletes ALL rows every call**, then loads. Always send the complete unpaid+partial set. `balance` stored as-given. |
| `cashDaily` | `niagawan_cash_daily` | ✅ by `day` | `day*` (strict ISO) + `cash_in, cash_out, qr_in, card_in, transfer_in`. `qr/card/transfer` only written when present (omit ⇒ prior value kept). |
| `cashEntries` | `niagawan_cash_entries` | 🟡 by `day` | `day*` + `rows[]{method*, label, descp, amount}`. Deletes that day's lines then inserts. |
| `products` | `niagawan_products` | 🔴 wipe on `first:true` | `first` (bool) + `rows[]{sku*, code, descp, price, cost}`. Only the `first:true` batch wipes; replay the **whole** `first:true→…→last` sequence. |
| `customers` | `niagawan_customers` | 🔴 wipe on `first:true` | `first` + `rows[]{customer_id*, name, phone}`. Same batched-wipe rule. Phone **not** normalized (sliced to 60 chars). |
| `grabMeals` | `grab_meals` | ✅ by `order_code` | `rows[]{order_code*, meal_date (ISO), amount, restaurant, payment_method, subject, item_count, drink_count}`. |

**Worker-protocol actions (the scraper's job loop — ZORDAQ usually does NOT reproduce these):** `claim` / `complete` (the `sync_requests` queue), `getIntake` / `markIntake`, `getAddItems` / `markAddItem`.
⚠ **Hazard:** `markIntake` (when `status:'done'` + `inv_no` + `sale_id`) **seeds a `niagawan_sale_inv` row with `amount/paid/status = 0/0/'unpaid'` and `day = klToday()` (UTC+8)** — this can clobber real values written by `salesRows`. If ZORDAQ drives `salesRows` authoritatively, do **not** also drive `markIntake` for the same invoices.

Response: `{ok:true, ...}` per action (e.g. default → `{ok:true, upserted:N, day_range:[…], synced_at}`).

---

## 2. `niagawan-inventory`
| action | table | mode | required + key payload |
|---|---|---|---|
| `putBalances` | `niagawan_inventory` | ✅ by `code` | `checked_at` (pass explicitly for reproducible replays; defaults to server UTC date) + `rows[]{code*, balance, suppliers}`. Also fires RPC `niagawan_clear_resolved_status()` (non-fatal). |
| `putVelocity` | `niagawan_sales_velocity` | ✅ by `code` | `rows[]{code*, sold_7d, sold_30d, last_sold (strict ISO or null)}`. |
| `putGroupAvg` | `niagawan_group_avg` | ✅ by `sku` | `rows[]{sku*, code, sold_90d, avg_monthly}`. (Conflict key is **sku**, not code.) |
| `putSuppliers` | `niagawan_suppliers` | 🔴 wipe on `first:true`, else ✅ upsert by `creditor_id` | `first` + `rows[]{creditor_id*, name, balance}`. With `first:true` deletes ALL first (send full set); delete+insert are **not** transactional. |
| `seedWatchlist` | `niagawan_min_stock` | ✅ by `code` | `rows[]{code*, desc→description, min→min_balance (default 4), category}`. No deletes (removals don't propagate). |
| `getWatchlist` / `getGroupCodes` / `getGroupItems` | — | ⚙️ read | config getters. `getGroup*` join `inventory_po_group_items` × `niagawan_products` and prefer the live product code. |

**Derivation note (answers "who owns the calc"):** this function **stores the numbers you send** — it does **not** compute velocity, monthly average, or balance. After the swap, **ZORDAQ owns those calculations**; the edge layer only coerces/validates (finite-or-null, strict-ISO-or-null, string-slice).

---

## 3. `niagawan-autopo`  *(auto-PO engine; `automation_tasks.auto_po` is currently DISABLED — low cutover priority)*
| action | table | mode | required + key payload |
|---|---|---|---|
| `putSuggestions` | `po_suggestions` | 🟡 by `(period_from, period_to)` | `period_from, period_to, suggestions[]{supplier_id*, supplier_name, items, total}`. Deletes prior **pending, source-NULL** rows for that exact window, then inserts. `status` forced `'pending'`; `total` stored as-given. |
| `markResult` | `po_suggestions` | ✅ update by `id` | `id*, status ('error'→error else 'created'), po_id, po_number, note`. |
| `getConfig` | `niagawan_min_stock` | ⚙️ read | rows where `auto_po=true AND supplier_id NOT NULL`; optional `categories[]` filter. |
| `getSchedule` | `automation_tasks` | ⚙️ read | returns `key, enabled, schedule` (the NAS cron config). |
| `getApproved` | `po_suggestions` | ⚙️ read | up to 20 `status='approved'`. |

Note: `po_suggestions` is **not** a `niagawan_*` mirror table (it's the reorder engine). No fee/net/total computation anywhere here.

---

## 4. `niagawan-pinv`
**Niagawan data feeds (relevant to the mirror):**
| action | table | mode | required + key payload |
|---|---|---|---|
| `kivLog` | `niagawan_moved_sale` | ⛔ **insert-only** | `rows[]{sale_inv_no*, sale_id, customer, amount, original_date, new_date}`. **Replays DUPLICATE** — truncate or dedupe before re-sending. (This logs KIV/carry-forward re-dating; in ZORDAQ it's an internal audit row, not a scrape.) |
| `kivPartial` | `niagawan_partial_sale` | 🔴 **full-snapshot** | `rows[]{sale_inv_no*, sale_id, customer, total, paid, balance, sale_date}`. **Deletes ALL rows every call**, then inserts. Always send the complete partial-paid set. |

**Purchase-invoice OCR + email-robot worker protocol (NOT Niagawan-sourced — the app's own PI pipeline; ZORDAQ does NOT need these):** `countJobs` / `countApproved` / `countCheckJobs` / `countResolveJobs` (read counts), `getApproved` (→ sets pinv `creating`), `markResult`, `requeueStuck`, `getCheckJobs` / `markCheck`, `getResolveJobs` / `markResolve`, `pinvUpload` (uploads a PDF to storage + inserts a `pinv` row + triggers `/api/pinv/extract` OCR), `getMailSuppliers`, `putDriveFolders` (🔴 wipe-and-load `drive_folders`). Leave these to the existing email/OCR robot.

---

## Replay cheat-sheet (use this when driving the parallel test)
- **✅ Replay any window freely (upsert):** `niagawan_daily` (default), `cogsInv`, `cashDaily`, `grabMeals`; `putBalances`, `putVelocity`, `putGroupAvg`, `seedWatchlist`.
- **🟡 Replay one day/date/period at a time (re-does that slice):** `salesRows` (per `day`), `cashEntries` (per `day`), `cogsZeros` (per `auditDate`), `putSuggestions` (per period).
- **🔴 Must send the COMPLETE set in the call (wipes first — partial = data loss):** `outstanding` (every call), `kivPartial` (every call), `products` / `customers` / `putSuppliers` (when `first:true`), `putDriveFolders`.
- **⛔ NOT idempotent — duplicates on replay:** `kivLog`. Dedupe/truncate first.

## What the edge layer derives vs stores (so ZORDAQ knows what it owns)
- **Stored as-given → ZORDAQ owns the number:** `balance`, `gross_profit` (not recomputed as amount−cogs), `total`, `sold_7d/30d/90d`, `avg_monthly`, inventory `balance`.
- **Edge derives/normalizes → send in the accepted form:** `cogsZeros.auditDate` **must be DD/MM/YYYY**; `cogsInv.day` accepts ISO or DD/MM/YYYY; most other date fields must be strict `YYYY-MM-DD` or they're nulled — **except `niagawan_daily.day`, which is not validated**; `cogsZeros.price` stored as string; non-finite numerics → null (→0 for `niagawan_daily`); strings truncated; rows missing their key are **silently dropped** (except `cogsZeros`, which maps every element).
- **Multi-writer table:** `niagawan_sale_inv` is written by `salesRows`, `markIntake` (seed reset), and `markAddItem` — all keyed on `inv`. Drive it from one authoritative path (`salesRows`) to avoid the `markIntake` zero-out.

---

*Caveat: write-modes/derivations above are from a read of the deployed source (functions v29/v9/v6/v19). Confirm each table against a single test window during the parallel-producer phase before production replay — which the compare-and-cut-over plan already does.*
