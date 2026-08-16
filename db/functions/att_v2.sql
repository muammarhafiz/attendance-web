-- BACKUP: att_v2 schema functions (the attendance engine) — verbatim from naefauflkisldxftxuhq, 2026-08-16.
-- Source of truth is the live DB / a fresh `supabase db dump`. This is a point-in-time capture.
-- Depends on: att_v2.events, att_v2.daily, public.config (geofence id=1), public.staff, public.day_status,
--             public.day_half, public.day_time_override, public.public_holidays, auth.email().

CREATE OR REPLACE FUNCTION att_v2._whoami_email()
 RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'att_v2', 'extensions'
AS $function$
  select lower(auth.email());
$function$;

CREATE OR REPLACE FUNCTION att_v2._norm_action(a text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'att_v2', 'extensions'
AS $function$
  select lower(replace(replace(coalesce(a,''),'-',''),' ',''));
$function$;

CREATE OR REPLACE FUNCTION att_v2._get_geofence()
 RETURNS TABLE(workshop_lat double precision, workshop_lon double precision, radius_m integer)
 LANGUAGE sql STABLE SET search_path TO 'public', 'att_v2', 'extensions'
AS $function$
  select c.workshop_lat, c.workshop_lon, c.radius_m
  from public.config c
  where c.id = 1
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION att_v2._distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
 RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'att_v2', 'extensions'
AS $function$
  with r as (select 6371000.0::double precision as R),   -- Earth radius (m)
  d as (
    select
      radians(lat2 - lat1) as dlat,
      radians(lon2 - lon1) as dlon,
      radians(lat1) as rlat1,
      radians(lat2) as rlat2
  )
  select round(
    (select R from r) * 2 * asin(
      sqrt(
        sin(d.dlat/2)^2 +
        cos(d.rlat1) * cos(d.rlat2) * sin(d.dlon/2)^2
      )
    )
  )::int
  from d;
$function$;

CREATE OR REPLACE FUNCTION att_v2.check_in(p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision, p_note text DEFAULT NULL::text)
 RETURNS att_v2.daily LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'att_v2'
AS $function$
declare
  v_email  text := att_v2._whoami_email();
  v_today  date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_lat    double precision;
  v_lon    double precision;
  v_center_lat double precision;
  v_center_lon double precision;
  v_radius integer;
  v_dist   integer;
  v_row    att_v2.daily;
begin
  if v_email is null then
    raise exception 'Unauthenticated';
  end if;

  select workshop_lat, workshop_lon, radius_m
  into v_center_lat, v_center_lon, v_radius
  from att_v2._get_geofence();

  v_lat := p_lat; v_lon := p_lon;
  if v_lat is not null and v_lon is not null then
    v_dist := att_v2._distance_m(v_lat, v_lon, v_center_lat, v_center_lon);
    if v_radius is not null and v_dist > v_radius then
      raise exception 'Outside geofence (% m > % m)', v_dist, v_radius;
    end if;
  end if;

  insert into att_v2.events (staff_email, action, ts, lat, lon, distance_m, client_tz, note)
  values (v_email, 'Check-in', now(), v_lat, v_lon, v_dist, 'Asia/Kuala_Lumpur', p_note)
  on conflict do nothing;

  perform att_v2.recompute_daily_for(v_today, time '10:30');

  select d.* into v_row
  from att_v2.daily d
  where d.staff_email = v_email and d.day = v_today;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION att_v2.check_out(p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision, p_note text DEFAULT NULL::text)
 RETURNS att_v2.daily LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'att_v2'
AS $function$
declare
  v_email  text := att_v2._whoami_email();
  v_today  date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_lat    double precision;
  v_lon    double precision;
  v_center_lat double precision;
  v_center_lon double precision;
  v_radius integer;
  v_dist   integer;
  v_row    att_v2.daily;
begin
  if v_email is null then
    raise exception 'Unauthenticated';
  end if;

  select workshop_lat, workshop_lon, radius_m
  into v_center_lat, v_center_lon, v_radius
  from att_v2._get_geofence();

  v_lat := p_lat; v_lon := p_lon;
  if v_lat is not null and v_lon is not null then
    v_dist := att_v2._distance_m(v_lat, v_lon, v_center_lat, v_center_lon);
    if v_radius is not null and v_dist > v_radius then
      raise exception 'Outside geofence (% m > % m)', v_dist, v_radius;
    end if;
  end if;

  insert into att_v2.events (staff_email, action, ts, lat, lon, distance_m, client_tz, note)
  values (v_email, 'Check-out', now(), v_lat, v_lon, v_dist, 'Asia/Kuala_Lumpur', p_note)
  on conflict do nothing;

  perform att_v2.recompute_daily_for(v_today, time '10:30');

  select d.* into v_row
  from att_v2.daily d
  where d.staff_email = v_email and d.day = v_today;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION att_v2.recompute_daily_for(p_day date, p_cutoff time without time zone DEFAULT '10:30:00'::time without time zone)
 RETURNS integer LANGUAGE plpgsql SET search_path TO 'public', 'att_v2', 'extensions'
AS $function$
declare
  v_rows int := 0;
  v_is_ph boolean := exists(
    select 1 from public.public_holidays ph
    where (case when ph.handling = 'swap' and ph.swap_to_date is not null then ph.swap_to_date else ph.holiday_date end) = p_day
  );
begin
  with base_emails as (
    select distinct e.staff_email from att_v2.events e where e.day = p_day
    union
    select distinct s.email from public.staff s
    where s.archived_at is null and coalesce(s.track_attendance, true)
  ),
  first_in as (
    select e.staff_email, min((e.ts at time zone 'Asia/Kuala_Lumpur')::time) as check_in_kl,
           (array_agg(e.id order by e.ts asc))[1] as first_event_id
    from att_v2.events e
    where e.day = p_day and att_v2._norm_action(e.action) in ('in','checkin')
    group by e.staff_email
  ),
  last_out as (
    select e.staff_email, max((e.ts at time zone 'Asia/Kuala_Lumpur')::time) as check_out_kl,
           (array_agg(e.id order by e.ts asc))[array_length(array_agg(e.id order by e.ts asc),1)] as last_event_id
    from att_v2.events e
    where e.day = p_day and att_v2._norm_action(e.action) in ('out','checkout')
    group by e.staff_email
  ),
  computed as (
    select b.staff_email, p_day as day,
      coalesce(dto.check_in_kl, fi.check_in_kl) as check_in_kl,
      coalesce(dto.check_out_kl, lo.check_out_kl) as check_out_kl,
      case
        when coalesce(dto.check_in_kl, fi.check_in_kl) is not null then 'PRESENT'
        when coalesce(st.weekly_schedule ->> ((extract(dow from p_day))::int::text), 'workshop') = 'home' then 'HOME'
        when coalesce(st.weekly_schedule ->> ((extract(dow from p_day))::int::text), 'workshop') = 'off'  then 'OFF'
        when v_is_ph then 'PH'
        else 'ABSENT'
      end as status,
      (case when dh.half = 'PM' then time '13:30' else coalesce(st.work_start_time, time '09:30') end) as start_threshold,
      fi.first_event_id, lo.last_event_id, dh.half
    from base_emails b
    left join first_in fi on fi.staff_email = b.staff_email
    left join last_out lo on lo.staff_email = b.staff_email
    left join public.staff st on lower(st.email) = lower(b.staff_email)
    left join public.day_half dh on lower(dh.staff_email) = lower(b.staff_email) and dh.day = p_day
    left join public.day_time_override dto on dto.staff_email = b.staff_email and dto.day = p_day
  ),
  with_status as (
    select c.staff_email, c.day, coalesce(ds.status, c.status) as status,
      c.check_in_kl, c.check_out_kl, c.start_threshold, c.first_event_id, c.last_event_id, c.half
    from computed c
    left join public.day_status ds on ds.staff_email = c.staff_email and ds.day = c.day
  )
  insert into att_v2.daily as d (staff_email, day, status, check_in_kl, check_out_kl, late_min, first_event_id, last_event_id, half)
  select staff_email, day, status, check_in_kl, check_out_kl,
    greatest(0, coalesce(extract(epoch from (check_in_kl - start_threshold)) / 60, 0))::int as late_min,
    first_event_id, last_event_id, half
  from with_status
  on conflict (staff_email, day) do update
    set status=excluded.status, check_in_kl=excluded.check_in_kl, check_out_kl=excluded.check_out_kl,
        late_min=excluded.late_min, first_event_id=excluded.first_event_id, last_event_id=excluded.last_event_id,
        half=excluded.half;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $function$;
