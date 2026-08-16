# ZORDAQ System — Study Guide for Claude Cowork

**Purpose:** You (Claude Cowork) are helping build a *separate* web app. Before that, study this
existing production system — "attendance-web" — to learn its architecture, data model, and the
patterns worth reusing. This document tells you **where to look and what to study**, in order.

> ⚠️ **READ-ONLY.** This is a LIVE system with real staff, customer, and financial data.
> Do **not** INSERT/UPDATE/DELETE, run DDL, call write-RPCs, deploy, or trigger any sync/queue.
> Study by reading code and running **SELECT-only** queries. When in doubt, look, don't touch.

---

## 0. What you need access to (ask the owner if missing)
- **The repo**: `attendance-web` (GitHub `muammarhafiz/attendance-web`; locally `C:\Users\muamm\attendance-web`). Next.js App Router + TypeScript + Tailwind, hosted on Vercel.
- **The database (read-only)**: Supabase project ref **`naefauflkisldxftxuhq`** — via the Supabase MCP (`list_tables`, `execute_sql` for SELECT / `pg_get_functiondef`, `list_edge_functions`, `get_advisors`).
- If you only have one of the two, you can still learn a lot — the repo shows the UI + how it calls the backend; the DB shows the real schema + business logic (which lives largely in SQL functions).

---

## 1. What the system is (one paragraph)
Internal operations app for **ZORDAQ Auto Services**, a car workshop in Putrajaya. It began as a
staff attendance/clock-in tool and grew into a full back-office suite: **attendance & payroll**, a
**workshop job board**, a deep **two-way-ish integration with Niagawan** (their cloud POS/accounting),
**cash / P&L / month-end**, **inventory & purchasing**, **BNPL (ATOME) reconciliation**,
**staff-sales & commission**, a **notifications pipeline** (phone push + in-app bell + email), and a
large, newer **e-commerce / trading module** (`ecom_*` tables). One Next.js app + one Supabase
Postgres, glued to Niagawan by an on-prem NAS scraper.

---

## 2. The architecture in one picture
```
 Staff/Owner ── Next.js app (Vercel) ──RPC──▶ Supabase Postgres  ◀──┐
    (browser)        src/app/**                (129 public tables,   │
                     src/components/**          logic lives in        │
                     src/lib/**                 SECURITY DEFINER fns)  │
                          │                          ▲                 │
                    /api/* routes (Node)             │ x-ingest-token  │
                          │ web push / dispatch      │                 │
                          ▼                    Supabase Edge Fns  ◀─────┤ scrapes
                   push_subscriptions          (niagawan-ingest, …)     │
                                                     ▲                   │
   pg_cron + pg_net ──http──▶ /api routes           │           Synology NAS (192.168.1.3)
   (schedules) └──▶ Google Apps Script (email)      └── sync_requests ── Niagawan scraper
                                                          (job queue)     (s3.niagawan.com)
```
**The one big idea:** the frontend is thin. Almost all business logic + authorization lives in
**Postgres `SECURITY DEFINER` functions (RPCs)** that the app calls with `supabase.rpc(...)`.
Read the SQL functions, not just the React, to understand the system.

---

