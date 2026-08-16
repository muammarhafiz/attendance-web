# ZORDAQ Port — Dependency Warnings (read this first)

The exhaustive, pessimistic list of things that **do not survive a naive move** to self-hosted Supabase
+ a NAS Node runtime. Most entries are checked against the **live** database (2026-08-16); some — the
off-platform pieces and anything tagged `CONFIRM`/`UNRESOLVED` — could not be, and say so. Where a
widely-assumed risk turns out to be a non-issue, that's called out too — knowing what *not* to spend
December on is as valuable as the landmines.

> ## ⚠ Before you trust this document — what you must NOT assume
> A dependency-warnings list is read by someone under time pressure who *wants* it to be complete. It is
> not, and the honest thing is to say where it is soft — that's more useful than another warning:
> - **Two sessions wrote this; neither could see the whole system.** One had the live database + repo but
>   not the NAS, Google Cloud, or the Apps Script internals; the other read the repo from the outside with
>   no live access. Anything off-platform (the NAS engine, the Apps Script triggers, GoTrue/Google-OAuth
>   config) is inference or second-hand observation — not something this document *proved*.
> - **At least three load-bearing claims here were WRONG on first pass**, and were caught only because
>   they were checked from the other side. Treat that as a reason to distrust the *unchecked* claims too:
>   1. "≈210 RLS policies key off `auth.uid()` → preserve the UUIDs" — **wrong.** Authz is **email-keyed**
>      (only 2 of 210 policies touch `auth.uid()`); protect the exact `staff.email` + the JWT email claim,
>      not the UUIDs. (§A2)
>   2. "Emailed payslips break on JWT rotation (signed URLs)" — **wrong.** They're base64 attachments; no
>      signed URL is ever sent externally. A non-issue. (§D1)
>   3. "Three Apps Script triggers, including a GrabFood one" — **wrong.** There are **two**; GrabFood has
>      no trigger of its own. (§B, Scheduler 3)
> - **Anything tagged `CONFIRM` or `UNRESOLVED` has been verified by NO ONE.** It is a flagged open
>   question, not a finding — do not act on it as settled. Resolve it, then remove the tag.
> - **Point-in-time snapshot (2026-08-16).** The live system keeps changing; re-check before cutover.

**Severity legend**
- 🔴 **TOTAL FAILURE** — nobody can use the system, or every API call fails.
- 🟠 **SILENT STOPPAGE** — a subsystem stops working and raises no error anywhere.
- 🟡 **CORRECTNESS / DATA** — wrong results, or data that must be carried a specific way.
- ⚪ **OPERATIONAL** — grows unbounded / needs a housekeeping job; not correctness.

---

## A. Auth & access — the highest-severity layer, and the most mis-framed

### A1. 🔴 Google OAuth provider config in self-hosted GoTrue — the login gate for every human
**This is the single biggest total-failure-if-missed item, and it is absent from every artifact
(01/02/04, `db/infra.sql`, `SECRETS-EXPECTED.md`).** 100% of human sign-in is Google OAuth.

- Evidence (live + repo): `auth.identities` = 21 google + 2 email; `auth.sso_providers` = 0,
  `saml_providers` = 0, `mfa_factors` = 0; `src/app/login/page.tsx:10` has exactly one auth call,
  `signInWithOAuth({provider:'google'})`; no password/OTP/magic-link UI exists.
- Why it breaks: self-hosted GoTrue on the NAS must be configured with `GOTRUE_EXTERNAL_GOOGLE_ENABLED`
  + client id/secret, the NAS `SITE_URL`, and the redirect allow-list — **and** the Google Cloud OAuth
  client must have the NAS callback (e.g. `https://api.zordaq.com/auth/v1/callback`) added to its
  Authorized redirect URIs. This config lives only in GoTrue's own environment — invisible to both a
  repo read and a DB dump.
