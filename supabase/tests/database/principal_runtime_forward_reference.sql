begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
-- Independent approved vectors for the new133 principal cutover. This test
-- covers arithmetic only; runtime integration is a separate actual SQL gate.
-- Source: approval10-03 remaining-window difference; followup10-06 BASE-only
-- allocation, independent eligible-principal maintenance, pause/no retro/reset.
-- At day15, 1m ->700k crosses L3(1700ret) ->L2(1600ret), neutral50% allocation.
select is(app_private.funding_exact_forward_capacity(150000,1,150000,1,105000,1,15,30),
 array[127500::numeric,1::numeric],'HOLD removes only45k BASE full-window entitlement times remaining15/30');
select is(app_private.funding_exact_forward_capacity(170000,1,170000,1,112000,1,15,30),
 array[141000::numeric,1::numeric],'maintenance capacity changes separately by actual remaining tier rule');
-- At day18 release resumes prospectively. It never restores the3 held days.
select is(app_private.funding_exact_forward_capacity(127500,1,105000,1,150000,1,12,30),
 array[145500::numeric,1::numeric],'release adds18k BASE from remaining12/30 only');
select is(app_private.funding_exact_forward_capacity(141000,1,112000,1,170000,1,12,30),
 array[164200::numeric,1::numeric],'release adds23.2k independent maintenance from remaining12/30 only');
select is(app_private.funding_exact_forward_capacity(127500,1,105000,1,150000,1,0,30),
 array[127500::numeric,1::numeric],'cycle-end release cannot fabricate a complete new30-day capacity');
select is(app_private.funding_exact_forward_capacity(150000,1,150000,1,150000,1,15,30),
 array[150000::numeric,1::numeric],'allocation-only change has no principal capacity effect');

create temporary table reference_interval(result jsonb);
-- Exact3-day interval for remaining700k, neutral50% BASE, carry0.73.
-- Prior day15 BASEused37500 and maintenanceused85000 remain untouched inputs.
insert into reference_interval values(app_private.funding_exact_forward_interval(700000,1500,1600,30,3,
 1,2,127500,1,141000,1,37500,1,85000,1,73,100,0,1));
select is((select result->>'baseNum' from reference_interval),'5250','partial allocation BASE for3days is independently5250');
select is((select result->>'conditionalRetentionNum' from reference_interval),'11200',
 'eligible principal maintenance for3days is11200 independent of50% allocation');
select is((select result->>'baseUsedNum' from reference_interval),'42750','prior BASEused survives HOLD boundary');
select is((select result->>'retentionUsedNum' from reference_interval),'96200','prior conditional maintenance survives HOLD boundary');
select is((select result->>'amountAtomic' from reference_interval),'5250','only new whole BASE credits; conditional maintenance is excluded');
select is((select result->>'carryNum' from reference_interval),'73','preexisting0.73 numerator is preserved');
select is((select result->>'carryDen' from reference_interval),'100','preexisting0.73 exact denominator is preserved');
select is((select result->>'qualifiedRetentionNum' from reference_interval),'0','no held-cycle-end payout decision is inferred');
select is(app_private.funding_exact_forward_interval(700000,1500,1600,30,3,
 1,1,127500,1,141000,1,37500,1,85000,1,73,100,0,1)->>'conditionalRetentionNum','11200',
 'doubling allocation BASEspeed leaves approved maintenance unchanged');
select is(app_private.funding_exact_forward_interval(700000,1500,1600,30,3,
 1,2,140250,1,141000,1,37500,1,85000,1,73,100,0,1)->>'conditionalRetentionNum','11200',
 'explicit BASE capacity increase cannot increase approved maintenance');
select is(app_private.funding_exact_forward_interval(700000,1500,1600,30,0,
 1,2,127500,1,141000,1,37500,1,85000,1,73,100,0,1)->>'amountAtomic','0',
 'GLOBAL excluded elapsed produces no retroactive earning at boundary');
select is(app_private.funding_exact_forward_interval(700000,1500,1600,30,0,
 1,2,127500,1,141000,1,37500,1,85000,1,73,100,0,1)->>'carryNum','73',
 'paused interval preserves accepted fractional carry');
select * from finish();
rollback;
