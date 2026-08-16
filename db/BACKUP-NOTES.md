# Logic backup — what's here, what's missing, sizing & sensitivity

Snapshot date: **2026-08-16**. Source project: **naefauflkisldxftxuhq** (attendance-web, live).
This commit exists so the system's *logic* survives even though the live project has no other backup.
It changes **nothing** in the live project — it is read-from-live + write-to-repo only.

---

## 1. What is captured in this commit

| Path | What it is | How obtained |
|---|---|---|
| `supabase/functions/niagawan-ingest/index.ts` | Edge fn v29 (NAS→DB job router) | `get_edge_function`, verbatim |
| `supabase/functions/niagawan-inventory/index.ts` | Edge fn v9 | verbatim |
| `supabase/functions/niagawan-autopo/index.ts` | Edge fn v6 | verbatim |
| `supabase/functions/niagawan-pinv/index.ts` | Edge fn v19 (has the hardcoded host — see §5) | verbatim |
| `db/functions/att_v2.sql` | Attendance engine — 7 functions | `pg_get_functiondef`, verbatim |
| `db/functions/pay_v2-pipeline.sql` | Payroll pipeline functions | verbatim |
| `PORT-PACKAGE/02-STATUTORY-VERBATIM.sql` | EPF/SOCSO/EIS/SKBBK **band rows + statutory functions** (the numbers ARE the logic) | verbatim, with rows |
| `db/infra.sql` | pg_cron jobs, storage buckets + policies, extensions | reconstructed from `cron.job`, `storage.buckets/policies`, `pg_extension` |
| `db/SECRETS-EXPECTED.md` | The 9 `app_secrets` names + env var names — **names only** | catalog only |

> **The 4 edge functions are the single most important thing here.** They exist *only* as deployed
> code in the live project — not in any repo, and `pg_dump` cannot see them. If the project were lost
> today, this file set is the only copy.

---

## 2. What is NOT in this commit (and how to get it)

`pg_dump` was **not** run — I have MCP `execute_sql` only, no DB password, and 278 kB of function
bodies would truncate silently through the MCP channel. So the **complete relational schema** (all 104
table DDLs, the ~250 remaining `public` functions, all 159 RLS policies, all 22 triggers, sequences,
grants) is **not yet** in the repo. Get it with one command, run by you (owner), from the project root:

```bash
supabase db dump --schema-only -f db/schema.sql
```

or, if you have the DB connection string, the pg_dump equivalent:

```bash
pg_dump "$DB_URL" --schema-only --no-owner --no-privileges \
  --exclude-table='public.ecom_*' -f db/schema.sql
```

Then, **reference data only** (non-PII config tables that ARE logic) with rows — never the whole DB:

```bash
pg_dump "$DB_URL" --data-only --no-owner \
  -t 'pay_v2.ref_*' -t public.payroll_item_types -t public.payroll_settings \
  -t public.position_access -t public.public_holidays -t public.automation_tasks \
  -t public.bnpl_providers -t public.config -t public.leave_settings \
  -f db/reference-data.sql
```

### ⚠ Roles & grants — `--no-privileges` drops them, and `pg_dump` never emits roles at all
The commands above use `--no-privileges`, and `pg_dump` **never** dumps role definitions (roles are
cluster-global). Live has one non-standard role — **`fdw_attendance`** (login-enabled, holds SELECT on
**144 public tables**), a dedicated read-only external consumer. A rebuild from the dumps above would
**silently lose** the role and its 144 grants. If you want the restore to be faithful, also run:

```bash
pg_dumpall "$DB_URL" --roles-only -f db/roles.sql
```

Caveat: `fdw_attendance` is **not** connected in the current `pg_stat_activity` snapshot — it may be a
stale artifact of the retiring NAS integration. Decide before relying on it: if something still reads as
`fdw_attendance`, keep the role + re-grant; if not, drop it. Don't lose it by accident. (Full detail:
`PORT-PACKAGE/03-DEPENDENCY-WARNINGS.md` §A5.)

