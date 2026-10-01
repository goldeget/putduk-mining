begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.withdrawal_destination_step_ups'::regclass),'step-up proofs force RLS');
select ok(not has_table_privilege('anon','public.withdrawal_destination_step_ups','SELECT,INSERT,UPDATE,DELETE'),'anonymous has no proof access');
select ok(not has_table_privilege('authenticated','public.withdrawal_destination_step_ups','SELECT,INSERT,UPDATE,DELETE'),'members cannot issue or read proofs directly');
select ok(not has_table_privilege('service_role','public.withdrawal_destination_step_ups','DELETE'),'server cannot delete attempts to reset limits');
select ok(not has_column_privilege('service_role','public.withdrawal_destination_step_ups','expires_at','UPDATE'),'server cannot extend proof expiry');
select ok(not has_column_privilege('service_role','public.withdrawal_destination_step_ups','status','INSERT'),'server cannot skip PENDING admission');
select ok(not exists(select 1 from pg_proc where proname in ('guard_withdrawal_destination_step_up','audit_withdrawal_destination_step_up','authorize_withdrawal_destination_replacement')
  and (prosecdef or not ('search_path=pg_catalog'=any(proconfig)) or has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE'))),'helpers remain fixed-path invoker and service-only');
select is((select count(*)::integer from information_schema.columns where table_name='withdrawal_destination_step_ups' and column_name in ('password','otp','token','address','account_number','email')),0,'no raw credentials or destination material');

create temporary table reauth_ctx(owner_id uuid,other_id uuid,limit_owner uuid,session_id uuid,other_session uuid,grant_id uuid,first_krw uuid,first_usdt uuid,changed uuid);
insert into reauth_ctx values ('dd100000-0000-4000-8000-000000000001','dd100000-0000-4000-8000-000000000002','dd100000-0000-4000-8000-000000000003','dd200000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000002',null,null,null,null);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',id::text || '@reauth.putduk.test','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
from reauth_ctx cross join lateral unnest(array[owner_id,other_id,limit_owner]) as id;
insert into auth.sessions(id,user_id,created_at,updated_at)
select session_id,owner_id,statement_timestamp(),statement_timestamp() from reauth_ctx
union all select other_session,other_id,statement_timestamp(),statement_timestamp() from reauth_ctx;

create function pg_temp.change_destination(p_owner uuid,p_method text,p_token text,p_fingerprint text) returns uuid
language plpgsql as $$ begin
  if p_method='KRW_BANK' then return public.register_krw_bank_destination(p_owner,decode(repeat('ab',32),'hex'),p_fingerprint,'KB ****1234',p_token,gen_random_uuid(),24); end if;
  return public.register_usdt_withdrawal_destination(p_owner,'TRC20','TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234',decode(repeat('ab',32),'hex'),p_fingerprint,'TRC20 TXYZ…1234',p_token,gen_random_uuid(),24);
end $$;
update reauth_ctx set first_krw=pg_temp.change_destination(owner_id,'KRW_BANK',null,repeat('a',64)),first_usdt=pg_temp.change_destination(owner_id,'USDT_ADDRESS',null,repeat('b',64));
select ok((select protection_until <= statement_timestamp() from public.withdrawal_destinations where id=(select first_krw from reauth_ctx)),'first KRW registration needs no extra authentication or cooldown');
select ok((select protection_until <= statement_timestamp() from public.withdrawal_destinations where id=(select first_usdt from reauth_ctx)),'first USDT registration needs no extra authentication or cooldown');
select throws_ok($$select pg_temp.change_destination(owner_id,'KRW_BANK',null,repeat('c',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','missing proof rejects KRW replacement');
select throws_ok($$select pg_temp.change_destination(owner_id,'USDT_ADDRESS','arbitrary-string',repeat('d',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','arbitrary string rejects USDT replacement');
select is((select count(*)::integer from public.withdrawal_destinations where user_id=(select owner_id from reauth_ctx)),2,'denial creates no replacement');

insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select owner_id,session_id,encode(extensions.digest('verified-krw','sha256'),'hex'),'KRW_BANK',repeat('c',64) from reauth_ctx;
update reauth_ctx set grant_id=(select id from public.withdrawal_destination_step_ups where user_id=(select owner_id from reauth_ctx));
select throws_ok($$select pg_temp.change_destination(owner_id,'KRW_BANK','verified-krw',repeat('c',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','unverified PENDING attempt is not authority');
update public.withdrawal_destination_step_ups set status='VERIFIED' where id=(select grant_id from reauth_ctx);
select ok((select verified_at is not null from public.withdrawal_destination_step_ups where id=(select grant_id from reauth_ctx)),'verification uses DB time');
select throws_ok($$select pg_temp.change_destination(owner_id,'KRW_BANK','verified-krw',repeat('e',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','proof is bound to exact destination fingerprint');
select throws_ok($$select pg_temp.change_destination(owner_id,'USDT_ADDRESS','verified-krw',repeat('c',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','proof is bound to method');
-- Give the other owner a prior destination so first-registration exemption is irrelevant.
select pg_temp.change_destination((select other_id from reauth_ctx),'KRW_BANK',null,repeat('a',64));
select throws_ok($$select pg_temp.change_destination(other_id,'KRW_BANK','verified-krw',repeat('c',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','cross-owner proof denied');
select is((select status from public.withdrawal_destination_step_ups where id=(select grant_id from reauth_ctx)),'VERIFIED','failed binding does not consume good proof');
update reauth_ctx set changed=pg_temp.change_destination(owner_id,'KRW_BANK','verified-krw',repeat('c',64));
select is((select status from public.withdrawal_destination_step_ups where id=(select grant_id from reauth_ctx)),'CONSUMED','actual replacement atomically consumes proof');
select ok((select protection_until >= statement_timestamp()+interval '23 hours' from public.withdrawal_destinations where id=(select changed from reauth_ctx)),'replacement retains protection window');
select throws_ok($$select pg_temp.change_destination(owner_id,'KRW_BANK','verified-krw',repeat('c',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','same proof cannot make another mutation');
select is((select count(*)::integer from public.withdrawal_destination_history where user_id=(select owner_id from reauth_ctx) and destination_type='KRW_BANK'),3,'one registered prior, one replaced history, one new registration');
select is((select count(*)::integer from public.security_events where user_id=(select owner_id from reauth_ctx) and event_type='WITHDRAWAL_DESTINATION_REAUTH_CONSUMED'),1,'consumption audit exactly once');
select is((select count(*)::integer from public.withdrawal_requests where user_id=(select owner_id from reauth_ctx)),0,'destination change cannot create money');

-- Synthetic clock fixture only: alter proof timestamps as postgres inside this
-- rolled-back pgTAP transaction. Application privileges cannot modify them.
insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select owner_id,session_id,encode(extensions.digest('expired-usdt','sha256'),'hex'),'USDT_ADDRESS',repeat('d',64) from reauth_ctx;
update public.withdrawal_destination_step_ups set status='VERIFIED' where token_hash=encode(extensions.digest('expired-usdt','sha256'),'hex');
alter table public.withdrawal_destination_step_ups disable trigger withdrawal_destination_step_up_guard;
update public.withdrawal_destination_step_ups set created_at=statement_timestamp()-interval '10 minutes',verified_at=statement_timestamp()-interval '9 minutes',expires_at=statement_timestamp()-interval '5 minutes'
where token_hash=encode(extensions.digest('expired-usdt','sha256'),'hex');
alter table public.withdrawal_destination_step_ups enable trigger withdrawal_destination_step_up_guard;
select throws_ok($$select pg_temp.change_destination(owner_id,'USDT_ADDRESS','expired-usdt',repeat('d',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','expired proof denied');

insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select owner_id,session_id,encode(extensions.digest('revoked-usdt','sha256'),'hex'),'USDT_ADDRESS',repeat('d',64) from reauth_ctx;
update public.withdrawal_destination_step_ups set status='VERIFIED' where token_hash=encode(extensions.digest('revoked-usdt','sha256'),'hex');
delete from auth.sessions where id=(select session_id from reauth_ctx);
select is((select count(*)::integer from public.withdrawal_destination_step_ups where user_id=(select owner_id from reauth_ctx)),0,'logout revokes proofs through session cascade');
select throws_ok($$select pg_temp.change_destination(owner_id,'USDT_ADDRESS','revoked-usdt',repeat('d',64)) from reauth_ctx$$,'42501','WITHDRAWAL_REAUTH_REQUIRED','revoked session proof cannot replace destination');
select is((select count(*)::integer from public.security_events where user_id=(select owner_id from reauth_ctx) and event_type='WITHDRAWAL_DESTINATION_REAUTH_PENDING'),3,'attempt history survives logout');

insert into auth.sessions(id,user_id,created_at,updated_at)
select 'dd200000-0000-4000-8000-000000000003',limit_owner,statement_timestamp(),statement_timestamp() from reauth_ctx;
insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select limit_owner,'dd200000-0000-4000-8000-000000000003',encode(extensions.digest('rate-' || n,'sha256'),'hex'),'KRW_BANK',repeat('f',64)
from reauth_ctx cross join generate_series(1,5) as n;
update public.withdrawal_destination_step_ups set status='DENIED' where user_id=(select limit_owner from reauth_ctx);
select throws_ok($$insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select limit_owner,'dd200000-0000-4000-8000-000000000003',repeat('f',64),'KRW_BANK',repeat('f',64) from reauth_ctx$$,'55000','WITHDRAWAL_REAUTH_RATE_LIMITED','sixth password attempt blocked before provider call');
delete from auth.sessions where id='dd200000-0000-4000-8000-000000000003';
insert into auth.sessions(id,user_id,created_at,updated_at)
select 'dd200000-0000-4000-8000-000000000004',limit_owner,statement_timestamp(),statement_timestamp() from reauth_ctx;
select throws_ok($$insert into public.withdrawal_destination_step_ups(user_id,auth_session_id,token_hash,method,destination_fingerprint)
select limit_owner,'dd200000-0000-4000-8000-000000000004',repeat('f',64),'KRW_BANK',repeat('f',64) from reauth_ctx$$,'55000','WITHDRAWAL_REAUTH_RATE_LIMITED','changing sessions cannot erase durable attempt limit');

select * from finish();
rollback;
