-- =============================================================================
-- PROPOSED PAYROLL FIXES — attendance-web (Supabase naefauflkisldxftxuhq)
-- Prepared 2026-08-16 by the payroll correctness audit. READY-TO-REVIEW ONLY.
--
--   *** NOTHING HERE HAS BEEN APPLIED. The owner applies it, when he chooses. ***
--
-- Read the audit (PAYROLL-CORRECTNESS-AUDIT.md) for the why. Each section is
-- independent and reversible. Review, then run the sections you want, in order.
-- No historical remediation is needed (the commission in the DB was unpaid test
-- data) — these are FORWARD-LOOKING corrections, each with its own deadline.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §1  COMMISSION must be statutory-subject   ***APPLY BEFORE THE FIRST REAL
--     COMMISSION PAYMENT***  (harmless today because no commission is paid yet;
--     the day a real commission is paid, leaving this unset silently
--     under-contributes EPF/SOCSO/EIS on every such payment).
-- Effect: future period builds/recalcs will include COMM in the EPF/SOCSO/EIS
-- wage base. Existing LOCKED test periods are unaffected unless unlocked+rebuilt.
-- -----------------------------------------------------------------------------
update pay_v2.payroll_item_types
   set stat_epf = true, stat_socso = true, stat_eis = true
 where upper(code) = 'COMM';

-- Verify:
-- select code, stat_epf, stat_socso, stat_eis from pay_v2.payroll_item_types where code='COMM';

-- ADVISORY (NOT changed here — decide with your accountant when you first USE them):
-- Under Malaysian rules the other earning codes are NOT all alike —
--   EPF+SOCSO+EIS subject (like COMM): ALLOW, INCENTIVE, ATT_ALLOW, HOUSING_ALLOW,
--       MEAL_ALLOW, ADDITIONAL_SALARY, ARREARS_SALARY  (cash allowances/incentives are wages)
--   EPF-subject but SOCSO/EIS-EXEMPT: BONUS (annual bonus is excluded from SOCSO/EIS wages)
--   EXEMPT from all three: OT (overtime), TRAVEL_ALLOW (travelling allowance)
-- These are currently all stat=false and UNUSED (no items posted), so they are
-- harmless now — but set each correctly before its first real use.


-- -----------------------------------------------------------------------------
-- §2  EIS band table: extend ceiling RM5,000 -> RM6,000 (legal since 1 Oct 2024)
--     ***APPLY BEFORE ANY EIS-ENABLED EMPLOYEE EARNS > RM5,000***
--     (no current victim: every EIS-enabled employee earns <= RM4,000 today).
--
--     NB the values for bands 55-65 below are COMPUTED from the confirmed method
--     (0.2% of each RM100 band midpoint; top band RM11.90 confirmed by PERKESO).
--     The official Act 800 schedule PDF is a scanned image that could not be read
--     line-by-line this session — *** verify the 11 amounts below against the
--     official EIS Jadual before applying. ***  Bands 1-54 already match official.
-- -----------------------------------------------------------------------------
begin;

  -- was (55, 5000, NULL, 9.90, 9.90) -- the old open-ended top band at the RM5,000 cap
  update pay_v2.ref_eis_bands
     set max_wage = 5100, emp_amount = 10.10, er_amount = 10.10
   where id = 55;

  insert into pay_v2.ref_eis_bands (id, min_wage, max_wage, emp_amount, er_amount) values
    (56, 5100, 5200, 10.30, 10.30),
    (57, 5200, 5300, 10.50, 10.50),
    (58, 5300, 5400, 10.70, 10.70),
    (59, 5400, 5500, 10.90, 10.90),
    (60, 5500, 5600, 11.10, 11.10),
    (61, 5600, 5700, 11.30, 11.30),
    (62, 5700, 5800, 11.50, 11.50),
    (63, 5800, 5900, 11.70, 11.70),
    (64, 5900, 6000, 11.90, 11.90),
    (65, 6000, null, 11.90, 11.90);  -- open-ended top band at the RM6,000 cap

  -- Verify before COMMIT (should show 65 rows; top band 11.90/11.90; ceiling 6000):
  -- select count(*) from pay_v2.ref_eis_bands;                 -- expect 65
  -- select * from pay_v2.ref_eis_bands where id >= 54 order by id;

commit;   -- <- change to ROLLBACK; while reviewing


-- -----------------------------------------------------------------------------
-- §3  Fix the EPF-rate default-scale landmine (housekeeping; no live effect today)
--     salary_profiles defaults 11/13 (=1100%/1300%) while staff defaults 0.11/0.13.
--     Neither column is read by the engine (rates are hardcoded), and every
--     existing row already stores 0.11/0.13 — but a NEW salary_profiles row with
--     no explicit rate would inherit 11. Align the default to the fraction scale.
-- -----------------------------------------------------------------------------
alter table public.salary_profiles alter column epf_rate_employee set default 0.11;
alter table public.salary_profiles alter column epf_rate_employer set default 0.13;

-- Optional (more decisive): if you confirm these per-staff rate columns will never
-- be used, drop the dead columns instead, on BOTH tables, so no one can wire them
-- in by mistake:
--   alter table public.salary_profiles drop column epf_rate_employee, drop column epf_rate_employer;
--   alter table public.staff           drop column epf_rate_employee, drop column epf_rate_employer;
-- (Leave commented until you have decided.)

-- =============================================================================
-- END. Not applied. See PAYROLL-CORRECTNESS-AUDIT.md for context and severity.
-- =============================================================================
