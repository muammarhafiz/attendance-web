-- BACKUP: pay_v2 payroll PIPELINE functions — verbatim from naefauflkisldxftxuhq, 2026-08-16.
-- The STATUTORY functions (recalc_statutories, apply_statutory_exemptions, recalc_statutories_respect_temp,
-- unpaid_divisor x2, absent_days_from_report) and the ref_* band tables + data are in
-- ../../PORT-PACKAGE/02-STATUTORY-VERBATIM.sql. Together these two files are the full pay_v2 function set.
-- Source of truth is the live DB / a fresh `supabase db dump`. Point-in-time capture.
-- Also needs (dump with data): pay_v2.periods, pay_v2.items(+UNIQUE(period_id,staff_email,kind,code)),
--   pay_v2.payroll_item_types (stat_* flags), pay_v2.payroll_settings, pay_v2.period_build_log/errors,
--   views v_payslip_admin_summary(_v2). Triggers on pay_v2.items: items_normalize_kind_code, _block_items_when_locked.

CREATE OR REPLACE FUNCTION pay_v2.upsert_period(p_year integer, p_month integer)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period_id uuid;
begin
  insert into pay_v2.periods(year, month, status)
  values (p_year, p_month, 'OPEN')
  on conflict (year, month) do update set year = excluded.year
  returning id into v_period_id;
  return v_period_id;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.build_period(p_year integer, p_month integer)
 RETURNS TABLE(period_id uuid, staff_email text, line_count integer)
 LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode='42501'; end if;
  v_period := pay_v2.upsert_period(p_year, p_month);
  perform pay_v2.sync_base_items_respect_archive(p_year, p_month);
  perform pay_v2.sync_recurring_earnings(p_year, p_month);
  perform pay_v2.sync_absent_deductions(p_year, p_month);
  perform pay_v2.sync_unpaid_leave_deductions(p_year, p_month);
  perform pay_v2.sync_ph_work_earnings(p_year, p_month);
  perform pay_v2.sync_punctuality_allowance(p_year, p_month);
  perform pay_v2.recalc_statutories_respect_temp(p_year, p_month);
  perform pay_v2.cleanup_inactive_items(p_year, p_month);
  return query
  select v_period, i.staff_email, count(*)::int
  from pay_v2.items i where i.period_id = v_period
  group by i.staff_email order by i.staff_email;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.build_period_system(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pay_v2', 'public'
AS $function$
declare got_lock boolean; inserted_log int;
begin
  got_lock := pg_try_advisory_xact_lock(hashtext('pay_v2_build_'||p_year||'_'||p_month));
  if not got_lock then return; end if;
  insert into pay_v2.period_build_log(year, month) values (p_year, p_month) on conflict (year, month) do nothing;
  get diagnostics inserted_log = row_count;
  if inserted_log = 0 then return; end if;
  perform pay_v2.upsert_period(p_year, p_month);
  perform pay_v2.sync_base_items_respect_archive(p_year, p_month);
  perform pay_v2.sync_recurring_earnings(p_year, p_month);
  perform pay_v2.sync_absent_deductions(p_year, p_month);
  perform pay_v2.sync_unpaid_leave_deductions(p_year, p_month);
  perform pay_v2.sync_ph_work_earnings(p_year, p_month);
  perform pay_v2.sync_punctuality_allowance(p_year, p_month);
  perform pay_v2.recalc_statutories_respect_temp(p_year, p_month);
exception when others then
  delete from pay_v2.period_build_log where year=p_year and month=p_month; raise;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_base_items_respect_archive(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare
  v_period uuid;
  v_start date := make_date(p_year,p_month,1);
  v_end   date := (make_date(p_year,p_month,1) + interval '1 month - 1 day')::date;
begin
  select id into v_period from pay_v2.periods where year = p_year and month = p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  with active as (
    select lower(s.email) as email, coalesce(s.basic_salary,0)::numeric as amt
    from public.staff s
    where s.archived_at is null
      and coalesce(s.include_in_payroll, true) = true
      and coalesce(s.skip_payroll, false) = false
      and (s.start_date is null or s.start_date <= v_end)
      and (s.employment_end_date is null or s.employment_end_date >= v_start)
  )
  insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
  select v_period, a.email, 'EARN', 'BASE', 'Base salary', a.amt
  from active a
  on conflict (period_id, staff_email, kind, code) do update set amount = excluded.amount;

  delete from pay_v2.items i
  where i.period_id = v_period
    and not public.is_staff_active_for_period(i.staff_email, p_year, p_month);

  perform pay_v2.recalc_statutories(p_year, p_month);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_base_items(p_year integer, p_month integer)
 RETURNS TABLE(staff_email text, base_amount numeric)
 LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid; r record;
begin
  select id into v_period from pay_v2.periods where year = p_year and month = p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;
  for r in
    select s.email as staff_email, coalesce(s.basic_salary,0)::numeric as base_amt
    from public.staff s
    where coalesce(s.include_in_payroll,true) and not coalesce(s.skip_payroll,false)
  loop
    delete from pay_v2.items i
    where i.period_id = v_period and i.staff_email = r.staff_email
      and i.kind = 'EARN' and upper(coalesce(i.code,'')) = 'BASE';
    if r.base_amt > 0 then
      insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
      values (v_period, r.staff_email, 'EARN', 'BASE', 'Base salary', r.base_amt);
    end if;
    staff_email := r.staff_email; base_amount := r.base_amt; return next;
  end loop;
  perform pay_v2.recalc_statutories(p_year, p_month);
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_recurring_earnings(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid; v_prev_period uuid; v_prev_year int; v_prev_month int;
begin
  select id into v_period from pay_v2.periods where year = p_year and month = p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;
  if p_month = 1 then v_prev_year := p_year - 1; v_prev_month := 12;
  else v_prev_year := p_year; v_prev_month := p_month - 1; end if;
  select id into v_prev_period from pay_v2.periods where year = v_prev_year and month = v_prev_month;
  if v_prev_period is null then return; end if;

  -- Copy COMM from previous period; only UPDATE rows that were themselves carried forward
  -- (meta.source='carry_forward'), so manual admin edits are never overwritten.
  insert into pay_v2.items (period_id, staff_email, kind, code, label, amount, meta)
  select v_period, lower(prev.staff_email), 'EARN', 'COMM',
    coalesce(nullif(max(prev.label),''), 'Commission'),
    round(sum(prev.amount)::numeric, 2),
    jsonb_build_object('recurring', true, 'source', 'carry_forward',
      'from_year', v_prev_year, 'from_month', v_prev_month, 'copied_at', now())
  from pay_v2.items prev
  where prev.period_id = v_prev_period
    and upper(prev.kind) = 'EARN' and upper(coalesce(prev.code,'')) = 'COMM'
    and public.is_staff_active_for_period(prev.staff_email, p_year, p_month)
  group by lower(prev.staff_email)
  having round(sum(prev.amount)::numeric, 2) > 0
  on conflict (period_id, staff_email, kind, code)
  do update set amount = excluded.amount, label = excluded.label, meta = excluded.meta
  where coalesce(pay_v2.items.meta->>'source','') = 'carry_forward';
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_absent_deductions(p_year integer, p_month integer)
 RETURNS TABLE(staff_email text, days_absent integer, daily_rate numeric, amount numeric)
 LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid; v_div numeric := pay_v2.unpaid_divisor(p_year, p_month);
begin
  select id into v_period from pay_v2.periods where year = p_year and month = p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  delete from pay_v2.items i
  where i.period_id = v_period and i.kind = 'DEDUCT' and upper(coalesce(i.code,'')) = 'UNPAID';

  with abs as (
    select a.staff_email, coalesce(a.days_absent,0)::int as days_absent
    from pay_v2.absent_days_from_report(p_year := p_year, p_month := p_month) a
    join public.staff s on lower(s.email) = lower(a.staff_email)
    where coalesce(a.days_absent,0) > 0
      and public.is_staff_active_for_period(a.staff_email, p_year, p_month)
      and coalesce(s.salary_based_on_attendance, true) = true
  ),
  base as (
    select lower(i.staff_email) as staff_email, sum(i.amount)::numeric as base_amt
    from pay_v2.items i
    where i.period_id = v_period and i.kind = 'EARN' and upper(coalesce(i.code,'')) = 'BASE'
    group by lower(i.staff_email)
  ),
  staff_src as (
    select lower(s.email) as staff_email, coalesce(s.basic_salary,0)::numeric as staff_basic
    from public.staff s where s.include_in_payroll = true and s.skip_payroll = false
  ),
  wage as (
    select lower(a.staff_email) as staff_email, a.days_absent,
      coalesce(b.base_amt, ss.staff_basic, 0)::numeric as period_base
    from abs a
    left join base b on b.staff_email = lower(a.staff_email)
    left join staff_src ss on ss.staff_email = lower(a.staff_email)
  ),
  calc as (
    select w.staff_email, w.days_absent,
      case when w.period_base > 0 then round(w.period_base / v_div, 2) else 0 end as daily_rate,
      case when w.period_base > 0 then round((w.period_base / v_div) * w.days_absent, 2) else 0 end as amount
    from wage w
  )
  insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
  select v_period, c.staff_email, 'DEDUCT', 'UNPAID', 'Unpaid leave (auto)', c.amount
  from calc c where c.amount > 0;

  perform pay_v2.recalc_statutories(p_year, p_month);

  return query
  with abs as (
    select a.staff_email, coalesce(a.days_absent,0)::int as days_absent
    from pay_v2.absent_days_from_report(p_year := p_year, p_month := p_month) a
    join public.staff s on lower(s.email) = lower(a.staff_email)
    where coalesce(a.days_absent,0) > 0
      and public.is_staff_active_for_period(a.staff_email, p_year, p_month)
      and coalesce(s.salary_based_on_attendance, true) = true
  ),
  base as (
    select lower(i.staff_email) as staff_email, sum(i.amount)::numeric as base_amt
    from pay_v2.items i
    where i.period_id = v_period and i.kind = 'EARN' and upper(coalesce(i.code,'')) = 'BASE'
    group by lower(i.staff_email)
  ),
  staff_src as (
    select lower(s.email) as staff_email, coalesce(s.basic_salary,0)::numeric as staff_basic
    from public.staff s where s.include_in_payroll = true and s.skip_payroll = false
  ),
  wage as (
    select lower(a.staff_email) as staff_email, a.days_absent,
      coalesce(b.base_amt, ss.staff_basic, 0)::numeric as period_base
    from abs a
    left join base b on b.staff_email = lower(a.staff_email)
    left join staff_src ss on ss.staff_email = lower(a.staff_email)
  )
  select w.staff_email, w.days_absent,
    case when w.period_base > 0 then round(w.period_base / v_div, 2) else 0 end as daily_rate,
    case when w.period_base > 0 then round((w.period_base / v_div) * w.days_absent, 2) else 0 end as amount
  from wage w order by w.staff_email;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_unpaid_leave_deductions(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare
  v_period uuid;
  v_div numeric := pay_v2.unpaid_divisor(p_year, p_month);
  v_on boolean := (select lower(coalesce(value,'off')) in ('on','true','1','yes')
                   from pay_v2.payroll_settings where key='deduct_unpaid_leave');
  v_tf date;
  v_lo date;
  v_mstart date := make_date(p_year, p_month, 1);
  v_cap date := least((make_date(p_year, p_month, 1) + interval '1 month')::date,
                      ((now() at time zone 'Asia/Kuala_Lumpur')::date + 1));  -- elapsed days only
begin
  select id into v_period from pay_v2.periods where year=p_year and month=p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  delete from pay_v2.items i
   where i.period_id=v_period and i.kind='DEDUCT' and upper(coalesce(i.code,''))='UNPAID_LEAVE';

  if coalesce(v_on,false) then
    select track_from into v_tf from public.leave_settings where id=1;
    v_lo := greatest(make_date(p_year,1,1), coalesce(v_tf, make_date(p_year,1,1)));

    with staff_ent as (
      select lower(s.email) as email,
        (case when s.start_date is null then 0
              else greatest(0, floor((least(current_date, make_date(p_year,12,31)) - s.start_date)/365.25))::int end) as years
      from public.staff s
    ),
    ent as (
      select se.email,
        case when se.years>=5 then 16 when se.years>=2 then 12 else 8 end as annual_ent,
        case when se.years>=5 then 22 when se.years>=2 then 18 else 14 end as mc_ent
      from staff_ent se
    ),
    al_ranked as (
      select lower(ds.staff_email) as email, ds.day,
        row_number() over (partition by lower(ds.staff_email) order by ds.day) as rn
      from public.day_status ds
      where ds.status='OFFDAY' and not coalesce(ds.paid_override,false)
        and ds.day >= v_lo and ds.day < v_cap and extract(dow from ds.day) <> 0
        and not exists (select 1 from public.public_holidays ph
          where (case when ph.handling='swap' and ph.swap_to_date is not null then ph.swap_to_date else ph.holiday_date end) = ds.day)
    ),
    mc_ranked as (
      select lower(ds.staff_email) as email, ds.day,
        row_number() over (partition by lower(ds.staff_email) order by ds.day) as rn
      from public.day_status ds
      where ds.status='MC' and not coalesce(ds.paid_override,false)
        and ds.day >= v_lo and ds.day < v_cap and extract(dow from ds.day) <> 0
        and not exists (select 1 from public.public_holidays ph
          where (case when ph.handling='swap' and ph.swap_to_date is not null then ph.swap_to_date else ph.holiday_date end) = ds.day)
    ),
    unpaid_days as (
      select e.email,
        (select count(*) from al_ranked a where a.email=e.email and a.day >= v_mstart and a.day < v_cap and a.rn > e.annual_ent)
        + (select count(*) from mc_ranked m where m.email=e.email and m.day >= v_mstart and m.day < v_cap and m.rn > e.mc_ent) as days
      from ent e
    ),
    base as (
      select lower(i.staff_email) as email, sum(i.amount)::numeric as base_amt
      from pay_v2.items i
      where i.period_id=v_period and i.kind='EARN' and upper(coalesce(i.code,''))='BASE'
      group by lower(i.staff_email)
    ),
    staff_src as (
      select lower(s.email) as email, coalesce(s.basic_salary,0)::numeric as staff_basic
      from public.staff s where s.include_in_payroll=true and s.skip_payroll=false
    ),
    calc as (
      select ud.email, ud.days, coalesce(b.base_amt, ss.staff_basic, 0)::numeric as period_base
      from unpaid_days ud
      left join base b on b.email=ud.email
      left join staff_src ss on ss.email=ud.email
      where ud.days > 0
    )
    insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
    select v_period, c.email, 'DEDUCT','UNPAID_LEAVE','Unpaid leave — over quota', round(c.period_base / v_div * c.days, 2)
    from calc c
    join public.staff s on lower(s.email)=c.email
    where c.period_base > 0
      and public.is_staff_active_for_period(c.email, p_year, p_month)
      and coalesce(s.salary_based_on_attendance, true) = true
      and round(c.period_base / v_div * c.days, 2) > 0;
  end if;

  perform pay_v2.recalc_statutories(p_year, p_month);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_ph_work_earnings(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid; v_div numeric := pay_v2.unpaid_divisor(p_year, p_month);
begin
  select id into v_period from pay_v2.periods where year=p_year and month=p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  delete from pay_v2.items i
  where i.period_id = v_period and i.kind='EARN' and upper(coalesce(i.code,''))='PH_WORK';

  with open_dates as (
    select distinct (case when ph.handling='swap' and ph.swap_to_date is not null
                          then ph.swap_to_date else ph.holiday_date end) as day
    from public.public_holidays ph where ph.handling = 'open'
  ),
  worked as (
    select lower(d.staff_email) as staff_email, count(*)::int as days
    from att_v2.daily d
    join open_dates od on od.day = d.day
    where d.status = 'PRESENT'
      and d.day >= make_date(p_year,p_month,1)
      and d.day <  (make_date(p_year,p_month,1) + interval '1 month')
    group by lower(d.staff_email)
  ),
  elig as (
    select w.staff_email, w.days from worked w
    where public.is_staff_active_for_period(w.staff_email, p_year, p_month)
  ),
  base as (
    select lower(i.staff_email) as staff_email, sum(i.amount)::numeric as base_amt
    from pay_v2.items i
    where i.period_id=v_period and i.kind='EARN' and upper(coalesce(i.code,''))='BASE'
    group by lower(i.staff_email)
  ),
  staff_src as (
    select lower(s.email) as staff_email, coalesce(s.basic_salary,0)::numeric as staff_basic
    from public.staff s where s.include_in_payroll=true and s.skip_payroll=false
  ),
  wage as (
    select e.staff_email, e.days, coalesce(b.base_amt, ss.staff_basic, 0)::numeric as period_base
    from elig e
    left join base b on b.staff_email = e.staff_email
    left join staff_src ss on ss.staff_email = e.staff_email
  ),
  calc as (
    select w.staff_email, w.days,
      case when w.period_base > 0 then round((w.period_base / v_div) * 2 * w.days, 2) else 0 end as amount
    from wage w
  )
  insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
  select v_period, c.staff_email, 'EARN', 'PH_WORK', 'Public holiday work', c.amount
  from calc c where c.amount > 0;

  perform pay_v2.recalc_statutories(p_year, p_month);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.sync_punctuality_allowance(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pay_v2', 'att_v2', 'extensions'
AS $function$
declare
  v_period uuid;
  v_on boolean := (select lower(coalesce(value,'off')) in ('on','true','1','yes')
                   from pay_v2.payroll_settings where key='punctuality_enabled');
  v_amount numeric := (select coalesce(nullif(btrim(value),'')::numeric, 0) from pay_v2.payroll_settings where key='punctuality_amount');
  v_max int := (select coalesce(nullif(btrim(value),'')::int, 4) from pay_v2.payroll_settings where key='punctuality_max_late');
begin
  select id into v_period from pay_v2.periods where year=p_year and month=p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;

  delete from pay_v2.items i
   where i.period_id=v_period and i.kind='EARN' and upper(coalesce(i.code,''))='PUNCTUAL';

  if coalesce(v_on,false) and coalesce(v_amount,0) > 0 then
    with late as (
      select lower(d.staff_email) as email, count(*)::int as late_days
      from att_v2.daily d
      where d.status in ('PRESENT','HOME') and coalesce(d.late_min,0) > 0
        and d.day >= make_date(p_year,p_month,1)
        and d.day <  (make_date(p_year,p_month,1) + interval '1 month')
      group by lower(d.staff_email)
    ),
    elig as (
      select lower(s.email) as email
      from public.staff s
      where s.include_in_payroll = true and s.skip_payroll = false
        and coalesce(s.track_attendance, true) = true and not coalesce(s.is_admin, false)
        and public.is_staff_active_for_period(s.email, p_year, p_month)
    )
    insert into pay_v2.items (period_id, staff_email, kind, code, label, amount)
    select v_period, e.email, 'EARN', 'PUNCTUAL', 'Punctuality allowance', round(v_amount, 2)
    from elig e
    left join late l on l.email = e.email
    where coalesce(l.late_days, 0) <= v_max;
  end if;

  perform pay_v2.recalc_statutories_respect_temp(p_year, p_month);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.cleanup_inactive_items(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_period uuid;
begin
  select id into v_period from pay_v2.periods where year=p_year and month=p_month;
  if not found then raise exception 'Period %-% not found', p_year, p_month; end if;
  delete from pay_v2.items i
  where i.period_id = v_period
    and not public.is_staff_active_for_period(i.staff_email, p_year, p_month);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.finalize_period(p_year integer, p_month integer)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
begin
  update pay_v2.periods set status = 'LOCKED'
  where year = p_year and month = p_month and status <> 'LOCKED';
  if not found then raise exception 'No OPEN period %-% to finalize (or already LOCKED).', p_year, p_month; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.lock_period(p_year integer, p_month integer)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update pay_v2.periods set status='LOCKED', locked_at=now()
   where year=p_year and month=p_month returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.unlock_period(p_year integer, p_month integer)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update pay_v2.periods set status='OPEN', locked_at=null
   where year=p_year and month=p_month returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2.items_normalize_kind_code()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
begin
  if new.kind is not null then new.kind := upper(btrim(new.kind)); end if;
  if new.code is not null then new.code := upper(btrim(new.code)); end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION pay_v2._block_items_when_locked()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
declare v_status text;
begin
  select status into v_status from pay_v2.periods where id = coalesce(new.period_id, old.period_id);
  if v_status = 'LOCKED' then
    raise exception 'Period is LOCKED; write blocked' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION pay_v2._on_staff_delete_cleanup()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pay_v2', 'extensions'
AS $function$
begin
  delete from pay_v2.items i using pay_v2.periods p
  where i.staff_email = old.email and i.period_id = p.id and p.status = 'OPEN';
  return null;
end;
$function$;
