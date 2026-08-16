-- ============================================================================
-- ZORDAQ PORT — correctness-critical payroll (statutory bands + math), VERBATIM
-- Source: attendance-web  pay_v2  schema (Supabase naefauflkisldxftxuhq), captured 2026-08-16.
-- PORT THESE EXACTLY. Malaysian EPF/SOCSO/EIS/SKBBK law is encoded here — do NOT reimplement.
--
-- ⚠ Use pay_v2.ref_eis_bands / ref_socso_bands / ref_skbbk_bands (below).
--   The public.eis_brackets / public.socso_brackets tables in the old DB are LEGACY/ORPHANED
--   (the live engine ignores them) — DO NOT port those.
-- ⚠ Payroll HISTORY does not migrate (calendar/tax-year cut 1 Jan 2027). These band tables +
--   functions + the item-type/settings rows do. Seed ZORDAQ with current bands + a fresh first period.
-- ============================================================================

create schema if not exists pay_v2;

-- ---- Band tables (DDL) --------------------------------------------------------
create table if not exists pay_v2.ref_eis_bands
  (id int primary key, min_wage numeric, max_wage numeric, emp_amount numeric, er_amount numeric);
create table if not exists pay_v2.ref_socso_bands
  (id int primary key, min_wage numeric, max_wage numeric, emp_amount_first numeric, er_amount_first numeric, er_amount_second numeric);
create table if not exists pay_v2.ref_skbbk_bands
  (id int primary key, min_wage numeric, max_wage numeric, emp_amount numeric);

-- ---- Band data (DB-generated, byte-exact; max_wage = null is the top open band) ----
-- Band match rule (see recalc below): wage > min_wage AND (max_wage IS NULL OR wage <= max_wage).

insert into pay_v2.ref_eis_bands (id,min_wage,max_wage,emp_amount,er_amount) values (1,0,30,0.05,0.05), (2,30,50,0.10,0.10), (3,50,70,0.15,0.15), (4,70,100,0.20,0.20), (5,100,140,0.25,0.25), (6,140,200,0.35,0.35), (7,200,300,0.50,0.50), (8,300,400,0.70,0.70), (9,400,500,0.90,0.90), (10,500,600,1.10,1.10), (11,600,700,1.30,1.30), (12,700,800,1.50,1.50), (13,800,900,1.70,1.70), (14,900,1000,1.90,1.90), (15,1000,1100,2.10,2.10), (16,1100,1200,2.30,2.30), (17,1200,1300,2.50,2.50), (18,1300,1400,2.70,2.70), (19,1400,1500,2.90,2.90), (20,1500,1600,3.10,3.10), (21,1600,1700,3.30,3.30), (22,1700,1800,3.50,3.50), (23,1800,1900,3.70,3.70), (24,1900,2000,3.90,3.90), (25,2000,2100,4.10,4.10), (26,2100,2200,4.30,4.30), (27,2200,2300,4.50,4.50), (28,2300,2400,4.70,4.70), (29,2400,2500,4.90,4.90), (30,2500,2600,5.10,5.10), (31,2600,2700,5.30,5.30), (32,2700,2800,5.50,5.50), (33,2800,2900,5.70,5.70), (34,2900,3000,5.90,5.90), (35,3000,3100,6.10,6.10), (36,3100,3200,6.30,6.30), (37,3200,3300,6.50,6.50), (38,3300,3400,6.70,6.70), (39,3400,3500,6.90,6.90), (40,3500,3600,7.10,7.10), (41,3600,3700,7.30,7.30), (42,3700,3800,7.50,7.50), (43,3800,3900,7.70,7.70), (44,3900,4000,7.90,7.90), (45,4000,4100,8.10,8.10), (46,4100,4200,8.30,8.30), (47,4200,4300,8.50,8.50), (48,4300,4400,8.70,8.70), (49,4400,4500,8.90,8.90), (50,4500,4600,9.10,9.10), (51,4600,4700,9.30,9.30), (52,4700,4800,9.50,9.50), (53,4800,4900,9.70,9.70), (54,4900,5000,9.90,9.90), (55,5000,null,9.90,9.90);