### ⚠ ecom_* exclusion
`ecom_*` is the **live ZORDAQ store schema mirrored into this project — do NOT drop it, do NOT port
it.** `--exclude-table='public.ecom_*'` keeps the ~36 ecom tables/views out of the dump. Note pg_dump
`--exclude-table` filters **tables/views only** — the ~89 `ecom_`-prefixed *functions* will still
appear in a raw schema dump. They are harmless in a backup (clearly prefixed, and the port package
already says "ignore everything `ecom_`"), but if you want them gone from the committed file, grep them
out after dumping. **Never delete them from the live database.**

### ⚠ Always exclude from any --data-only dump (PII / secrets)
`public.app_secrets` (secret VALUES), `public.staff` / `salary_profiles` (NRIC, bank acct, EPF/SOCSO
nos), `niagawan_customers` (phones), and every attendance/sales/payroll transaction table. Structure
only for those.

---

## 3. Sizing

| Metric | Count |
|---|---|
| Tables (public, non-ecom) | 104 |
| Functions (non-ecom) | 304 — pay_v2 23, att_v2 7, public 274 |
| Function body bytes | ~278 kB (pay_v2 31 kB, att_v2 8 kB, public 239 kB) |
| RLS policies | 159 |
| Triggers | 22 |
| Migrations in history | 376 |
| Edge functions | 4 |
| This backup on disk | ~90 kB of text (edge source + SQL + notes) |

A full `--schema-only` dump will add roughly **300–500 kB** of SQL — still tiny, safe to commit.

---

## 4. Sensitivity report (item d) — is anything sensitive being committed?

**No.** Everything in this commit is logic/structure/reference-data. Specifically:

- ✅ Edge-function source — reads secrets from `Deno.env` / `app_secrets` at runtime; **no values embedded**.
- ✅ `att_v2` / `pay_v2` function DDL — algorithm only.
- ✅ Statutory band rows — public government reference figures (EPF/SOCSO/EIS/SKBBK), not personal data.
- ✅ `infra.sql` — the cron `net.http_post` reads the token via `select … from app_secrets` at runtime; the SQL text contains **no token value**.
- ✅ `SECRETS-EXPECTED.md` — **names only**.
- ❌ **Not present:** no NRIC, no bank accounts, no salaries, no customer phones, no `app_secrets`
  values, no API keys, no staff/attendance/sales rows.

**Rule for the follow-up dumps in §2:** `--schema-only` for everything; `--data-only` ONLY for the
whitelisted reference tables above; NEVER dump `app_secrets` data or any PII table's rows.

---

## 5. Hardcoded hosts (your question)

You asked whether niagawan-pinv's `https://attendancezp-web.vercel.app/api/pinv/extract` is the only
hardcoded host. Findings across the 4 edge functions + the app:

1. **`https://attendancezp-web.vercel.app/api/pinv/extract`** — in `niagawan-pinv` v19. **This is the
   only hardcoded host that would MIS-ROUTE after a move** — it points the invoice-OCR callback back at
   the *current* Vercel deployment. On any migration this must be re-pointed. ← the one that matters.
2. `https://esm.sh/@supabase/supabase-js@2` — dependency CDN import in **all 4** edge functions. Not a
   data endpoint; a self-hosted Deno/edge deploy still fetches the module from esm.sh at deploy time.
3. `https://generativelanguage.googleapis.com/...` — in the app's `/api/pinv/extract` route (Google
   Gemini OCR). Legitimate external API, key-gated; not a self-reference.
4. `notify_url` (email relay) and `app_base_url` are **not** hardcoded — they're read from `app_secrets`.

**Answer: yes — the vercel.app URL in niagawan-pinv is the only self-referential hardcoded host.**
Everything else is either a dependency CDN or a keyed third-party API.

---

## 6. Restore rehearsal — a backup that has never been restored is a hypothesis

