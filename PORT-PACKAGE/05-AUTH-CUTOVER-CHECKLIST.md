# ZORDAQ Auth Cutover Checklist — run this on the NAS in September, not on 1 January

> **The single most likely way December goes wrong is logging into a freshly built ZORDAQ and finding
> the Google sign-in button does not work.** This checklist proves it works — plus the two other
> total-failure items — while there is still time to fix them.

**When:** as soon as a NAS ZORDAQ Supabase stack exists with the schema + auth spine loaded (target:
September). **Not** a cutover-day task.
**How long:** an afternoon.
**How to use:** every line has an explicit **PASS/FAIL**. A line that can't be made to PASS is a
December risk you found in September. Fill the box (`[x]` pass, `[!]` fail) and note the result.
**Placeholders:** `<NAS_API>` = the NAS Supabase URL (e.g. `https://api.zordaq.com`); `<ZORDAQ_APP>` =
the ZORDAQ web app URL. Replace before running.

Cross-reference: `03-DEPENDENCY-WARNINGS.md` §A1 (OAuth), §A2 (email identity), §A3 (JWT keys), §A5 (role).

---

## Part 1 — Google OAuth end to end (the headline)
100% of human sign-in is Google OAuth; there is no password/OTP/magic-link fallback UI. If this fails,
nobody can log in.

- [ ] **1.1 — GoTrue has Google enabled.** On the NAS GoTrue/auth env, confirm
  `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true` and `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` /
  `..._SECRET` are set (non-empty).
  **PASS:** all three present. **FAIL:** any missing.
- [ ] **1.2 — Site URL + redirect allow-list include the NAS app.** `GOTRUE_SITE_URL` = `<ZORDAQ_APP>`
  and `GOTRUE_URI_ALLOW_LIST` (or additional-redirect-urls) contains `<ZORDAQ_APP>/auth/callback`.
  **PASS:** both correct.