insert into pay_v2.ref_socso_bands (id,min_wage,max_wage,emp_amount_first,er_amount_first,er_amount_second) values (1,0,30,0.10,0.40,0.30), (2,30,50,0.20,0.70,0.50), (3,50,70,0.30,1.10,0.80), (4,70,100,0.40,1.50,1.10), (5,100,140,0.60,2.10,1.50), (6,140,200,0.85,2.95,2.10), (7,200,300,1.25,4.35,3.10), (8,300,400,1.75,6.15,4.40), (9,400,500,2.25,7.85,5.60), (10,500,600,2.75,9.65,6.90), (11,600,700,3.25,11.35,8.10), (12,700,800,3.75,13.15,9.40), (13,800,900,4.25,14.85,10.60), (14,900,1000,4.75,16.65,11.90), (15,1000,1100,5.25,18.35,13.10), (16,1100,1200,5.75,20.15,14.40), (17,1200,1300,6.25,21.65,15.60), (18,1300,1400,6.75,23.65,16.90), (19,1400,1500,7.25,25.35,18.10), (20,1500,1600,7.75,27.15,19.40), (21,1600,1700,8.25,28.85,20.60), (22,1700,1800,8.75,30.65,21.90), (23,1800,1900,9.25,32.35,23.10), (24,1900,2000,9.75,34.15,24.40), (25,2000,2100,10.25,35.85,25.60), (26,2100,2200,10.75,37.65,26.90), (27,2200,2300,11.25,39.35,28.10), (28,2300,2400,11.75,41.15,29.40), (29,2400,2500,12.25,42.85,30.60), (30,2500,2600,12.75,44.65,31.90), (31,2600,2700,13.25,46.35,33.10), (32,2700,2800,13.75,48.15,34.40), (33,2800,2900,14.25,49.85,35.60), (34,2900,3000,14.75,51.65,36.90), (35,3000,3100,15.25,53.35,38.10), (36,3100,3200,15.75,55.15,39.40), (37,3200,3300,16.25,56.85,40.60), (38,3300,3400,16.75,58.65,41.90), (39,3400,3500,17.25,60.35,43.10), (40,3500,3600,17.75,62.15,44.40), (41,3600,3700,18.25,63.85,45.60), (42,3700,3800,18.75,65.65,46.90), (43,3800,3900,19.25,67.35,48.10), (44,3900,4000,19.75,69.15,49.40), (45,4000,4100,20.25,70.85,50.60), (46,4100,4200,20.75,72.65,51.90), (47,4200,4300,21.25,74.35,53.10), (48,4300,4400,21.75,76.15,54.40), (49,4400,4500,22.25,77.85,55.60), (50,4500,4600,22.75,79.65,56.90), (51,4600,4700,23.25,81.35,58.10), (52,4700,4800,23.75,83.15,59.40), (53,4800,4900,24.25,84.85,60.60), (54,4900,5000,24.75,86.65,61.90), (55,5000,5100,25.25,88.35,63.10), (56,5100,5200,25.75,90.15,64.40), (57,5200,5300,26.25,91.85,65.60), (58,5300,5400,26.75,93.65,66.90), (59,5400,5500,27.25,95.35,68.10), (60,5500,5600,27.75,97.15,69.40), (61,5600,5700,28.25,98.85,70.60), (62,5700,5800,28.75,100.65,71.90), (63,5800,5900,29.25,102.35,73.10), (64,5900,6000,29.75,104.15,74.40), (65,6000,null,29.75,104.15,74.40);

