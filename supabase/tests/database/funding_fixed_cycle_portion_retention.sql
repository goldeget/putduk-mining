begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Synthetic arithmetic vectors, not backdated sealed source or mature payout proof.
select is(app_private.funding_portion_cycle_retention(700000000000,1500,2592000000000,2592000000000,true),array[105000::numeric,1::numeric],
 '700k available throughout fixed 30 days earns exact approved 15% retention');
select is(app_private.funding_portion_cycle_retention(300000000000,1500,2332800000000,2592000000000,true),array[40500::numeric,1::numeric],
 '300k held for three days retains old age, excludes held time and receives 27/30 proration');
select is(app_private.funding_portion_cycle_retention(300000000000,1500,1728000000000,2592000000000,false),array[0::numeric,1::numeric],
 'terminal HOLD portion is excluded even though it had 20 earlier eligible days');
select is(app_private.funding_portion_cycle_retention(300000000000,1500,86400000000,2592000000000,true),array[1500::numeric,1::numeric],
 'release in next cycle receives only next-cycle eligible time, with no previous-cycle catchup');
select is(app_private.funding_portion_cycle_retention(1,1500,1,2592000000000,true),array[1::numeric,17280000000000000000::numeric],
 'sub-KRW principal and microsecond proration retain exact rational precision');
select throws_ok($$select app_private.funding_portion_cycle_retention(300000000000,1500,2592000000001,2592000000000,true)$$,
 '22023','FUNDING_PORTION_RETENTION_INVALID','lifetime age cannot be reused as this-cycle qualification');
select throws_ok($$select app_private.funding_portion_cycle_retention(300000000000,1500,-1,2592000000000,true)$$,
 '22023','FUNDING_PORTION_RETENTION_INVALID','negative eligible time is rejected');
select throws_ok($$select app_private.funding_portion_cycle_retention(300000000000,1500,1,2592000000000,null)$$,
 '22023','FUNDING_PORTION_RETENTION_INVALID','unknown terminal status cannot silently qualify');
create temporary table retention_kernel(x jsonb);
insert into retention_kernel values(app_private.funding_exact_forward_interval(100000,1500,1500,2592000000000,216000000,
 1,1,15000,1,15000,1,0,1,0,1,73,100,0,1));
select is((select app_private.funding_exact_retention_terminal_overlay(x,73,100,51,100,1,1)->>'amountAtomic' from retention_kernel),'2',
 'incoming 0.73 plus base 1.25 plus qualified 0.51 floors once to two KRW');
select is((select app_private.funding_exact_retention_terminal_overlay(x,73,100,51,100,1,1)->>'carryNum' from retention_kernel),'49',
 'terminal result preserves exact remaining 49/100 carry');
select is((select app_private.funding_exact_retention_terminal_overlay(x,73,100,51,100,1,1)->>'carryDen' from retention_kernel),'100',
 'terminal carry denominator is normalized');
select is((select app_private.funding_exact_retention_terminal_overlay(x,73,100,0,1,1,1)-array['qualifiedRetentionNum','qualifiedRetentionDen','amountAtomic','carryNum','carryDen','retentionTerminalContractVersion']
 = x-array['qualifiedRetentionNum','qualifiedRetentionDen','amountAtomic','carryNum','carryDen'] from retention_kernel),true,
 'terminal qualification never rescales prior capacity or used economics');
select throws_ok($$select app_private.funding_exact_retention_terminal_overlay(x,0,1,0,1,1,1) from retention_kernel$$,
 '22023','FUNDING_RETENTION_INCOMING_CARRY_MISMATCH','outgoing carry cannot be mistaken for incoming carry');
select throws_ok($$select app_private.funding_exact_retention_terminal_overlay(x,73,100,2,1,1,1) from retention_kernel$$,
 '22023','FUNDING_RETENTION_COMPONENT_TOTAL_INVALID','qualification cannot exceed source components');
select throws_ok($$select app_private.funding_exact_retention_terminal_overlay(x||'{"qualifiedRetentionNum":"1"}',73,100,1,1,1,1) from retention_kernel$$,
 '22023','FUNDING_RETENTION_UNQUALIFIED_CALCULATION_REQUIRED','an already-qualified kernel cannot be qualified a second time');
select ok(not has_function_privilege('authenticated','app_private.funding_portion_cycle_retention(bigint,integer,bigint,bigint,boolean)','EXECUTE')
 and not has_function_privilege('anon','app_private.funding_exact_retention_terminal_overlay(jsonb,numeric,numeric,numeric,numeric,numeric,numeric)','EXECUTE'),
 'private formula cannot act as browser money or time authority');
select * from finish();
rollback;
