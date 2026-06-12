# CLAUDE.md — ZORDAQ Workshop Admin (attendance-web)

Admin web app for **ZORDAQ AUTO SERVICES** (car workshop, Putrajaya, Malaysia). One non-technical owner uses it daily — favour simple, self-explanatory UI text over jargon. Money is RM, dates display as dd/mm/yyyy, timezone Asia/Kuala_Lumpur.

## Stack & deploy

- Next.js App Router + TypeScript + Tailwind, deployed on **Vercel**.
- **Merging a PR to `main` deploys to production** (~1 min). There is no staging. Keep PRs small and type-check first: `npm install` (fresh containers have no node_modules), then `npx tsc --noEmit`. If the type-check can't run, say so before merging — Vercel's build will catch type errors and refuse to deploy, but then the merge sits broken on main.
- Database/auth: **Supabase** (project `naefauflkisldxftxuhq`). Client pages use `@/lib/supabaseClient`; admin-only pages gate on the `is_admin()` RPC. RLS is enforced — admin policies typically `using is_admin()`.
- Supabase **edge functions** (`niagawan-pinv`, `niagawan-ingest`, `niagawan-autopo`, `niagawan-inventory`) use shared-token auth checked against the `app_secrets` table (service-role only). They are deployed with `verify_jwt:false` — never flip that on or the NAS gets 401s. Tokens live in `app_secrets` and server-side code only; **never put tokens in client code or this file**.

## What talks to what (the parts NOT in this repo)

1. **Synology NAS** (always-on, on the workshop LAN) runs a headless Node scraper that logs into **Niagawan** (the accounting SaaS, `s3.niagawan.com`) and executes jobs. The website never talks to Niagawan directly.
2. The website queues work by inserting into **`sync_requests`** (`which` = `all` | `sales` | `cogs` | `inventory` | `autopo` | `email-check` | `kiv` | `kiv-dry` | `kiv-partial`, plus `from_date`/`to_date`/`categories`). The NAS polls every ~20s, runs the job, writes `status`/`result` back. UI buttons poll that row.
3. A **Google Apps Script** on the workshop Gmail (zordaqputrajaya@) fetches supplier invoice PDFs every 15 min, files them into Drive (`DOWNLOAD - SHARED/<supplier>`), and POSTs invoice PDFs to the `niagawan-pinv` edge fn (`pinvUpload`) so they appear on the Purchase Invoice page already AI-read.

A cloud/web Claude session **can** edit this repo and open PRs. It **cannot** reach the NAS, the Apps Script, Niagawan, or run Supabase migrations. For schema changes, write the SQL in the PR description for the owner/desktop session to apply.

## Main areas (`src/app/`)

- `niagawan/` — the workshop admin: **Sales** (daily totals, Sync now), **COGS** (zero-cost chase list + ignore rules), **Inventory** (reorder list, min-stock watchlist, auto-PO drafts + approval), **Purchase Invoice** (AI-read pipeline below), **KIV Invoices** (carry-forward + partial trackers), **Settings** (automation_tasks schedules).
- `api/pinv/extract/route.ts` — the AI invoice reader (Gemini; primary model with backup tier on overload, `read_model` recorded). Auth: admin Bearer JWT **or** `x-ingest-token` header (shared ingest token, for the email bot).
- Attendance + payroll pages (GPS check-in, Malaysian payroll `pay_v2`). Be careful here: payslip data is private per employee; RLS fixes have history — don't loosen policies.

## Purchase-invoice pipeline (most-touched feature)

`pinv` row statuses: `uploaded → extracting → extracted → approved → creating → created`, plus `error` and `dismissed` (hidden from list; "Show dismissed" + Restore). Flow:

1. PDF arrives (manual upload or email bot) → storage bucket `pinv` + `pinv` row.
2. **Read** (extract route): digital PDFs only — scanned/photo PDFs are rejected (no text layer). Every extracted code is verified against the PDF's own text (`code_verified`; false ⇒ red flag in Review). Per-line discount % is derived from the printed net amount. **Gulf/Atomlubes invoices print no item codes** — uncoded lines are auto-matched by description (oil grade + bottle size + name words) against `niagawan_min_stock` (supplier ilike %atomlubes%); free "GULF MILEAGE STICKER" RM0 lines stay uncoded for the owner to remove at review.
3. On read: `resolve_status='queued'` (NAS looks up each code in Niagawan → `in_niagawan`, `niagawan_category`) and `check_status='queued'` (sales-check: was each item billed on a sale invoice ±7 days → `sold_status` found/check/not_found).
4. **Duplicate guard**: NAS checks ref# + D/O against Niagawan (`dup_pi_no` ⇒ warning banner); approve also refuses to create a duplicate.
5. **Approve** → NAS creates the Purchase Invoice in Niagawan (existing items added; unknown codes created as new products in the chosen category) → `niagawan_pi_no` shown.

## Niagawan gotchas (learned the hard way)

- `updateSale` DOES accept a future sale date (proven 2026-06-12 on a dummy invoice — an earlier belief that future dates corrupt invoices was a misdiagnosis of manual re-dating). The KIV carry-forward runs **evenings at 20:00**: today's unpaid → next working day (Saturday's → Monday), then re-syncs the affected days. A 7-days-ahead cap guards against typos on manual runs.
- `deliverDO` with an empty ship date sets it to **today**.
- The KIV "delivered" date = the date the workshop received the car, not the invoice date.
- Only **unpaid** invoices are carried forward (partials are tracked separately on the KIV page, scanned nightly per year).

## Conventions

- Match existing code style: client components with `useCallback`/`useState`, plain Tailwind classes, small helper fns in-file. Tables follow the existing list-page pattern.
- User-facing copy: short, plain English, no developer jargon (the owner reads it).
- Status pills use the `STATUS_STYLE` maps; add new statuses there AND to the `pinv_status_check` DB constraint (via migration).
- Commits/PRs: descriptive title, body explains the *why*; merging = deploying, so verify type-check before merge.
