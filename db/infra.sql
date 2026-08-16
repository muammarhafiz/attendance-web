-- BACKUP: infra that `pg_dump --schema-only` does NOT capture — pg_cron jobs, storage buckets + policies,
-- extensions. From naefauflkisldxftxuhq, 2026-08-16. Re-create on the target Postgres.

-- ---- Extensions (enable before the schema dump) ----
-- SCHEMA PLACEMENT MATTERS: on the live project pgcrypto + uuid-ossp live in the `extensions` schema,
-- while earthdistance/cube/pg_trgm live in `public`. pay_v2 functions pin search_path=public,pay_v2,
-- extensions and pay_v2.items.id DEFAULTs to uuid_generate_v4() (unqualified) — if uuid-ossp lands
-- anywhere off that search_path, payroll-item INSERTs fail. So pin the schema explicitly to match live.
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;   -- REQUIRED by pay_v2.items
create extension if not exists pgcrypto    with schema extensions;
create extension if not exists pg_trgm;          -- public — REQUIRED by 11 non-ecom functions (similarity())
create extension if not exists cube;             -- public
create extension if not exists earthdistance;    -- public — depends on cube; REQUIRED by geofenced check-in
create extension if not exists pg_stat_statements;
create extension if not exists pg_net;          -- v0.19.5 — REQUIRED by notify_owner() + the cron http_post jobs
create extension if not exists pg_cron;         -- v1.6.4 — REQUIRED by the 3 scheduled jobs below
                                                --   (pg_cron also needs shared_preload_libraries + cron.database_name
                                                --    set in postgresql.conf on self-hosted — not just CREATE EXTENSION)
-- supabase_vault (v0.3.1) and plpgsql are managed by Supabase. NOTE: vault is INSTALLED BUT UNUSED
-- (vault.secrets has 0 rows; app_secrets is a plain public table) — no vault migration needed.

-- ---- pg_cron jobs (times are UTC) ----
-- 1) refresh Niagawan customers nightly (06:00 MYT)
select cron.schedule('daily-customers-refresh', '0 22 * * *',
  $$insert into public.sync_requests (which, source) values ('customers', 'pg_cron-daily')$$);

-- 2) push-notification dispatch every minute -> POSTs to the app's /api/push/dispatch (needs app_base_url + push_dispatch_token secrets)
select cron.schedule('push-dispatch', '* * * * *',
  $$select net.http_post(
      url := (select value from public.app_secrets where name = 'app_base_url') || '/api/push/dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-dispatch-token', (select value from public.app_secrets where name = 'push_dispatch_token')
      ),
      body := '{}'::jsonb
    );$$);

-- 3) owner end-of-day digest, every 10 min 20:00-21:59 MYT (self-guards to fire once >=20:40 KL)
select cron.schedule('owner-digest', '*/10 12-13 * * *', $$select public.build_owner_digest()$$);

-- ---- Storage buckets ----
-- (create via the Storage API / dashboard; shown here for the record)
--   mc            private   — MC certificates + off-day/emergency attachments
--   payroll       private   — generated payslip + summary PDFs
--   petty-cash    private   — petty cash receipt photos
--   pinv          private   — supplier purchase-invoice PDFs (Gemini OCR)
--   product-photos public, 5 MB limit  — belongs to the ecom/store side (ZORDAQ), not attendance-web

-- ---- Storage RLS policies (on storage.objects) ----
create policy "mc_admin_read"   on storage.objects for select to authenticated using (bucket_id = 'mc' and is_admin());
create policy "mc_insert_auth"  on storage.objects for insert to authenticated with check (bucket_id = 'mc');
create policy "payroll_admin_read"    on storage.objects for select to authenticated using (bucket_id = 'payroll' and is_admin());
create policy "payroll_service_write" on storage.objects for all to service_role using (bucket_id = 'payroll') with check (bucket_id = 'payroll');
create policy "petty_cash_receipts_read"   on storage.objects for select to authenticated using (bucket_id = 'petty-cash' and can_access('workshop'));
create policy "petty_cash_receipts_insert" on storage.objects for insert to authenticated with check (bucket_id = 'petty-cash' and can_access('workshop'));
create policy "pinv_admin_read"  on storage.objects for select to authenticated using (bucket_id = 'pinv' and is_admin());
create policy "pinv_admin_write" on storage.objects for insert to authenticated with check (bucket_id = 'pinv' and is_admin());
-- ecom/store bucket policies (belong to ZORDAQ; reference ecom_can_manage() which is an ecom_* function):
create policy "ecom_photos_select" on storage.objects for select to public using (bucket_id = 'product-photos');
create policy "ecom_photos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'product-photos' and ecom_can_manage());
create policy "ecom_photos_update" on storage.objects for update to authenticated using (bucket_id = 'product-photos' and ecom_can_manage()) with check (bucket_id = 'product-photos' and ecom_can_manage());
create policy "ecom_photos_delete" on storage.objects for delete to authenticated using (bucket_id = 'product-photos' and ecom_can_manage());