insert into pay_v2.ref_skbbk_bands (id,min_wage,max_wage,emp_amount) values (1,0,30,0.20), (2,30,50,0.30), (3,50,70,0.50), (4,70,100,0.65), (5,100,140,0.90), (6,140,200,1.25), (7,200,300,1.85), (8,300,400,2.65), (9,400,500,3.35), (10,500,600,4.15), (11,600,700,4.85), (12,700,800,5.65), (13,800,900,6.35), (14,900,1000,7.15), (15,1000,1100,7.85), (16,1100,1200,8.65), (17,1200,1300,9.35), (18,1300,1400,10.15), (19,1400,1500,10.85), (20,1500,1600,11.65), (21,1600,1700,12.35), (22,1700,1800,13.15), (23,1800,1900,13.85), (24,1900,2000,14.65), (25,2000,2100,15.35), (26,2100,2200,16.15), (27,2200,2300,16.85), (28,2300,2400,17.65), (29,2400,2500,18.35), (30,2500,2600,19.15), (31,2600,2700,19.85), (32,2700,2800,20.65), (33,2800,2900,21.35), (34,2900,3000,22.15), (35,3000,3100,22.85), (36,3100,3200,23.65), (37,3200,3300,24.35), (38,3300,3400,25.15), (39,3400,3500,25.85), (40,3500,3600,26.65), (41,3600,3700,27.35), (42,3700,3800,28.15), (43,3800,3900,28.85), (44,3900,4000,29.65), (45,4000,4100,30.35), (46,4100,4200,31.15), (47,4200,4300,31.85), (48,4300,4400,32.65), (49,4400,4500,33.35), (50,4500,4600,34.15), (51,4600,4700,34.85), (52,4700,4800,35.65), (53,4800,4900,36.35), (54,4900,5000,37.15), (55,5000,5100,37.85), (56,5100,5200,38.65), (57,5200,5300,39.35), (58,5300,5400,40.15), (59,5400,5500,40.85), (60,5500,5600,41.65), (61,5600,5700,42.35), (62,5700,5800,43.15), (63,5800,5900,43.85), (64,5900,6000,44.65), (65,6000,null,44.65);

-- ============================================================================
-- STATUTORY CALC FUNCTIONS (verbatim from pay_v2). Keep exactly.
--   Wage base per statute = sum(BASE + EARN codes flagged stat_* in payroll_item_types) − UNPAID/UNPAID_LEAVE, floored at 0.
--   EPF: base = ceil(wage/20)*20;  emp = ceil(base*0.11);  er = ceil(base * (0.12 if wage>5000 else 0.13)).
--   SOCSO emp line = ref_socso_bands.emp_amount_first + ref_skbbk_bands.emp_amount ("SOCSO + Lindung 24 Jam").
--   SOCSO er = ref_socso_bands.er_amount_first.   EIS = ref_eis_bands.emp_amount / er_amount.
--   Per-staff toggles: public.staff.epf_enabled / socso_enabled / eis_enabled.
--   Temporary/Trainer positions: all STAT_* lines deleted (apply_statutory_exemptions).
-- ============================================================================

