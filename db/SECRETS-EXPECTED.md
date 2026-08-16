# Secrets the system expects — NAMES ONLY (values never committed)

Recovery reference: after restoring the schema/functions/edge functions to a new project, these must be
re-created with their real values (get them from the live project's dashboard / your password manager).

## `public.app_secrets` rows (name → who reads it)
| name | consumed by |
|---|---|
| `vapid_public` | web-push; `push_public_key()`, dispatch, PushToggle client |
| `vapid_private` | web-push signing in `/api/push/dispatch` (lib/pushServer) |
| `vapid_subject` | web-push VAPID subject (mailto:) |
| `push_dispatch_token` | shared secret between the pg_cron `push-dispatch` job and `/api/push/dispatch` |
| `app_base_url` | base URL the cron job POSTs to (`…/api/push/dispatch`) |
| `niagawan_ingest_token` | the 4 `niagawan-*` edge functions + `/api/bnpl/ingest` + `/api/pinv/extract` (x-ingest-token) |
| `gemini_key` | `/api/pinv/extract` → Google Gemini (invoice OCR) |
| `notify_url` | `notify_owner()` → external email relay (Google Apps Script mailer) |
| `notify_token` | auth for the same email relay |

## Vercel / server environment variables (NOT in the DB)
| env var | used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | every client + server Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | server API routes (push dispatch, pinv extract, payroll, bnpl ingest, supervisors, offday) + edge functions |
| `NOTIFY_URL` / `NOTIFY_TOKEN` | `/api/payroll/send-payslips` mailer webhook |

## Edge-function runtime env (Supabase provides)
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — read via `Deno.env.get(...)` in all 4 edge functions.

> ⚠ Never commit the VALUES. `app_secrets` row data (vapid_private, gemini_key, tokens) must be excluded from every dump.
