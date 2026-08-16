# ZORDAQ Port Package — Overview

**Donor:** attendance-web (Next.js on Vercel + Supabase cloud `naefauflkisldxftxuhq`).
**Receiver:** ZORDAQ (self-hosted Supabase on the Synology NAS, one database; `api.zordaq.com`).
**Prepared:** 2026-08-16, read-only, by the attendance-web assistant. The receiving session cannot see this repo or DB, so this package is written to stand alone.

## The decision
ZORDAQ absorbs **every** attendance-web feature (plus the Niagawan POS/accounting) into one system on the NAS. This package is the inventory + the correctness-critical verbatim SQL + the dependency landmines + the recommended order for moving attendance-web's features across.

## Hard constraints (do not violate)
1. **attendance-web stays LIVE and untouched until 1 Jan 2027.** It is the production fallback while ZORDAQ is built. Do **not** migrate data out of it, re-point it, or decommission anything. If it breaks, the shop loses attendance + payroll with no alternative.
2. **Cutover = 1 Jan 2027** — Malaysian tax year is the calendar year and EA forms are per calendar year, so 2026 stays whole in attendance-web and ZORDAQ starts 2027 empty. No split payroll year.
3. **Payroll HISTORY does NOT migrate. LEAVE BALANCES DO** — a mechanic's remaining entitlement must be correct on 2 Jan 2027 (and leave balances are *computed*, so what migrates is their **inputs** — see § Leave).

## The one principle that shapes the whole port
attendance-web was built as a **read-mirror consumer of Niagawan**. A scraper on the NAS fills ~22 `niagawan_*` tables via 4 edge functions, and many features (staff sales, commission, P&L, BNPL, cash, purchasing, the workshop board, intake, the owner digest, and 2 of the notification source-functions) **read that mirror**.

**In ZORDAQ, that mirror does not exist — ZORDAQ *is* the POS.** So those features are not a table-copy: their reads must be **re-pointed to ZORDAQ-native sales / invoices / COGS / customers / inventory / cash** tables. Treat `niagawan_*` as a *schema-shape reference* for what fields ZORDAQ's native tables must expose, not as data to carry over. The scraper, the `sync_requests` queue, `automation_tasks`, and the 4 edge functions are **retired**, and every NAS-robot "write back to the POS" round-trip collapses into a **direct in-DB write** (ZORDAQ owns the POS).

Files 01/03/04 flag every place this re-pointing applies.

## What's in this package
- **`01-DOMAIN-INVENTORY.md`** — the 6 domain groups: tables, RPCs, pages/routes, self-containedness, cross-dependencies, and per-domain port notes (verbatim vs re-point vs rebuild).
- **`02-STATUTORY-VERBATIM.sql`** — runnable seed for the EIS / SOCSO / SKBBK bands + the statutory-calc functions, verbatim (the "correctness above all" core). Note: the live bands are `pay_v2.ref_*` — the `public.*_brackets` are legacy, ignore them.
- **`03-DEPENDENCY-WARNINGS.md`** — the exhaustive, pessimistic "won't survive self-hosted Supabase / off Vercel" list. Read this first for the December risks.
- **`04-PORTING-ORDER.md`** — what to move first, and what is entangled enough that it must move together.
- **`05-AUTH-CUTOVER-CHECKLIST.md`** — a runnable, pass/fail checklist to prove Google sign-in + the JWT-key repoint + the `fdw_attendance` role work on the NAS. **Run it in September, not on 1 Jan.**
- **`06-CONFIG-MIGRATION-MAP.md`** — the full 14-item config surface (5 env + 9 `app_secrets`), who reads each, and where it must end up — because config is what gets half-migrated and fails silently.

## Would I structure it differently? (you asked)
Two additions I'd make to your 4-part framing:
- **A "shared substrate first" layer** ahead of the domains: the auth spine (`can_access`/`is_admin`/`position_access`), `app_secrets`, and `staff` must exist before *anything* else works. It's in 01 as its own group and is step 0 in 04.
- **A "re-point map" as a first-class artifact** — because the dominant risk isn't missing a table, it's silently keeping a `niagawan_*` read that returns nothing (or stale data) in ZORDAQ. 04 lists every reader that must re-point. Consider it the acceptance checklist.