## 3. How to explore (first commands)
- List tables: `list_tables` (schemas `public` and `att_v2`).
- Read a function's real definition: `select pg_get_functiondef('public.<name>(<argtypes>)'::regprocedure);`
- List all functions in a domain: `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname ilike '%bnpl%';`
- List edge functions + cron: `list_edge_functions`; `select jobname, schedule, command from cron.job;`
- In the repo: start with `src/components/NavBar.tsx` (the whole app's map + role gating), then open one page end-to-end.

---

## 4. The domain map (where each thing lives)
Skim these groupings, then deep-read the 2–3 most relevant to your new app.

| Domain | Key tables | Key pages (`src/app/…`) | Notes |
|---|---|---|---|
| **Auth / RBAC** | `staff`, `staff_allowlist`, `position_access`, `config`, `app_secrets` | `login`, `settings` | The security model — study first (see §5.1). |
| **Attendance & leave** | `att_v2.daily`, `att_v2.events`, `time_entries`, `day_status/half/time_override`, `offday_/halfday_/mc_/advance_requests`, `emergency_absences`, `public_holidays`, `leave_settings` | `attendance/*`, `checkin` | `att_v2.daily` is the live source of truth (legacy `attendance` table is stale). |
| **Payroll** | `payroll_items/periods`, `salary_profiles`, `salary_paid`, `eis_/socso_brackets`, `grab_meals`, `payslip_email_log` | `payroll/*` | Malaysian EPF/SOCSO/EIS logic. |
| **Workshop board** | `job_cards`, `intake_requests`, `workshop_settings`, `memos`, `bookings` | `workshop`, `workshop/needs-mechanic`, `intake`, `add-part` | Cards created at check-in; RPCs `queue_intake`, `board_card_phones`, `close_paid_job_cards`. |
| **Niagawan POS mirror** | `niagawan_*` (`daily`, `sale_inv`, `cash_daily/entries/count`, `invoice_cogs`, `customers`, `products`, `inventory`, `suppliers`, `outstanding`, …), `stg_nia_*` (staging), `sync_requests`, `automation_tasks`, `mail_suppliers` | `niagawan/*` | Scraper-fed read-mirror of Niagawan (see §5.3/5.4). |
| **Cash / P&L / month-end** | `niagawan_cash_*`, `opex_bills`, `pnl_settings`, `petty_cash_*`, `office_daily_tasks`, `month_end_tasks`, `cash_entry_checked` | `niagawan/pnl`, `office/daily`, `cash-count`, `bank-recon`, `month-end` | |
| **Staff sales / commission** | `sales_staff_map`, `niagawan_sale_inv`, `niagawan_invoice_cogs` | `niagawan/staff-sales` | Per-mechanic gross-profit commission. |
| **BNPL (ATOME)** | `bnpl_providers/settlements/payouts/settle_matches` | `office/bnpl`, `office/bnpl/[provider]` | Receivables + bank reconciliation. |
| **Inventory & purchasing** | `pinv`, `pinv_item`, `po_suggestions`, `inventory_po_group(s/_items/_lines)`, `manual_/one_off_/recurring_items` | `niagawan/purchase`, `niagawan/inventory-v4`, `niagawan/cogs` | Purchase-invoice OCR + auto-PO. |
| **Notifications** | `notification_prefs`, `notification_dismissed`, `push_prefs`, `push_subscriptions`, `pushed_notifications` | `settings`, `api/push/dispatch` | Push + bell + email (see §5.6). |
| **🛒 E-commerce / trading (`ecom_*`)** | ~45 tables: `ecom_orders/order_lines`, `ecom_quotes`, `ecom_purchases/purchase_orders`, `ecom_products`, `ecom_suppliers`, `ecom_customers`, `ecom_stock_takes/moves/transfers`, `ecom_expenses`, `ecom_sales_docs`, `ecom_period_locks`, `ecom_doc_sequences`, `ecom_audit_log`, `ecom_managers`, `ecom_settings`, `ecom_vehicles` | (find routes via NavBar / grep `ecom_`) | **A near-complete commerce+accounting sub-app.** If your new app is commerce/inventory/accounting, this is the most relevant part — study it deeply. |

---

## 5. The patterns worth learning (the real point of the study)
These are the reusable ideas. For each, read the named code.

**5.1 Role-based access via `can_access` + `position_access` (not raw RLS).**
Every sensitive RPC starts with `if not public.can_access('<feature>') then …`. Features map to job
positions in `position_access`. Read `pg_get_functiondef` for `can_access` and `is_admin`, and
`select * from position_access`. This is how they do feature-level authz centrally.

**5.2 RPC-first / logic-in-Postgres.**
The UI mostly calls `supabase.rpc('name', {args})`; the RPC (SECURITY DEFINER) does the auth + joins +
computation and returns JSON. To understand a feature, read its RPC. Good examples to read:
`notification_feed`, `bnpl_overview`, `staff_sales_report`, `board_card_phones`, `clerk_cash_entries`.

**5.3 External sync via a job queue (`sync_requests`).**
The website inserts a row into `sync_requests` (`which`, `from_date`, `to_date`, `source`); the NAS
poller claims it, scrapes Niagawan, writes results + `status`/`finished_at`. `automation_tasks` holds
the schedule config the NAS engine reads (e.g. `nightly_sync` at 20:30, 7-day window). Study both
tables + recent rows: `select * from sync_requests order by created_at desc limit 20;`.

**5.4 Scraper → edge-function ingest.**
The NAS posts scraped data to Supabase **edge functions** (`niagawan-ingest`, `niagawan-inventory`,
`niagawan-autopo`, `niagawan-pinv`) authenticated by a shared token in `app_secrets`
(`niagawan_ingest_token`), with `verify_jwt=false`. `list_edge_functions` to see them; the ingest fn
upserts into the `niagawan_*` mirror tables. This is their pattern for pulling a 3rd-party system with
no API into Postgres.

**5.5 Scheduling with `pg_cron` + `pg_net`.**
In-DB cron drives recurring work: `select jobname, schedule, command from cron.job;`. Jobs `net.http_post`
to Vercel `/api/*` routes or to a Google Apps Script. Examples: `push-dispatch` (every minute),
`owner-digest` (nightly). Responses land in `net._http_response` (useful for debugging).

**5.6 Notifications pipeline (push + bell + email).**
Source functions build JSON items → `push_pending()` (phone; only items <20 min old, deduped via
`pushed_notifications`) and `notification_feed()` (in-app bell; role-branched, respects
`notification_dismissed`). A Vercel route `/api/push/dispatch` (pg_cron-driven) sends Web Push (VAPID
keys in `app_secrets`) to `push_subscriptions`. Email goes out via `notify_owner()` → `pg_net` →
a Google Apps Script mailer. Read `notification_feed`, `push_pending`, and
`src/app/api/push/dispatch/route.ts` + `src/lib/pushServer.ts`.

**5.7 Secrets live in a table, not just env.**
`app_secrets(name, value)` holds tokens/keys read by SECURITY DEFINER fns and edge fns (`vapid_*`,
`notify_url`/`notify_token`, `niagawan_ingest_token`). (Values are secret — don't print them; just
learn the pattern.)

**5.8 UI conventions.**
Semantic **design tokens** (an "Apple-clean" palette via CSS variables), *not* raw Tailwind palette
colors — this keeps dark mode correct. See `tailwind.config` / `src/app/globals.css` and
`src/components/*`. Also note the shared shells (e.g. `OfficeShell`) and the `Icon` set.

**5.9 Deploy discipline (how changes ship).**
App: `npx tsc --noEmit` gate → branch from `origin/main` → PR → Vercel check → squash-merge → confirm
main is green. DB: Supabase migrations (`apply_migration`). Worth mirroring in your new app.

---

## 6. Suggested study order (a checklist)
1. Repo root: read `CLAUDE.md` / `README` if present.
2. `src/components/NavBar.tsx` — the whole feature map + who-sees-what.
3. `list_tables`; skim the §4 groupings against the real list.
4. RBAC: read `can_access`, `is_admin`, `position_access` (§5.1).
5. Pick ONE page and trace it end-to-end: page → `supabase.rpc(...)` → `pg_get_functiondef` of that RPC. Good candidates: `src/app/office/daily/page.tsx` or `src/app/workshop/page.tsx`.
6. Read the notification pipeline (§5.6) — it touches DB + cron + a Vercel route + email, so it's a compact tour of the whole stack.
7. Read the Niagawan sync path (§5.3–5.4): `sync_requests`, `automation_tasks`, `list_edge_functions`.
8. If your new app is commerce/inventory/accounting: deep-dive the **`ecom_*`** module (§4) — grep `ecom_` in the repo for its pages/RPCs, and read its tables + doc-sequence / period-lock / audit-log patterns.

---

## 7. Gotchas & things not to trust blindly
- **Data is messy in real ways.** Customer "name" fields often embed the car plate (e.g. `"MYVI WC853P"`); there are duplicate/typo'd records and near-duplicate plates. Don't assume clean, normalized data.
- **`att_v2.daily` is current; the old `attendance` table is stale.** Prefer the `_v2` / newest-named object when several exist (there are v2/v3/v4 iterations of some features).
- **Logic is in SQL, not the UI.** Reading only React will mislead you — always check the RPC.
- **This system changes often.** Treat *this document* as a starting map, and verify specifics against the live DB/repo before relying on them.

---

## 8. Quick-reference (copy these)
- Supabase project ref: **`naefauflkisldxftxuhq`** (schemas: `public`, `att_v2`)
- Repo: **`muammarhafiz/attendance-web`** (`C:\Users\muamm\attendance-web`), Next.js App Router + TS + Tailwind, Vercel
- Edge functions: `niagawan-ingest`, `niagawan-inventory`, `niagawan-autopo`, `niagawan-pinv` (confirm with `list_edge_functions`)
- On-prem: Synology NAS `192.168.1.3` runs the Niagawan scraper + `sync_requests` poller
- ~129 `public` tables; business logic in `SECURITY DEFINER` RPCs gated by `can_access(feature)`