CREATE OR REPLACE FUNCTION pay_v2.recalc_statutories(p_year integer, p_month integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid;
begin
  select id into v_period from pay_v2.periods where year=p_year and month=p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  delete from pay_v2.items i
   where i.period_id = v_period
     and i.kind in ('STAT_EMP_EPF','STAT_EMP_SOCSO','STAT_EMP_EIS','STAT_ER_EPF','STAT_ER_SOCSO','STAT_ER_EIS');

  with base as (
    select i.staff_email, sum(i.amount)::numeric as base_amt
    from pay_v2.items i
    where i.period_id=v_period and i.kind='EARN' and upper(coalesce(i.code,''))='BASE'
    group by i.staff_email
  ),
  addons as (
    select i.staff_email,
      sum(case when t.stat_epf   then i.amount else 0 end)::numeric as epf_add,
      sum(case when t.stat_socso then i.amount else 0 end)::numeric as socso_add,
      sum(case when t.stat_eis   then i.amount else 0 end)::numeric as eis_add
    from pay_v2.items i
    join pay_v2.payroll_item_types t on upper(t.code) = upper(coalesce(i.code,''))
    where i.period_id=v_period and i.kind='EARN' and upper(coalesce(i.code,'')) <> 'BASE'
    group by i.staff_email
  ),
  unpaid as (
    select i.staff_email, sum(i.amount)::numeric as unpaid_amt
    from pay_v2.items i
    where i.period_id=v_period and i.kind='DEDUCT' and upper(coalesce(i.code,'')) in ('UNPAID','UNPAID_LEAVE')
    group by i.staff_email
  ),
  wages as (
    select b.staff_email,
      greatest(b.base_amt + coalesce(a.epf_add,0)   - coalesce(u.unpaid_amt,0), 0)::numeric as epf_w,
      greatest(b.base_amt + coalesce(a.socso_add,0) - coalesce(u.unpaid_amt,0), 0)::numeric as socso_w,
      greatest(b.base_amt + coalesce(a.eis_add,0)   - coalesce(u.unpaid_amt,0), 0)::numeric as eis_w
    from base b
    left join addons a using (staff_email)
    left join unpaid u using (staff_email)
  ),
  flags as (
    select s.email as staff_email,
      coalesce(s.epf_enabled,true) as epf_enabled,
      coalesce(s.socso_enabled,true) as socso_enabled,
      coalesce(s.eis_enabled,true) as eis_enabled
    from public.staff s
  ),
  bands as (
    select wg.staff_email, wg.epf_w, wg.socso_w, wg.eis_w,
      (ceil(wg.epf_w/20.0)*20)::numeric as epf_base,
      (select sb.emp_amount_first from pay_v2.ref_socso_bands sb
        where wg.socso_w > sb.min_wage and (sb.max_wage is null or wg.socso_w <= sb.max_wage)
        order by sb.max_wage nulls first limit 1) as socso_emp,
      (select sb.er_amount_first from pay_v2.ref_socso_bands sb
        where wg.socso_w > sb.min_wage and (sb.max_wage is null or wg.socso_w <= sb.max_wage)
        order by sb.max_wage nulls first limit 1) as socso_er,
      (select kb.emp_amount from pay_v2.ref_skbbk_bands kb
        where wg.socso_w > kb.min_wage and (kb.max_wage is null or wg.socso_w <= kb.max_wage)
        order by kb.max_wage nulls first limit 1) as skbbk_emp,
      (select eb.emp_amount from pay_v2.ref_eis_bands eb
        where wg.eis_w > eb.min_wage and (eb.max_wage is null or wg.eis_w <= eb.max_wage)
        order by eb.max_wage nulls first limit 1) as eis_emp,
      (select eb.er_amount from pay_v2.ref_eis_bands eb
        where wg.eis_w > eb.min_wage and (eb.max_wage is null or wg.eis_w <= eb.max_wage)
        order by eb.max_wage nulls first limit 1) as eis_er
    from wages wg
  )
  insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
  select v_period, b.staff_email, 'STAT_EMP_EPF','STAT_EMP_EPF','EPF (Emp)', ceil(b.epf_base*0.11)
    from bands b join flags f using(staff_email) where f.epf_enabled and b.epf_w>0
  union all
  select v_period, b.staff_email, 'STAT_ER_EPF','STAT_ER_EPF','EPF (Er)',
         ceil(b.epf_base * (case when b.epf_w > 5000 then 0.12 else 0.13 end))
    from bands b join flags f using(staff_email) where f.epf_enabled and b.epf_w>0
  union all
  select v_period, b.staff_email, 'STAT_EMP_SOCSO','STAT_EMP_SOCSO','SOCSO + Lindung 24 Jam (Emp)',
         coalesce(b.socso_emp,0) + coalesce(b.skbbk_emp,0)
    from bands b join flags f using(staff_email)
    where f.socso_enabled and (b.socso_emp is not null or b.skbbk_emp is not null)
  union all
  select v_period, b.staff_email, 'STAT_ER_SOCSO','STAT_ER_SOCSO','SOCSO (Er)', b.socso_er
    from bands b join flags f using(staff_email) where f.socso_enabled and b.socso_er is not null
  union all
  select v_period, b.staff_email, 'STAT_EMP_EIS','STAT_EMP_EIS','EIS (Emp)', b.eis_emp
    from bands b join flags f using(staff_email) where f.eis_enabled and b.eis_emp is not null
  union all
  select v_period, b.staff_email, 'STAT_ER_EIS','STAT_ER_EIS','EIS (Er)', b.eis_er
    from bands b join flags f using(staff_email) where f.eis_enabled and b.eis_er is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.apply_statutory_exemptions(p_year integer, p_month integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare
  v_period uuid;
begin
  select id into v_period from pay_v2.periods where year = p_year and month = p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  with exempt as (
    select lower(email) as email
    from public.staff
    where position ilike 'temporary%' or position ilike 'trainer%'
  )
  delete from pay_v2.items i
  using exempt e
  where i.period_id = v_period
    and lower(i.staff_email) = e.email
    and i.code ilike 'STAT_%';  -- nukes both Emp & ER statutory lines
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.recalc_statutories_respect_temp(p_year integer, p_month integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
begin
  perform pay_v2.recalc_statutories(p_year, p_month);
  perform pay_v2.apply_statutory_exemptions(p_year, p_month);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.unpaid_divisor()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pay_v2', 'public'
AS $function$
  select case
    when (select value from pay_v2.payroll_settings where key='unpaid_divisor') ~ '^[0-9]+(\.[0-9]+)?$'
      then (select value from pay_v2.payroll_settings where key='unpaid_divisor')::numeric
    else 26 end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.unpaid_divisor(p_year integer, p_month integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pay_v2', 'public'
AS $function$
  with s as (select value v from pay_v2.payroll_settings where key='unpaid_divisor')
  select case
    when (select v from s) = 'workdays' then
      (select count(*)::numeric
         from generate_series(make_date(p_year,p_month,1),
                              (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date,
                              interval '1 day') d
        where extract(dow from d) <> 0)
    when (select v from s) ~ '^[0-9]+(\.[0-9]+)?$' then (select v from s)::numeric
    else 26
  end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.absent_days_from_report(p_year integer, p_month integer)
 RETURNS TABLE(staff_email text, days_absent integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pay_v2', 'public', 'extensions'
AS $function$
  select d.staff_email, count(*)::int as days_absent
  from att_v2.daily d
  where d.day >= make_date(p_year, p_month, 1)
    and d.day <  (make_date(p_year, p_month, 1) + interval '1 month')
    and d.day <= (now() at time zone 'Asia/Kuala_Lumpur')::date  -- elapsed days only
    and d.status = 'ABSENT'
  group by d.staff_email;
$function$;

-- ============================================================================
-- ALSO REQUIRED for the above to compute correctly — port verbatim (dump the same way):
--   pay_v2.payroll_item_types (20 rows)  — the stat_epf/stat_socso/stat_eis/stat_hrdf flags per EARN code
--                                          decide which earnings enter each statutory wage base.
--                                          WITHOUT these rows the "addons" CTE finds nothing and only BASE is statutory.
--   pay_v2.payroll_settings (5 rows)     — unpaid_divisor=26, deduct_unpaid_leave, punctuality_enabled/amount/max_late.
-- And the rest of the pipeline (build_period + sync_base_items/recurring_earnings/absent_deductions/
--   unpaid_leave_deductions/ph_work_earnings/punctuality_allowance, finalize_period/lock/unlock, the
--   _block_items_when_locked + items_normalize_kind_code triggers) — see 01-DOMAIN-INVENTORY.md § Payroll.
--   (Ask the donor for PORT-PACKAGE/02b-payroll-pipeline.sql to get those verbatim too.)
-- ============================================================================
