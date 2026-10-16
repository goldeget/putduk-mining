begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Pure policy/reference vectors, not a caller-controlled settlement producer.
select is(app_private.funding_exact_composed_speed('[]',10000,array[]::integer[]),array[0::numeric,1::numeric],
 'confirmed ZERO allocation removes only composed BASE speed');
select is(app_private.funding_exact_composed_speed('[{"allocationBps":"10000","multiplierBps":"10000"}]',10000,array[]::integer[]),
 array[1::numeric,1::numeric],'neutral confirmed full allocation is exact1x');
select is(app_private.funding_exact_composed_speed('[{"allocationBps":"5000","multiplierBps":"11000"}]',12000,array[12500]),
 array[33::numeric,40::numeric],'partial global product weight precedes common modifiers and final cap:0.825');
select is(app_private.funding_exact_composed_speed('[{"allocationBps":"10000","multiplierBps":"11000"}]',12000,array[12500,12500]),
 array[3::numeric,2::numeric],'all common speed modifiers multiply before one global1.50 ceiling');
select is(app_private.funding_exact_composed_speed('[{"allocationBps":"5000","multiplierBps":"9000"},{"allocationBps":"5000","multiplierBps":"11000"}]',
 10000,array[]::integer[]),array[1::numeric,1::numeric],'multiple product weights form one global speed and never duplicate capacity');
select throws_ok($$select app_private.funding_exact_composed_speed('[{"allocationBps":"5000","multiplierBps":"10000"},{"allocationBps":"5000","multiplierBps":"10000"},{"allocationBps":"5000","multiplierBps":"10000"}]',
 10000,array[]::integer[])$$,'22023','FUNDING_SPEED_INPUT_INVALID','allocation sum cannot exceed100%');
select throws_ok($$select app_private.funding_exact_composed_speed('[{"allocationBps":"10000","multiplierBps":"12000"}]',10000,array[]::integer[])$$,
 '22023','FUNDING_SPEED_INPUT_INVALID','illustrative product1.20 never extends approved product1.10 limit');
select throws_ok($$select app_private.funding_exact_composed_speed('[]',13000,array[]::integer[])$$,
 '22023','FUNDING_SPEED_INPUT_INVALID','combined ceiling never admits an individually unapproved user override');
select throws_ok($$select app_private.funding_exact_composed_speed('[]',10000,array[12600])$$,
 '22023','FUNDING_SPEED_INPUT_INVALID','combined ceiling never admits an individually unapproved campaign');
select throws_ok($$select app_private.funding_exact_composed_speed('[{"allocationBps":10000,"multiplierBps":"10000"}]',10000,array[]::integer[])$$,
 '22023','FUNDING_SPEED_INPUT_INVALID','numeric JSON is not silently coerced into immutable string inputs');

select is(app_private.funding_exact_forward_capacity(15000,1,15000,1,30000,1,10,30),array[20000::numeric,1::numeric],
 'day20 deposit adds only new-minus-old entitlement for remaining10days');
select is(app_private.funding_exact_forward_capacity(15000,1,15000,1,30000,1,1,30),array[15500::numeric,1::numeric],
 'late credit never grants a whole30day capacity');
select is(app_private.funding_exact_forward_capacity(15000,1,15000,1,0,1,10,30),array[10000::numeric,1::numeric],
 'principal decrease preserves already elapsed entitlement instead of resetting the cycle');
select is(app_private.funding_exact_forward_capacity(18000,1,15000,1,30000,1,10,30),array[23000::numeric,1::numeric],
 'successive boundaries build on accepted effective capacity without duplicating original full entitlement');
select is(app_private.funding_exact_forward_capacity(10000,1,15000,1,15001,1,1,3),array[30001::numeric,3::numeric],
 'capacity boundary keeps fractional KRW exactly');
select throws_ok($$select app_private.funding_exact_forward_capacity(15000,1,15000,1,30000,1,31,30)$$,
 '22023','FUNDING_CAPACITY_BOUNDARY_INVALID','retroactive remaining window cannot exceed its immutable cycle');

create temporary table exact_boundary(calculation jsonb);
insert into exact_boundary values(app_private.funding_exact_forward_interval(100000,1500,1500,
 2592000000000,2199744000,1,1,15000,1,15000,1,0,1,0,1,0,1,0,1));
select is((select calculation->>'amountAtomic' from exact_boundary),'12','exact12.73 accepts only12 whole KRW');
select ok((select calculation->>'carryNum'='73' and calculation->>'carryDen'='100' from exact_boundary),
 'exact0.73 carry survives accepted interval without rounding or discard');
select is(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,216000000,
 1,1,15000,1,15000,1,0,1,0,1,73,100,0,1)->>'amountAtomic','1',
 'next exact1.25 combines with prior0.73 before whole-KRW settlement');
select is(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,216000000,
 1,1,15000,1,15000,1,0,1,0,1,73,100,0,1)->>'carryNum','49',
 'next0.98 carry is reduced exactly49/50');
update exact_boundary set calculation=app_private.funding_exact_forward_interval(100000,1500,1500,
 2592000000000,86400000000,33,40,15000,1,15000,1,0,1,0,1,0,1,0,1);
select ok((select calculation->>'baseNum'='825' and calculation->>'baseDen'='2' from exact_boundary),
 'reference partial0.825 gives exactly412.5BASE/day');
select is((select calculation->>'conditionalRetentionNum' from exact_boundary),'500',
 'partial allocation and composed speed leave independent maintenance500/day');
select is(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,86400000000,
 3,2,15000,1,15000,1,0,1,0,1,0,1,0,1)->>'baseNum','750','final1.50speed advances BASE only');
select is(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,86400000000,
 3,2,18000,1,15000,1,0,1,0,1,0,1,0,1)->>'conditionalRetentionNum','500',
 'explicit BASE capacity increase cannot boost maintenance');
select is(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,86400000000,
 0,1,15000,1,15000,1,0,1,0,1,0,1,0,1)->>'conditionalRetentionNum','500',
 'ZERO BASE allocation still accrues eligible maintenance independently');
select is(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,86400000000,
 3,2,200,1,15000,1,200,1,0,1,73,100,0,1)->>'baseNum','0',
 'speed boost does not reopen exhausted capacity or reset used');
select ok((select c->>'amountAtomic'='300' and c->>'baseUsedNum'='500' and c->>'carryNum'='73'
 from(select app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,86400000000,
 3,2,500,1,15000,1,200,1,0,1,73,100,0,1)c) q),
 'real capacity increase resumes only remaining300 with used and prior0.73 preserved');
select throws_ok($$select app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,86400000000,
 1,1,15000,1,15000,1,0,1,0,1,0,1,501,1)$$,'22023','FUNDING_RETENTION_QUALIFICATION_INVALID',
 'arithmetic cannot claim more qualified maintenance than actually accrued');
select ok(not has_function_privilege('authenticated','app_private.funding_exact_composed_speed(jsonb,integer,integer[])','EXECUTE')
 and not has_function_privilege('anon','app_private.funding_exact_forward_capacity(numeric,numeric,numeric,numeric,numeric,numeric,bigint,bigint)','EXECUTE'),
 'private calculation does not create a client reward or time authority');

select finish();
rollback;
