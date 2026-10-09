begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Reference arithmetic only: these are calculator inputs, not monetary command
-- arguments or approved product allocations/catalogs.
select is(app_private.funding_exact_ratio(1273,100)::text,'{1273,100}','12.73 stays exact');
select is(app_private.funding_exact_ratio(0,999)::text,'{0,1}','zero has canonical denominator');
select is(app_private.funding_exact_sum(array[1::numeric,3],array[2::numeric,3])::text,'{1,1}','addition normalizes without rounding');
select throws_ok($$select app_private.funding_exact_ratio(0.1,1)$$,'22023','FUNDING_EXACT_RATIO_INVALID','fractional numerator fails');
select throws_ok($$select app_private.funding_exact_ratio(1,0)$$,'22023','FUNDING_EXACT_RATIO_INVALID','zero denominator fails');
select throws_ok($$select app_private.funding_exact_ratio('NaN',1)$$,'22023','FUNDING_EXACT_RATIO_INVALID','NaN fails');
select throws_ok($$select app_private.funding_exact_ratio('Infinity',1)$$,'22023','FUNDING_EXACT_RATIO_INVALID','infinity fails');
create temporary table math_ctx(first jsonb,split_first jsonb,split_second jsonb,full_cycle jsonb);
insert into math_ctx(first,split_first,full_cycle) values(
 app_private.funding_exact_default_interval(100000,1500,1500,10000,2592000000000,2199744000,0,1,0,1,0,1,false),
 app_private.funding_exact_default_interval(100000,1500,1500,10000,2592000000000,1099872000,0,1,0,1,0,1,false),
 app_private.funding_exact_default_interval(100000,1500,1500,10000,2592000000000,2592000000000,0,1,0,1,0,1,true));
update math_ctx set split_second=app_private.funding_exact_default_interval(100000,1500,1500,10000,2592000000000,1099872000,
 (split_first->>'baseUsedNum')::numeric,(split_first->>'baseUsedDen')::numeric,
 (split_first->>'retentionUsedNum')::numeric,(split_first->>'retentionUsedDen')::numeric,
 (split_first->>'carryNum')::numeric,(split_first->>'carryDen')::numeric,false);
select is((select first->>'amountAtomic' from math_ctx),'12','12.73 posts only twelve whole KRW');
select is((select first->>'carryNum' from math_ctx),'73','73 cents of KRW numerator preserved');
select is((select first->>'carryDen' from math_ctx),'100','73/100 exact carry preserved');
select is((select first->>'baseNum' from math_ctx),'1273','base earned exact numerator');
select is((select first->>'conditionalRetentionNum' from math_ctx),'1273','retention conditional amount remains distinct');
select is((select first->>'qualifiedRetentionNum' from math_ctx),'0','ordinary interval does not credit conditional retention');
select is((select ((split_first->>'amountAtomic')::bigint+(split_second->>'amountAtomic')::bigint)::text from math_ctx),'12','split intervals preserve total whole reward');
select is((select split_second->>'carryNum' from math_ctx),'73','split intervals preserve exact carry numerator');
select is((select split_second->>'carryDen' from math_ctx),'100','split intervals preserve exact carry denominator');
select is((select split_second->>'baseUsedNum' from math_ctx),(select first->>'baseUsedNum' from math_ctx),'used is interval-independent');
select is((select full_cycle->>'amountAtomic' from math_ctx),'30000','full never-held cycle credits base and qualified retention once');
select is((select full_cycle->>'qualifiedRetentionNum' from math_ctx),'15000','retention qualification keeps separate original');
select is(app_private.funding_exact_default_interval(100000,1500,1500,5000,100,100,0,1,0,1,0,1,true)->>'amountAtomic','22500','reference allocation weights BASE only; principal-based maintenance is independent');
select is(app_private.funding_exact_default_interval(100000,1500,1500,5000,100,100,0,1,0,1,0,1,true)->>'qualifiedRetentionNum','15000',
 'reference BASE allocation does not reduce or expand maintenance benefit');
select is(app_private.funding_exact_default_interval(100000,1500,1500,10000,100,100,14999,1,14999,1,0,1,false)->>'baseNum','1','base caps against existing global used');
select is(app_private.funding_exact_default_interval(100000,1500,1500,10000,100,100,16000,1,16000,1,0,1,false)->>'baseNum','0','capacity downgrade never rewinds used');
select throws_ok($$select app_private.funding_exact_default_interval(100000,1500,1500,10001,100,1,0,1,0,1,0,1,false)$$,
 '22023','FUNDING_DEFAULT_INTERVAL_INVALID','allocation beyond one global principal fails');
select throws_ok($$select app_private.funding_exact_default_interval(100000,1500,1500,10000,100,101,0,1,0,1,0,1,false)$$,
 '22023','FUNDING_DEFAULT_INTERVAL_INVALID','interval beyond one cycle fails');
select throws_ok($$select app_private.funding_exact_default_interval(100000,1500,1500,10000,100,1,0,1,0,1,1,1,false)$$,
 '22023','FUNDING_CARRY_INVALID','whole KRW is not allowed in carry');
select throws_ok($$select app_private.funding_exact_default_interval(9223372036854775807,10000,10000,10000,100,100,0,1,0,1,0,1,true)$$,
 '22003','FUNDING_WHOLE_KRW_OVERFLOW','combined whole credit overflow fails closed');
select ok(not has_function_privilege('anon','app_private.funding_exact_default_interval(bigint,integer,integer,integer,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,boolean)','EXECUTE')
 and not has_function_privilege('authenticated','app_private.funding_exact_default_interval(bigint,integer,integer,integer,bigint,bigint,numeric,numeric,numeric,numeric,numeric,numeric,boolean)','EXECUTE'),
 'financial formula stays server-only');
select * from finish();
rollback;