- If missed: nobody can log in, and the safety-critical fallback (attendance + payroll) is completely
  inaccessible on day one.
- **Action:** treat GoTrue Google-OAuth config as **step 0.1**, right after the auth spine. Add the NAS
  callback URL to the existing Google Cloud OAuth client (don't create a new client unless you must).

### A2. 🟡 The identity key is EMAIL, not the auth UUID — Cowork's headline claim is inverted
The outside-in analysis said "~210 RLS policies key off `auth.uid()`, so UUIDs must be preserved." The
live DB refutes the mechanism, though not the conclusion-to-be-careful:

- **Only 2 of 210 policies reference `auth.uid()` at all** (`open_invoices_today`, `queue_add_item` —
  peripheral `created_by` logic, not the staff gate).
- The entire authorization model resolves identity **by email**: the SECURITY DEFINER helpers
  `is_admin()` (~77 policy predicates), `can_access(...)` (~22), `ecom_can_manage()` (23),
  `ecom_sees_cost()` (12), `is_board_writer()` all join `staff`/`ecom_managers` on **`lower(email)`**
  against `auth.email()` / `auth.jwt()->>'email'`.
- **Zero** application tables have a foreign key to `auth.users.id` — only auth-internal tables
  (sessions/identities/mfa/webauthn) do. `public.staff` = 18 rows, each a distinct lowercased email.
- **Consequence (the correct framing):** if UUIDs change but **emails stay byte-identical**, RLS and all
  authz keep working. If an **email** changes, everything for that user breaks. So the real
  total-failure item is **preserving exact `staff.email` strings AND ensuring migrated GoTrue emits the
  `email` claim in the JWT** at the path the helpers read (`auth.jwt()->>'email'`). Verify the OIDC
  email claim survives on self-hosted GoTrue.
- Preserving UUIDs is still worthwhile *hygiene* (auth-internal FK integrity, the 2 owner password
  accounts, the 2 stray `auth.uid()` functions) — just not the load-bearing reason.

### A3. 🔴 A new JWT secret regenerates the anon + service_role API keys
Self-hosted issues its own JWT secret, so `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` **change**. Every consumer of the old values must be repointed: the browser
client, ~9 server routes, and all 4 edge functions (they read `SUPABASE_SERVICE_ROLE_KEY` via
`Deno.env`). `SECRETS-EXPECTED.md` lists these names but frames them as "get from the dashboard" — it
does **not** flag that the values regenerate. Miss it and every PostgREST/edge call `401`s — total app
failure independent of any RLS logic.

### A4. 🟡 The 2 owner password accounts must be carried in `auth.users`
`muammarhafiz@gmail.com` and `muammarhafiz@live.com.my` have real `encrypted_password` values. A fresh
GoTrue recreates **Google** users lazily on first login, but will **not** recreate password logins —
`auth.users` rows for these must be migrated (or the passwords reset) or owner password sign-in is lost.
(All other 21 identities are Google and self-heal on first login; staff who never signed in have no
`auth.users` row yet — expected, not data loss.)

### A5. 🟡 Cluster-global role `fdw_attendance` + 144 grants — dropped twice by the documented backup path
`pg_roles` shows exactly one non-standard role: **`fdw_attendance`** (login-enabled, owns nothing),
holding **SELECT on 144 public tables** — a dedicated read-only external consumer.

- The backup command in `BACKUP-NOTES.md` is `pg_dump --schema-only --no-owner --no-privileges`:
  `--no-privileges` strips **all** grants, and `pg_dump` **never** emits role definitions (roles are
  cluster-global — only `pg_dumpall --roles-only` captures them). So both the role and its 144 grants
  vanish silently on rebuild, and whatever reads via `fdw_attendance` breaks with no error.
- **Blunt caveat:** the role is **not** connected in the current `pg_stat_activity` snapshot, so it may
  be a stale artifact of the retiring NAS integration. **Determine before cutover** whether anything
  still logs in as `fdw_attendance`; if yes, capture it with `pg_dumpall --roles-only` and re-grant; if
  no, drop it. Do not silently lose it.

---

## B. Scheduling & off-platform automation — the understated "extension"

### B1. 🟠 pg_cron + pg_net are not enabled by default on self-hosted → push, digest, and nightly refresh stop silently
Live proof the three jobs are real and healthy: `push-dispatch` (every 60s) ran **1440/1440** in the
last 24h with 0 failures; `owner-digest` 12/12; `daily-customers-refresh` 1/1. Extensions `pg_net`
0.19.5 + `pg_cron` 1.6.4 are installed and active.

Corrections to the outside-in version of this claim:
- There are **two** `net.http_post` paths, not one: `push-dispatch` → the Vercel app (push), and
  `notify_owner()` → a **Google Apps Script** webhook (the digest/payslip **email**). Both die without
  pg_net.
- The silent-stoppage set is **larger than "push + digest"**: `daily-customers-refresh` needs pg_cron
  only (it just inserts a `sync_requests` row) and also stops, breaking the overnight customer refresh.
- "Silently" is doubly true: `net.http_post` is fire-and-forget (never raises on HTTP failure),
  `/api/push/dispatch` swallows errors and never writes `last_ok_at`, and `build_owner_digest()` returns
  a quiet "skipped" — so failures are invisible **even where the extensions exist**.
- **Action:** on the NAS Postgres, `CREATE EXTENSION pg_cron` (needs `shared_preload_libraries` +
  `cron.database_name` in `postgresql.conf` — not just `CREATE EXTENSION`) and `pg_net`, then recreate
  the 3 jobs from `db/infra.sql`, and add a real health signal (`last_ok_at`) so a future outage is loud.

### B2. 🟠 THE THREE SCHEDULERS — pg_cron is only one; the other two are invisible to BOTH the repo and the database
**This is the section to read twice.** Neither session's audit, nor the owner's own mental model, had
these on any list — because they leave **no footprint in the repo or the schema**. The only proof they
exist is the *side-effects* they write into DB tables. They are the classic thing discovered in January
when "meals stopped being recorded and nobody knows why." Enabling pg_cron/pg_net restores **only** the 3
DB jobs; the other two schedulers must be separately re-homed or re-pointed, or the feature silently dies.

**Scheduler 1 — Supabase pg_cron (the only DB-visible one).** 3 jobs; see §B1. Restored by enabling
pg_cron + pg_net on the NAS.

**Scheduler 2 — the NAS automation engine (Synology, workshop LAN).** Polling loops, *not* cron:

| Loop | Cadence | Drives | Live evidence it's alive |
|---|---|---|---|
| Niagawan on-demand poller | ~20s | drains `sync_requests` (intake, cash-count, add-part, customers) | `sync_requests`: 46 done `customers/pg_cron-daily` rows, latest completed **last night 22:00 UTC** |
| schedule-checker | ~60s | executes `automation_tasks` config | live `automation_tasks`: `hourly_sync` 09:30–19:00 **ON**, `kiv_move` 20:00 **ON**, `kiv_partial` 20:45 **ON**, `nightly_sync` 20:30 **ON**, `auto_po` Mon 08:00 **OFF** |

> **Key correction:** the "hourly BNPL/payment sync" is driven by this NAS engine (`automation_tasks`),
> **NOT pg_cron** — enabling pg_cron does *not* bring it back. The NAS engine must be re-homed onto/beside
> ZORDAQ and its `automation_tasks` re-pointed at native tables.

**Scheduler 3 — Google Apps Script.** **Observed directly in the Apps Script console, 2026-08-16** (facts
below are seen, not inferred):
- **One project only:** "ZORDAQ Workshop Email Automation" — created 11 Jun 2026, last modified 2 Aug
  2026, status **Deployed, Version 15**.
- **Owner:** `zordaqputrajaya@gmail.com` (display name MUAMMARHAFIZ ZAINAL) — i.e. the **workshop
  Gmail**, not a personal account.
- **Exactly TWO time-based triggers** (not three):

| Function (trigger) | Type | Drives | Health (observed 2026-08-16) |
|---|---|---|---|
| `checkInvoices` | time-based | supplier-invoice pipeline: Gmail→Drive→`niagawan-pinv` `pinvUpload` | ⚠ **failing/degrading — see §B3** |
| `importAtomeSettlements` | time-based | ATOME BNPL settlements → `/api/bnpl/ingest` | ✅ 0% errors, sub-second |

- **❓ UNRESOLVED — how the GrabFood meal parser is invoked.** *(This is an open question, not a finding.
  Two facts are settled; one is genuinely unknown — do not let a future reader collapse them into "solved.")*
  - **Settled:** GrabFood has **no trigger of its own** (only the two triggers above exist), and the only
    footprint in this repo is the **receiver** `niagawan-ingest` action `grabMeals` (batch upsert into
    `grab_meals`, deduped by `order_code`).
  - **UNRESOLVED:** the repo has the endpoint, not the caller, so it **cannot be told from here** *which*
    function posts it — **most plausibly folded inside `checkInvoices`** (the mailbox scanner), **but this
    is a guess, not a verified fact.** ⚠ Do **not** read "most plausibly" as settled.
  - **To resolve (≈30s for whoever is in the editor):** search the Apps Script project for the function
    that posts `grabMeals`, then replace this block with what you find. Until then it stays UNRESOLVED.
- **The mailer (`notify_url`) is a Web App deployment, not a trigger** — a push target that
  `notify_owner()` POSTs to; it has no timer.

**Five OAuth scopes on the project = its blast radius** (record these; two are total access):
`script.scriptapp` (run while the user is away) · `script.send_mail` (send email as the user) ·
`script.external_request` (call external services) · **`auth/drive`** (see, edit, create and **DELETE
ALL** Drive files) · **`mail.google.com`** (read, compose, send and **PERMANENTLY DELETE all** mail).
The last two grant complete control of that mailbox and Drive.

> **🚌 Bus-factor — downgraded, not cleared.** Good news from the direct look: it's a **shared company
> mailbox** (`zordaqputrajaya@`), not someone's personal account — materially better than feared. But it
> is still (a) a **free Gmail, not a Workspace identity** (no admin console, no central recovery, no
> off-boarding controls), (b) a **single account** whose password/2FA is the single point of failure for
> supplier-invoice intake **and** BNPL settlement import, and (c) holding **permanent-delete scope over
> all mail and Drive**. The project shows as **shared with one other person — identity not checked
> (CONFIRM** by opening the sharing dialog). Standing hygiene, independent of the port: move to a
> Workspace identity if possible, confirm the second collaborator, and ensure recovery/2FA is controlled
> by the business, not one individual.

**Negative findings (so nobody wastes time hunting for what isn't there):**
- **No Gmail Pub/Sub** — the invoice pipeline runs on a *time* trigger (`checkInvoices`), not a Gmail push/watch subscription.
- **No Vercel cron** — `vercel.json` is absent everywhere; Vercel is only the *receiver* of the pg_cron POST, never a scheduler.
- **No other in-app schedulers** — no `setInterval`/cron in server code; the app schedules nothing itself.
- **No third Apps Script trigger** — the GrabFood meal parser has no trigger of its own (see Scheduler 3).

### B3. 🟠→🔴 LIVE DEFECT (has a clock): `checkInvoices` is degrading toward silent failure of supplier-invoice intake
Not a port item — a **currently-live** problem, observed in the Apps Script console 2026-08-16. Recorded
here because it **gets worse on its own**, which turns it from a nice-to-have into something time-boxed.

- **Error rate:** 7.55% over the last 7 days across **781 executions**; the trigger view attributes
  **9.74%** to `checkInvoices` specifically.
- **Two hard timeouts on 16 Aug** (13:18:55 and 13:48:55), both at **~360 s = the Apps Script 6-minute
  execution ceiling** — i.e. killed, not merely slow.
- **Run duration is climbing across the day:** 90 s → 118 s → 150 s → 176 s → 325 s → 360 s (killed).
  That trajectory means **per-run work is growing rather than bounded** — extrapolated, it will soon fail
  **every** run.
- **The failure is silent:** nothing surfaces an Apps Script error to the app, so when it tips over,
  supplier-invoice intake (`pinv`) simply **stops with no alarm**.
- **Contrast:** `importAtomeSettlements` is healthy — 0% errors, sub-second — so this is specific to
  `checkInvoices`, not the account or quota.
- **Likely shape (inferred, worth confirming in the script):** the run reprocesses a growing set each
  time (scanning all/unprocessed mail rather than a bounded window), so cost scales with mailbox size.
  **Fix direction when un-parked:** bound the work per run (process only the last N / unmarked, mark as
  done, paginate) so runtime stays flat. **Port implication:** if this pipeline is carried into ZORDAQ,
  re-implement with bounded work — do **not** port the unbounded pattern.
- **Status:** owner has **parked** it (2026-08-16). Written down with the trend so the clock is visible;
  not being fixed now.

---

## C. Extensions — schema placement will bite payroll inserts

### C1. 🟡 Extension schema mismatch — `db/infra.sql` (as written) can break `pay_v2` inserts
Live placement: `pgcrypto` and `uuid-ossp` live in the **`extensions`** schema; `earthdistance`, `cube`,
`pg_trgm` live in **`public`**. `db/infra.sql` currently creates them **unqualified**, which on a fresh
DB lands them in the current schema (usually `public`). `pay_v2.items.id DEFAULT uuid_generate_v4()` is
unqualified and `pay_v2` functions pin `search_path = public, pay_v2, extensions` — if `uuid-ossp` does
not end up on a schema in the insert session's search_path, **payroll-item inserts fail**.
- **Action:** pin `... WITH SCHEMA extensions` for `pgcrypto` and `uuid-ossp` to match live (this file's
  `infra.sql` has been corrected accordingly). Leave `earthdistance`/`cube`/`pg_trgm` in `public`.

### C2. 🟡 These extensions are genuinely load-bearing — the port cannot skip them
Verified against live function bodies, so nobody "optimizes them away":
- `earthdistance` + `cube` — the geofenced check-in (`distance_meters` / `ll_to_earth` / `earth_distance`,
  Cluster B). No geofence extension → check-in breaks.
- `pg_trgm` — **11 non-ecom** functions use `similarity()` (not ecom-only). Required even though the two
  `gin_trgm_ops` indexes are on excluded `ecom_*` tables.
- `uuid-ossp` — required by `pay_v2.items`.
- (Positive: all ~241 SECURITY DEFINER functions are owned by `postgres` with an explicit pinned
  `search_path`, so there is **no** search-path-injection portability landmine.)

---

## D. Storage — the size claim is right; the "breakage" claim is a non-issue; the real work is elsewhere

### D1. ✅ CORRECTION — no signed URL ever escapes the app, so a JWT-secret change breaks nothing user-facing
The outside-in claim ("payslips emailed to staff would break") is **factually wrong**:
- Emailed payslips are sent as a **base64 PDF attachment** (`storage.download()` in
  `send-payslips/route.ts`), **not** a signed URL. A secret change cannot touch them.
- Every `createSignedUrl` in the codebase is short-TTL (120s–3600s), generated **on demand** for in-app
  viewing (`my-payslip` 120s; records/finalize 3600s; mc/petty-cash/pinv 300s via `window.open`). They
  all simply re-sign under the new secret. **No persisted or emailed signed URL exists to break.**
- **Do not spend December on signed-URL re-signing — it's automatic.**

### D2. 🟡 The real storage work: physically copy 178 MiB and recreate buckets + policies in the right order
- Verified inventory: **178.13 MiB** across the four private buckets = `pinv` 140 MB (236 obj) + `mc`
  37 MB (14 obj) + `payroll` 0.58 MB (41 obj) + `petty-cash` **empty (0 obj)**. So it's really **three**
  data-bearing buckets; a public `product-photos` (5 obj, ecom/store) also exists.
- Buckets are created via the **Storage API**, not SQL (`infra.sql` documents them but can't `CREATE`
  them). The objects must be physically transferred to the NAS.
- **Ordering dependency:** the storage RLS policies reference `is_admin()`, `can_access('workshop')`, and
  `ecom_can_manage()` — those functions must exist **before** the storage policies will work. (Cluster A
  first, then storage.)
- Minor latent bug (unrelated to the port): `FinalizePayrollPanel.tsx` calls `getPublicUrl` on the
  **private** `payroll` bucket — produces non-working URLs regardless; worth fixing but not a migration
  concern.

---

## E. Edge functions & the Niagawan mirror

### E1. 🟡 `verify_jwt=false` on all 4 edge functions — token auth, not Supabase JWT
All 4 (`niagawan-ingest` v29, `niagawan-inventory` v9, `niagawan-autopo` v6, `niagawan-pinv` v19) run
with `verify_jwt=false` and authenticate via `app_secrets.niagawan_ingest_token`
(x-ingest-token header or body token). If self-hosted Edge Runtime is used, that per-function config must
be reproduced; otherwise these functions become open or broken. **But** per 00/04, the whole ingestion
layer is slated to **RETIRE** (ZORDAQ owns the POS) — so the correct move is usually *don't port them*,
not *reconfigure them*.

### E2. 🟡 One self-referential hardcoded host — `niagawan-pinv` → `attendancezp-web.vercel.app/api/pinv/extract`
The only hardcoded host that would **mis-route** after a move (confirmed the only one across all 4 edge
fns + the app). `esm.sh` (dependency CDN, all 4 fns) and `generativelanguage.googleapis.com` (Gemini,
keyed) are the only other external hosts. If the OCR pipeline is kept, re-point this to the NAS host;
if retired, moot.

### E3. 🟡 Do not silently keep any `niagawan_*` read — the dominant re-point risk
This is the theme of 00/04: many features read the mirror and will return **nothing** in ZORDAQ. `04`'s
re-point acceptance checklist is the list to tick before deleting the mirror.

---

## F. Config surface — 14 values across two stores, with a cross-store duplicate

### F1. 🟡 "Five env vars" undercounts the real config-migration surface
True surface = **5 process.env vars + 9 `app_secrets` DB rows = 14 values**. All 9 secret rows are
populated (lengths verified). Carry these over intact or the dependent feature dies:
- `gemini_key` (53-char Google Gemini key) → invoice OCR
- `vapid_public`/`vapid_private`/`vapid_subject` → web push
- `push_dispatch_token`, `app_base_url` → the push cron leg (**`app_base_url` is DB-driven — update the
  NAS base URL in the DB, not an env file**; push target URLs follow it)
- `niagawan_ingest_token` → edge fns / bnpl / pinv
- `notify_url`, `notify_token` → the email relay

### F2. 🟡 `notify_url` / `notify_token` exist in BOTH `process.env` AND `app_secrets` — and the app reads only env
The Next app reads `NOTIFY_URL`/`NOTIFY_TOKEN` from `process.env` only (0 hits as DB-secret names in the
app). The **DB** rows `notify_url`/`notify_token` are consumed by something **outside** the app repo
(the edge functions / NAS / `notify_owner()`). A port that migrates only the env vars, or only the table,
**silently breaks one notification path**. Migrate both.

---

## G. App-layer — "the easy half" is right about lock-in, wrong about integration burden

Every number the outside-in read stated is **confirmed** (19,289 src lines, 49 pages, 15 API routes;
no middleware, no edge runtime, no ISR, no realtime, no `@vercel/*`, all-nodejs). The framework *shape*
genuinely is easy to move — and the middleware-less, client-side-refresh auth is *easier* than a typical
`@supabase/ssr` middleware flow. The disagreement is with "easy half" as a **risk** statement:

- 🟡 **Heavy Node integrations bundled in the 15 routes**, each needing real end-to-end re-testing after
  the move (all framework-agnostic, so portable — the risk is test burden, not lock-in):
  - **Gemini OCR** with model fallback (`gemini-3.5-flash` → `2.5-flash`) in `pinv/extract`.
  - **In-app PDF generation** via `pdfkit` standalone build in `payroll/finalize` — with an `fs`-stub
    workaround (`payslipLogo.ts` must base64 the logo because the standalone build stubs `fs`).
  - **PDF parsing** via `unpdf` (`pinv/extract`, `bank/reconcile`); **xlsx parsing** (dynamic import) in
    `bnpl/ingest`.
  - **Web Push / PWA stack**: `public/sw.js`, `public/manifest.webmanifest`, `PushToggle` subscribe flow,
    web-push server lib, VAPID keys. Portable-but-fiddly — needs an HTTPS origin, correct VAPID keys, SW
    scope, and per-browser endpoint handling.
- ⚪ `maxDuration` caps on 3 routes (30/60/60s) are Vercel serverless config — they simply disappear on
  the NAS (no serverless timeout). Not a risk, just noise.

**Net:** "schema is 70–80% of the port" is plausible for *effort*, but the React half carries a
disproportionate share of the **config + external-service risk**. Budget real integration-testing time.

---

## H. Confirmed non-issues (so nobody wastes December on them)
- **Signed-URL re-signing** — automatic; nothing persisted/emitted (D1).
- **`supabase_vault`** — installed (v0.3.1) but **unused**: `vault.secrets` = 0 rows, 0 functions
  reference it; `app_secrets` is a plain table. Copy `app_secrets` rows as ordinary data (values excluded
  from any committed dump). Thread closed.
- **MFA / OTP / magic-link** — none exist (0 `mfa_factors`, 0 SSO/SAML, no OTP code). Nothing to migrate.
- **SECURITY DEFINER search-path injection** — none; all pinned. Safe.

## ⚪ Operational, post-cutover
- `net._http_response` (written by the every-60s push job) grows **unbounded** on self-hosted with no
  auto-prune — add a periodic cleanup job on the NAS.
- Housekeeping inconsistency to resolve: `BACKUP-NOTES.md §2` preserves `automation_tasks` (data-only
  dump) while `04-PORTING-ORDER.md` lists it under **Delete**. Both are defensible (keep the schedule
  config as a reference vs. retire the NAS engine) — pick one explicitly so it isn't accidentally both.

---

### The one-paragraph version for the December plan
The schema/logic ports cleanly (00/01/02/04 cover it), but the **highest-severity failures live outside
the schema** and outside this repo: **(1)** self-hosted GoTrue must be configured for Google OAuth with
the NAS callback registered in Google Cloud, or nobody logs in; **(2)** the new JWT secret regenerates
the anon/service_role keys — repoint every consumer or everything `401`s; **(3)** identity is keyed on
**email**, so preserve exact `staff.email` strings and the JWT email claim (UUID preservation is only
hygiene); **(4)** pg_cron/pg_net must be enabled *and* the two off-platform schedulers (NAS engine, Apps
Script triggers) re-homed, or push/digest/nightly-refresh/invoice-ingestion/BNPL-pull stop silently; and
**(5)** the `fdw_attendance` role + 144 grants must be consciously kept or dropped, not lost by the
`--no-privileges` dump. The much-feared signed-URL breakage is a non-issue.
