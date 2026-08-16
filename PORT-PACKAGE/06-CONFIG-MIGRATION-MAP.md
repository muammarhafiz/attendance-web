# ZORDAQ Port — Config Migration Map

Config is the classic thing that gets **half-migrated and then fails silently weeks later** — because it
lives in two stores (Vercel/host **env vars** and the **`public.app_secrets`** DB table), and some items
exist in **both** with different consumers. This is the whole surface: **5 env vars + 9 `app_secrets`
rows = 14 config values.** Migrate every row deliberately; don't assume "the env file covers it."

**Legend for "Regenerates?"** — 🔁 the value **changes** on the new stack (must be re-captured, not
copied); ➡️ the value is **carried over intact**; ⚙️ carried, but its meaning is a *shared secret* both
ends must agree on.

| # | Config item | Store (now) | Read by | Regenerates? | Must end up (ZORDAQ) |
|---|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | env | browser + all server Supabase clients | 🔁 | env → `<NAS_API>` |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | env | browser client | 🔁 new JWT secret → new anon key | env → new anon key |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | env | ≈9 server routes **+ 4 edge fns** (`Deno.env`) | 🔁 new JWT secret → new service_role key | env (app) **and** each edge fn's env |
| 4 | `NOTIFY_URL` | env | `/api/payroll/send-payslips` (payslip mailer) | ➡️ (or re-point to a ZORDAQ mailer) | env |
| 5 | `NOTIFY_TOKEN` | env | `/api/payroll/send-payslips` | ➡️ | env |
| 6 | `app_base_url` | `app_secrets` | **pg_cron `push-dispatch`** builds `…/api/push/dispatch` from it | 🔁 must become the NAS app URL | **`app_secrets` row** (NOT an env file) → `<ZORDAQ_APP>` |
| 7 | `push_dispatch_token` | `app_secrets` | pg_cron push job **and** `/api/push/dispatch` (both ends) | ⚙️ both ends must match | `app_secrets` + the dispatch route |
| 8 | `vapid_public` | `app_secrets` | `push_public_key()`, dispatch, PushToggle client | ➡️ **carry intact** | `app_secrets` |
| 9 | `vapid_private` | `app_secrets` | web-push signing in `/api/push/dispatch` | ➡️ **carry intact** (regenerating invalidates every existing browser subscription) | `app_secrets` |
| 10 | `vapid_subject` | `app_secrets` | web-push VAPID subject (`mailto:zordaqputrajaya@gmail.com`) | ➡️ | `app_secrets` |
| 11 | `gemini_key` | `app_secrets` | `/api/pinv/extract` → Google Gemini OCR | ➡️ (Google API key) | `app_secrets` |
| 12 | `niagawan_ingest_token` | `app_secrets` | the 4 edge fns + `/api/bnpl/ingest` + `/api/pinv/extract` | ⚙️ or **retire** with the ingestion layer (04) | `app_secrets` **only if** OCR/ingestion kept |
| 13 | `notify_url` | `app_secrets` | **`notify_owner()`** (DB, via `net.http_post`) → the digest/payslip **email** relay | ➡️ (Apps Script Web App URL) | `app_secrets` |
| 14 | `notify_token` | `app_secrets` | `notify_owner()` auth for the same relay | ➡️ | `app_secrets` |

## The trap in one place: rows 4/5 vs 13/14 — `notify_url` / `notify_token` live in BOTH stores
There are **two** copies of the notify credentials, with **different consumers**:
- **`NOTIFY_URL` / `NOTIFY_TOKEN` (env, rows 4/5)** are read **only by the app** (the payslip mailer route). Grep confirms the Next app reads these from `process.env` and *never* as `app_secrets` names.
- **`notify_url` / `notify_token` (`app_secrets`, rows 13/14)** are read **only by the database** — `notify_owner()` (owner digest + new-request alerts) and potentially the edge/NAS layer — never by the app.

**Failure mode:** migrate only the env vars → the app's payslip email works but the **owner digest email
goes silent**. Migrate only the DB rows → the digest works but **payslip emails fail**. Both breakages
are invisible (`net.http_post` is fire-and-forget; the app route swallows errors). **Migrate all four,
and if you consolidate onto one mailer, update all four to point at it.**

## Two more easy-to-miss shapes
- **Row 6 (`app_base_url`) is DB-driven.** The push cron reads the target host from `app_secrets`, not an
  env file. If you update only the app's env and forget this row, push dispatch keeps POSTing to the old
  Vercel host. Update it **in the database**.
- **Rows 2/3 (anon + service_role) regenerate.** `SECRETS-EXPECTED.md` lists them as "get from the
  dashboard," which reads like copy-paste; on self-hosted they are **new values derived from the new JWT
  secret** — see `03-DEPENDENCY-WARNINGS.md` §A3. The app **and all 4 edge functions** consume the
  service_role key.

## Values are NOT in this repo
This map lists names, stores, and consumers only. The actual secret values live in the live project's
dashboard / `app_secrets` table / your password manager and are **never** committed (see
`SECRETS-EXPECTED.md`). Carry the values across out-of-band.