- [ ] **1.3 — Google Cloud OAuth client has the NAS callback.** In Google Cloud Console → the OAuth 2.0
  Client → **Authorized redirect URIs**, confirm `<NAS_API>/auth/v1/callback` is listed. (Reuse the
  existing client; just add the URI — don't create a new one unless forced.)
  **PASS:** URI present and saved. **FAIL:** absent → this is the classic "button does nothing" cause.
- [ ] **1.4 — The button actually logs you in.** Open `<ZORDAQ_APP>`, click **Sign in with Google**,
  complete Google consent. **PASS:** you land back on `<ZORDAQ_APP>` authenticated (not an error page,
  not a redirect loop). **FAIL:** any redirect_uri_mismatch / 400 / loop.
- [ ] **1.5 — The JWT carries the email claim at the path the app reads.** After 1.4, decode the access
  token (browser devtools → the Supabase session, or jwt.io) and confirm a top-level `email` claim
  exists and equals your address, **lowercased-comparable**. The whole authz model reads
  `auth.jwt()->>'email'` / `auth.email()`. **PASS:** `email` claim present and correct.
- [ ] **1.6 — RLS actually resolves (admin).** Signed in as an admin whose email matches a `staff` row
  with `is_admin=true`, load a gated admin page (e.g. payroll). **PASS:** data loads (proves
  `is_admin()`'s `lower(staff.email)=lower(auth.email())` join works on the NAS).
  Quick DB confirm (read-only), replacing the email:
  ```sql
  select is_admin() as should_be_true;                        -- run in an authenticated context
  select lower(email) from staff where lower(email)='you@example.com';  -- must return one row
  ```
- [ ] **1.7 — RLS scopes a non-admin correctly.** Sign in as an ordinary staff account (matching a
  `staff` row, non-admin). **PASS:** they can check in, and can **not** see admin-only features
  (proves `can_access()`/`position_access` gating works). **Note:** `checkin` is the only
  hard-coded-open feature; everything else is deny-by-default, so a brand-new position with no
  `position_access` rows sees nothing but check-in — that is expected, not a failure.
- [ ] **1.8 — The 2 owner password accounts survive (only if you migrated `auth.users`).**
  `muammarhafiz@gmail.com` and `muammarhafiz@live.com.my` have real passwords. A fresh GoTrue recreates
  *Google* users lazily on first login but will **not** recreate password logins. **PASS:** either you
  migrated those `auth.users` rows and password sign-in works, **or** you consciously decided both are
  Google-login-only going forward and recorded that. **FAIL:** you assumed they'd reappear on their own.

---

## Part 2 — New JWT secret regenerates the anon + service_role keys (total failure if missed)
A self-hosted stack issues its **own** JWT secret, so the anon and service_role API keys are **different**
from the cloud project. Every consumer of the old values must be repointed or it `401`s — independent of
any RLS logic.

- [ ] **2.1 — Capture the NAS keys.** From the NAS stack config, record the new `anon` and
  `service_role` keys (they will not match the cloud ones). **PASS:** both captured.
- [ ] **2.2 — App env repointed.** `<ZORDAQ_APP>` env has `NEXT_PUBLIC_SUPABASE_URL=<NAS_API>`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=<new anon>`, `SUPABASE_SERVICE_ROLE_KEY=<new service_role>`.
  **PASS:** all three point at the NAS with new values.
- [ ] **2.3 — Anon key valid (not 401).** Unauthenticated PostgREST ping:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "<NAS_API>/rest/v1/" -H "apikey: <new anon>"
  ```
  **PASS:** `200`. **FAIL:** `401` → anon key/JWT secret mismatch.
- [ ] **2.4 — Every service-role server route answers (no 401).** Hit each server route that uses the
  service-role key once (logged in as admin). The service-role set is ≈9 routes — at minimum:
  `payroll/send-payslips`, `payroll/finalize`, `payroll/my-payslip`, `admin/set-login-access`,
  `admin/delete-employee`, `supervisors`, `offday/edit`, `bank/reconcile`, `push/dispatch`.
  **PASS:** none returns `401`/`500-invalid-key`. **FAIL:** any auth error → that route still holds an
  old key or the env didn't propagate.
- [ ] **2.5 — Edge functions repointed (only if you keep any).** If the ingestion edge functions are
  retained (per 04 they are slated to **RETIRE**), confirm each has `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` set to the NAS values, and a token-authed test call returns non-401.
  **PASS / N-A (retiring ingestion).**
- [ ] **2.6 — Web push still delivers.** VAPID keys (`vapid_public`/`private`/`subject`) carried into
  `app_secrets` **intact** (regenerating them silently invalidates every existing browser subscription).
  Subscribe on a test device, send a test push. **PASS:** notification arrives.
  > Note: `app_base_url` is stored **in the DB** (`app_secrets`), and the pg_cron push job builds its
  > target URL from it — so set the NAS base URL **in `app_secrets`, not just an env file**, or the push
  > dispatch posts to the old Vercel host.

---

## Part 3 — The `fdw_attendance` role + 144 grants (silently dropped by the backup dump)
`pg_dump --no-privileges` strips grants, and `pg_dump` never emits roles at all — so the read-only role
`fdw_attendance` (SELECT on 144 public tables) vanishes on a naive rebuild.

- [ ] **3.1 — Decide if anything still uses it.** On the *old* live project, check for a live consumer:
  ```sql
  select usename, application_name, client_addr, state
  from pg_stat_activity where usename = 'fdw_attendance';
  ```
  Also ask: is there an external BI tool / FDW / direct-Postgres reader logging in as `fdw_attendance`?
  **PASS:** you have a definite yes/no. (In the 2026-08-16 snapshot it was **not** connected — possibly
  a stale artifact of the retiring NAS integration.)
- [ ] **3.2a — If USED:** the role exists on the NAS with a login password and its 144 SELECT grants.
  Capture with `pg_dumpall "$DB_URL" --roles-only -f roles.sql`, apply, then test:
  ```sql
  -- as fdw_attendance:
  select count(*) from public.staff;   -- should succeed (read-only)
  ```
  **PASS:** connects and reads. **FAIL:** role/grants missing.
- [ ] **3.2b — If NOT used:** consciously omit/drop it and **record the decision here** so it isn't
  rediscovered as a mystery later. **PASS:** decision written down.

---

## Part 4 — Scheduler liveness after cutover (ties to 03 §B)
Enabling pg_cron restores only the 3 DB jobs; the two off-platform schedulers must be re-homed
separately (see `03-DEPENDENCY-WARNINGS.md` §B — The Three Schedulers). Quick liveness checks:

- [ ] **4.1 — pg_cron + pg_net installed and jobs registered on the NAS.**
  ```sql
  select extname, extversion from pg_extension where extname in ('pg_cron','pg_net');  -- 2 rows
  select jobname, schedule from cron.job order by jobid;                                -- the 3 jobs
  ```
  **PASS:** both extensions present and 3 jobs listed.
- [ ] **4.2 — push-dispatch actually fires.** After a minute:
  ```sql
  select status, count(*) from cron.job_run_details
  where jobid=(select jobid from cron.job where jobname='push-dispatch')
    and start_time > now() - interval '5 min' group by status;
  ```
  **PASS:** rows with status `succeeded`. **FAIL:** none → pg_cron not actually running (check
  `shared_preload_libraries` + `cron.database_name` in `postgresql.conf`).
- [ ] **4.3 — Off-platform schedulers re-homed / re-pointed.** Confirm the NAS automation engine and the
  Google Apps Script triggers (invoice watcher, BNPL email pull, GrabFood parser) point at ZORDAQ, or
  are consciously retired. **PASS:** each is accounted for (see 03 §B for the list + owners to confirm).

---

## Sign-off
```
Run by: __________________   Date: __________   NAS build/tag: __________
Part 1 Google OAuth ...... PASS / FAIL   notes:
Part 2 JWT keys .......... PASS / FAIL   notes:
Part 3 fdw_attendance .... PASS / FAIL   notes:
Part 4 schedulers ........ PASS / FAIL   notes:
```
Any FAIL here in September is a problem solved with three months to spare instead of a shop that can't
clock in on 2 January.