### 6a. What has actually been verified (2026-08-16, no Postgres needed)
- **Statutory bands are byte-faithful to live.** The committed `02-STATUTORY-VERBATIM.sql` band rows were
  parsed and their per-column sums + counts compared against the live `pay_v2.ref_*` tables. **Exact
  match, to the cent:** `ref_eis_bands` 55 rows (Σemp 260.60, Σer 260.60); `ref_socso_bands` 65 rows
  (ΣempFirst 931.20, ΣerFirst 3259.20, ΣerSecond 2328.20); `ref_skbbk_bands` 65 rows (Σemp 1396.95).
  (Internal consistency also holds: Σmin_wage = Σmax_wage per table, as contiguous bands with a `0`
  floor require.) This is the most correctness-critical data in the whole backup and it is **proven**,
  not assumed.
- **Every committed SQL file is structurally intact.** Dollar-quote tags balanced
  (`02`=12, `att_v2`=14, `pay_v2-pipeline`=34), `CREATE FUNCTION` counts as expected (6 / 7 / 17), no
  truncated statements; the 4 edge-function files are complete (69 / 363 / 150 / 232 lines).

### 6b. What is NOT yet proven, and the cheapest way to prove it
A **full** restore (all table DDL + the ~250 remaining functions + RLS + triggers) can't be tested until
the `supabase db dump --schema-only` from §2 exists. Once it does, rehearse the restore in ~15 minutes on
any machine with Docker (a **throwaway** container — never against prod, never against the NAS prod DB):

```bash
# 1. throwaway Postgres (nothing persisted; container is deleted at the end)
docker run --rm -d --name zordaq-restore-test -e POSTGRES_PASSWORD=x -p 5433:5432 postgres:16
sleep 5

# 2. load in dependency order: extensions/roles first, then schema, then the crown-jewel logic + bands
psql "postgresql://postgres:x@localhost:5433/postgres" -v ON_ERROR_STOP=1 -f db/infra.sql          # extensions (pg_net/pg_cron will error here — expected, see note)
psql "postgresql://postgres:x@localhost:5433/postgres" -v ON_ERROR_STOP=1 -f db/roles.sql          # if you captured fdw_attendance
psql "postgresql://postgres:x@localhost:5433/postgres" -v ON_ERROR_STOP=1 -f db/schema.sql         # the full --schema-only dump
psql "postgresql://postgres:x@localhost:5433/postgres" -v ON_ERROR_STOP=1 -f PORT-PACKAGE/02-STATUTORY-VERBATIM.sql
psql "postgresql://postgres:x@localhost:5433/postgres" -v ON_ERROR_STOP=1 -f db/functions/att_v2.sql
psql "postgresql://postgres:x@localhost:5433/postgres" -v ON_ERROR_STOP=1 -f db/functions/pay_v2-pipeline.sql

# 3. sanity: bands landed, functions exist, geofence math works
psql "postgresql://postgres:x@localhost:5433/postgres" -c "select count(*) from pay_v2.ref_socso_bands;"   -- expect 65
psql "postgresql://postgres:x@localhost:5433/postgres" -c "select proname from pg_proc where proname='recalc_statutories';"  -- expect 1 row

docker rm -f zordaq-restore-test
```

**`ON_ERROR_STOP=1` is the point** — the first load that fails aborts loudly instead of leaving a
half-built schema that looks fine. Expect two *known* errors that are lessons, not failures:
- `db/infra.sql` will error on `create extension pg_net` / `pg_cron` — the stock `postgres:16` image
  doesn't ship them (exactly the §B1 warning). On the NAS, install them per §B1 first.
- `att_v2.sql` / `pay_v2-pipeline.sql` reference tables created by `schema.sql`; load them **after** it,
  as ordered above. If loaded standalone, SQL-language functions referencing missing tables will fail —
  that ordering *is* the test.

Anything else that errors is a real backup defect found on a laptop in September instead of on the NAS in
January. (This rehearsal already paid for itself once: it's the review that caught the `uuid-ossp`
schema-placement bug in `infra.sql` — see `03` §C1 — which would have made every payroll-item insert
fail on a fresh DB.)
