-- Root-only fresh disposable local fixture AFTER the actually checked77
-- canonical-credit fixture (the existing GLOBAL six-race may run before this).
-- Only one owner-only initiating request is synthetic. There is no principal
-- member command/product claim. No financial original is deleted or rewritten.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok((select coverage='COMPLETE' from public.money_source_summaries
 where user_id='10626100-0000-4000-8000-000000000002'),'canonical source is complete before principal fixture intent');
select ok(exists(select 1 from app_private.funding_engine_activations where user_id='10626100-0000-4000-8000-000000000002' and runtime_version=2),
 'concurrency fixture reuses actual V2 activation');
select ok(not exists(select 1 from public.funding_principal_recovery_allocations where user_id='10626100-0000-4000-8000-000000000002'),
 'concurrency fixture starts without fabricated hold history');
select ok((select count(*) from app_private.funding_principal_portions where user_id='10626100-0000-4000-8000-000000000002' and parent_portion_id is null)
 =(select count(*) from public.funding_principal_lots where user_id='10626100-0000-4000-8000-000000000002'),
 'all genuine canonical credit lots already have immutable original roots');
insert into public.withdrawal_policies(id,currency,destination_type,version,is_enabled,minimum_amount_atomic,
 fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward) values(
 '10630000-0000-4000-8000-000000000001','KRW','KRW_BANK',10630002,true,1,0,'{}',clock_timestamp(),
 '10626100-0000-4000-8000-000000000001',false);
insert into public.withdrawal_destinations(id,user_id,destination_type,encrypted_value,value_fingerprint,
 display_hint,verification_status,verified_at,protection_until) values(
 '10630000-0000-4000-8000-000000000002','10626100-0000-4000-8000-000000000002','KRW_BANK',
 decode(repeat('ac',32),'hex'),encode(extensions.digest('hold-clock-admission-source','sha256'),'hex'),
 'Owner-only principal clock concurrency fixture','VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
insert into public.withdrawal_requests(id,wallet_account_id,withdrawal_policy_id,withdrawal_destination_id,user_id,
 currency,amount_atomic,fee_atomic,destination_type,destination_snapshot,status,idempotency_key)
select '10630000-0000-4000-8000-000000000003',a.id,'10630000-0000-4000-8000-000000000001',
 '10630000-0000-4000-8000-000000000002',a.user_id,'KRW',300000,0,'KRW_BANK',
 jsonb_build_object('destination_id','10630000-0000-4000-8000-000000000002','display','Owner-only principal clock concurrency fixture',
 'verified_at',(select verified_at from public.withdrawal_destinations where id='10630000-0000-4000-8000-000000000002')),
 'REQUESTED','hold-admission-source-request' from public.wallet_accounts a
 where a.user_id='10626100-0000-4000-8000-000000000002' and a.currency='KRW';
select ok((select status='REQUESTED' and hold_ledger_transaction_id is null from public.withdrawal_requests
 where id='10630000-0000-4000-8000-000000000003'),'owner-only intent fixture has no falsely accepted finance or clock');
select ok(not exists(select 1 from public.ledger_transactions where idempotency_key='hold-admission-source-request:hold'),
 'only actual concurrent service kernel may create the financial HOLD original');
create function pg_temp.checked_hold_admission_fixture_finish() returns setof text
language plpgsql security invoker as $$
declare lines text[];
begin
 select array_agg(f.result) into lines from finish() as f(result);
 if lines is distinct from array['1..6']::text[] then
  raise exception using errcode='55000',message='HOLD_ADMISSION_FIXTURE_ASSERTIONS_FAILED'; end if;
 return query select unnest(lines);
end;
$$;
select * from pg_temp.checked_hold_admission_fixture_finish();
commit;
