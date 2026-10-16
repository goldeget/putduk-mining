begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Rollback-only synthetic approval/publication fixture. No historical funding,
-- source mutation, production activation or installed-trigger bypass.
create temporary table mature_ctx(member_id uuid,admin_id uuid,job uuid,earned uuid,activation uuid,
 state uuid,shift interval,credits_before bigint);
insert into mature_ctx values('10639100-0000-4000-8000-000000000001',
 '10639100-0000-4000-8000-000000000002',null,null,null,null,interval '30 days',null);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@mature-controlled.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from mature_ctx cross join lateral unnest(array[member_id,admin_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from mature_ctx;
select public.bootstrap_user(member_id) from mature_ctx;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select,update on mature_ctx to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Synthetic actual consent precedes synthetic funding; no clock override.
create temporary table cash_ctx(admin_session uuid,pilot uuid);
insert into cash_ctx values(gen_random_uuid(),gen_random_uuid());
grant select on cash_ctx to service_role;
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
select '10639100-0000-4000-8000-000000000004',admin_id,'synthetic-local-cash-totp','totp','verified',clock_timestamp()-interval '2 seconds',clock_timestamp(),'SYNTHETIC_ONLY_NOT_A_REAL_SECRET'from mature_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal,not_after)
select '10639100-0000-4000-8000-000000000005',admin_id,clock_timestamp()-interval '2 seconds',clock_timestamp(),'10639100-0000-4000-8000-000000000004','aal2',clock_timestamp()+interval '2 hours'from mature_ctx;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'10639100-0000-4000-8000-000000000005',clock_timestamp()-interval '2 seconds',clock_timestamp(),'totp');
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
 select c.admin_session,m.admin_id,'10639100-0000-4000-8000-000000000005','synthetic-local-cash-approval',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours'
 from cash_ctx c cross join mature_ctx m;

create function pg_temp.cash_approval(p_action text,p_target uuid,p_base jsonb)returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare actor uuid;sid uuid;grant_id uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();aid uuid:=(p_base->>'approval_audit_id')::uuid;
 result jsonb;at timestamptz:=clock_timestamp();
begin
 select admin_id into actor from pg_temp.mature_ctx;select admin_session into sid from pg_temp.cash_ctx;
 insert into public.admin_step_up_grants(id,admin_session_id,user_id,command_family,token_hash,issued_at,expires_at,consumed_at,consume_request_id)
 values(grant_id,sid,actor,'LIVEOPS_CONTENT',encode(extensions.digest('SYNTHETIC_ONLY_NO_TOKEN:'||grant_id,'sha256'),'hex'),at,at+interval '10 minutes',at,rid);
 result:=p_base-'approval_audit_id'||jsonb_build_object('approved_by',actor,'step_up_grant_id',grant_id,'request_id',rid,'admin_session_id',sid);
 return result;
end;$$;
create function pg_temp.cash_write_approval(p_action text,p_target uuid,p_aid uuid,p_snapshot jsonb)returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare at timestamptz;
begin
 select consumed_at into at from public.admin_step_up_grants where id=(p_snapshot->>'step_up_grant_id')::uuid;
 insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(p_aid,(p_snapshot->>'approved_by')::uuid,'ADMIN',p_action,'LOCAL_QA_CASH',p_target::text,'Synthetic local approval original; no Production authorization',
 (p_snapshot->>'request_id')::uuid,p_snapshot,
 '{"scope":"LOCAL_QA","synthetic_funding":true}',at);
 perform app_private.capture_local_cash_approval(p_aid);
end;$$;

create temporary table cash_event_ctx(payload jsonb,receipt jsonb,event_id uuid,revision uuid,rule uuid,reward uuid,policy uuid,source uuid,paid uuid);
insert into cash_event_ctx(payload,rule,reward,policy)values(jsonb_build_object('slug','synthetic-cash-terms-boundary','title','로컬 현금 동의 검증','summary','격리 검증용 안내입니다.','body','별도로 동의한 회원의 실제 정산 후 현금 보상 검증을 진행합니다.','cardTitle','로컬 검증','ctaLabel','참여하기','ctaRoute','/events','audience','MEMBERS','segment','ALL_MEMBERS','rewardMode','NONE','participation','내용을 확인한 뒤 직접 참여합니다.','exclusion','행사 취소 후에는 지급하지 않습니다.','startsAt',clock_timestamp()-interval '1 hour','endsAt',clock_timestamp()+interval '1 day'),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select,update on cash_event_ctx to service_role,authenticated;
create function pg_temp.cash_cms(p_operation text)returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare c record;m record;s uuid;k uuid:=gen_random_uuid();proof text;result jsonb;begin
 select * into c from pg_temp.cash_event_ctx;select * into m from pg_temp.mature_ctx;select admin_session into s from pg_temp.cash_ctx;
 proof:='SYNTHETIC-CMS-PROOF:'||k;perform public.issue_admin_step_up(s,m.admin_id,'LIVEOPS_CONTENT',proof,600);
 return public.manage_liveops_content(p_operation,'EVENT',(c.receipt->>'contentId')::uuid,(c.receipt->>'revisionId')::uuid,c.receipt->>'digest',
 case when p_operation='CREATE_DRAFT'then c.payload else null end,m.admin_id,s,'10639100-0000-4000-8000-000000000005','aal2',proof,'격리 검증용 안내 내용을 승인하고 처리합니다.',k::text);
end;$$;
grant execute on function pg_temp.cash_cms(text)to service_role;
set local role service_role;
update cash_event_ctx set receipt=pg_temp.cash_cms('CREATE_DRAFT');
update cash_event_ctx set receipt=pg_temp.cash_cms('PREVIEW');
update cash_event_ctx set receipt=pg_temp.cash_cms('APPROVE');
update cash_event_ctx set receipt=pg_temp.cash_cms('PUBLISH');
reset role;
update cash_event_ctx set event_id=(receipt->>'contentId')::uuid,revision=(receipt->>'revisionId')::uuid;
insert into public.event_rules(id,event_id,version,rule_payload,effective_from,created_by)
 select c.rule,c.event_id,1,'{"cash_qualification":"ACTUAL_POSITIVE_SETTLEMENT_AFTER_EXPLICIT_CASH_CONSENT"}',e.starts_at,m.admin_id from cash_event_ctx c join public.events e on e.id=c.event_id cross join mature_ctx m;
insert into public.event_rewards(id,event_id,event_rule_id,reward_code,amount_atomic,currency,maximum_per_user)
 select reward,event_id,rule,'SYNTHETIC_CASH_R2',1000,'KRW',1 from cash_event_ctx;
insert into public.kyc_cases(user_id,status,risk_level,decided_at,reviewed_by)select member_id,'APPROVED','LOW',clock_timestamp(),admin_id from mature_ctx;
insert into public.kyc_status_history(case_id,to_status,actor_user_id,reason,request_id,created_at)
 select id,'APPROVED',reviewed_by,'Synthetic local event KYC original',gen_random_uuid(),decided_at from public.kyc_cases where user_id=(select member_id from mature_ctx);
do $$declare p app_private.local_cash_policies%rowtype;pilot app_private.local_cash_pilot_originals%rowtype;t app_private.local_cash_budget_tranches%rowtype;begin
 select c.pilot,e.starts_at,e.starts_at+interval '30 days'into pilot.id,pilot.starts_at,pilot.ends_at from cash_ctx c cross join cash_event_ctx ce join public.events e on e.id=ce.event_id;
 pilot.referral_funded_ceiling_atomic:=0;pilot.event_funded_ceiling_atomic:=1000;pilot.approval_audit_id:=gen_random_uuid();
 pilot.snapshot:=pg_temp.cash_approval('LOCAL_CASH_PILOT_APPROVED',pilot.id,jsonb_build_object('approval_audit_id',pilot.approval_audit_id,'pilot',to_jsonb(pilot)-array['snapshot','digest']));
 perform pg_temp.cash_write_approval('LOCAL_CASH_PILOT_APPROVED',pilot.id,pilot.approval_audit_id,pilot.snapshot);
 pilot.digest:=app_private.funding_engine_digest(pilot.snapshot);insert into app_private.local_cash_pilot_originals select pilot.*;
 select ce.policy,ce.reward,ce.revision,e.starts_at,e.ends_at into p.id,p.event_reward_id,p.content_revision_id,p.starts_at,p.ends_at from cash_event_ctx ce join public.events e on e.id=ce.event_id;
 p.kind:='EVENT';p.pilot_id:=pilot.id;p.source_type:='MINING_SETTLEMENT_COMPLETED.v1';p.terms_version:=1;p.terms_ko:='내용에 별도로 동의한 후 실제 유료 정산과 본인 확인을 완료하면 1,000원을 한 번 지급합니다. 취소 후 새 지급은 중단됩니다.';
 select admin_id into p.approved_by from mature_ctx;p.approval_audit_id:=gen_random_uuid();p.created_at:=clock_timestamp();
 p.snapshot:=pg_temp.cash_approval('LOCAL_CASH_POLICY_APPROVED',p.id,jsonb_build_object('approval_audit_id',p.approval_audit_id));p.step_up_grant_id:=(p.snapshot->>'step_up_grant_id')::uuid;
 p.snapshot:=p.snapshot||jsonb_build_object('policy',to_jsonb(p)-array['snapshot','digest'],'scope','LOCAL_QA','risk_model','NATIVE_SAME_TX_R2_V1','stage_2_delay_hours','24',
 'reward',(select to_jsonb(r)from public.event_rewards r where id=p.event_reward_id),'rule',(select to_jsonb(r)from public.event_rules r where id=(select rule from cash_event_ctx)),
 'event',(select to_jsonb(e)from public.events e where id=(select event_id from cash_event_ctx)),'content_digest',(select digest from app_private.liveops_content_receipts where id=p.content_revision_id));
 perform pg_temp.cash_write_approval('LOCAL_CASH_POLICY_APPROVED',p.id,p.approval_audit_id,p.snapshot);p.digest:=app_private.funding_engine_digest(p.snapshot);
 insert into app_private.local_cash_policies select p.*;
 t.id:=gen_random_uuid();t.policy_id:=p.id;t.synthetic_pool_id:=gen_random_uuid();t.amount_atomic:=1000;t.starts_at:=p.starts_at;t.ends_at:=p.ends_at;t.approval_audit_id:=gen_random_uuid();
 t.snapshot:=pg_temp.cash_approval('LOCAL_CASH_TRANCHE_APPROVED',t.id,jsonb_build_object('approval_audit_id',t.approval_audit_id,'tranche',to_jsonb(t)-array['snapshot','digest'],'funding_kind','SYNTHETIC_LOCAL_QA_TREASURY'));
 perform pg_temp.cash_write_approval('LOCAL_CASH_TRANCHE_APPROVED',t.id,t.approval_audit_id,t.snapshot);t.digest:=app_private.funding_engine_digest(t.snapshot);insert into app_private.local_cash_budget_tranches select t.*;
end$$;
set local role service_role;
select lives_ok('set constraints all immediate','synthetic approved cash event policy, native publication and pilot funding verify');set constraints all deferred;
reset role;
-- Keep both the public result contract and the private capability explicit.
select ok((select reloptions @> array['security_invoker=true','security_barrier=true']
 from pg_class where oid='public.member_cash_event_terms'::regclass),
 'public member terms view is both invoker and security barrier');
select is((select array_agg(attname::text||':'||format_type(atttypid,atttypmod) order by attnum)
 from pg_attribute where attrelid='public.member_cash_event_terms'::regclass and attnum>0 and not attisdropped),
 array['event_id:uuid','content_revision_id:uuid','terms_version:integer','terms_ko:text',
 'cash_terms_digest:text','reward_krw:text','starts_at:timestamp with time zone','ends_at:timestamp with time zone'],
 'exact eight existing field names and types expose no snapshots, budgets or member facts');
select ok((select prosecdef and proconfig=array['search_path=pg_catalog']::text[] and pg_get_userbyid(proowner)='postgres'
 from pg_proc where oid='app_private.read_member_cash_event_terms()'::regprocedure),
 'sole private reader has the reviewed owner and fixed search path');
select ok(not exists(select 1 from aclexplode((select coalesce(proacl,acldefault('f',proowner))
 from pg_proc where oid='app_private.read_member_cash_event_terms()'::regprocedure))
 where grantee=0 and privilege_type='EXECUTE'),'PUBLIC cannot execute reader');
select ok(not has_table_privilege('authenticated','public.member_cash_event_terms','INSERT,UPDATE,DELETE'),
 'member terms capability is read-only');
select ok(not has_schema_privilege('authenticated','app_private','USAGE'),
 'view hardening preserves the revoked private-schema usage grant');
select ok(not has_function_privilege('anon','app_private.read_member_cash_event_terms()','EXECUTE')
 and not has_function_privilege('service_role','app_private.read_member_cash_event_terms()','EXECUTE')
 and has_function_privilege('authenticated','app_private.read_member_cash_event_terms()','EXECUTE'),
 'only authenticated receives the reader execute capability');
grant select on mature_ctx to authenticated;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from mature_ctx))::text,true);
select is((select count(*)from public.member_cash_event_terms),0::bigint,'absent configuration returns zero member rows');
reset role;
savepoint disabled_configuration;
insert into app_private.local_cash_configuration values(true,'putduk-mining-review-r2-20261009-e-200642',false);
set local role authenticated;
select is((select count(*)from public.member_cash_event_terms),0::bigint,'disabled configuration returns zero member rows');
reset role;
rollback to disabled_configuration;
release disabled_configuration;
insert into app_private.local_cash_configuration values(true,'putduk-mining-review-r2-20261009-e-200642',true);

set local role authenticated;
select is((select count(*)from public.member_cash_event_terms),1::bigint,'ordinary authenticated member can read enabled published cash terms');
select is((select reward_krw from public.member_cash_event_terms),'1000','existing reward amount text representation remains exact');
select is((select event_id from public.member_cash_event_terms),(select event_id from cash_event_ctx),'view exposes the actual published event');
select is((select content_revision_id from public.member_cash_event_terms),(select revision from cash_event_ctx),'view exposes the actual published revision');
reset role;
-- Stored view dependencies do not need caller USAGE on the private schema.
-- Grant it only inside this rollback-only test to exercise direct-call gates;
-- the migration itself grants neither schema USAGE nor raw table privileges.
grant usage on schema app_private to authenticated;
set local role authenticated;
select results_eq('select * from app_private.read_member_cash_event_terms()','select * from public.member_cash_event_terms',
 'direct reader exposes exactly the same approved terms as the view');
select throws_like('select snapshot from app_private.local_cash_policies','permission denied for table local_cash_policies',
 'member cannot bypass projection and read private snapshots');
select throws_like('select * from app_private.local_cash_configuration','permission denied for table local_cash_configuration',
 'member receives no raw configuration grant');
select throws_like('select * from app_private.local_cash_budget_tranches','permission denied for table local_cash_budget_tranches',
 'member receives no private budget grant');
select throws_like('select * from app_private.local_cash_consents','permission denied for table local_cash_consents',
 'member receives no raw consent grant');
select throws_like($$select public.participate_published_event(event_id,revision,gen_random_uuid(),gen_random_uuid(),repeat('0',64))from cash_event_ctx$$,
 'LOCAL_CASH_EXPLICIT_TERMS_MISMATCH','view access does not authorize forged cash acknowledgement');
select is((select public.participate_published_event(t.event_id,t.content_revision_id,gen_random_uuid(),gen_random_uuid(),t.cash_terms_digest)->>'cashConsentRecorded'
 from public.member_cash_event_terms t),'true','member reads actual view digest and records canonical explicit cash consent');
reset role;
select is((select count(*)from app_private.local_cash_consents),1::bigint,'view-based command creates exactly one immutable consent');
select is((select accepted_terms_digest from app_private.local_cash_consents),(select digest from app_private.local_cash_policies),
 'accepted digest belongs to the sealed policy');

-- A different authenticated member shares published terms, never consent data.
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select admin_id from mature_ctx))::text,true);
select is((select count(*)from public.member_cash_event_terms),1::bigint,'published ALL_MEMBERS terms are readable by another authenticated identity');
select is((select count(*)from public.event_participants),0::bigint,'another member cannot read the participant created by view-based consent');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is((select count(*)from public.member_cash_event_terms),0::bigint,'missing UID returns zero through view');
select is((select count(*)from app_private.read_member_cash_event_terms()),0::bigint,'missing UID returns zero through direct reader');
select set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',(select member_id from mature_ctx))::text,true);
select is((select count(*)from app_private.read_member_cash_event_terms()),0::bigint,'mismatched JWT role cannot use authenticated reader capability');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from mature_ctx))::text,true);
select is((select count(*)from app_private.read_member_cash_event_terms()),0::bigint,'owner with forged member claims cannot satisfy actual authenticated role');

set local role anon;
select throws_like('select * from public.member_cash_event_terms','permission denied%','anonymous cannot read terms even with member claims');
select throws_like('select * from app_private.read_member_cash_event_terms()','permission denied%','anonymous cannot bypass view and execute reader');
reset role;
set local role service_role;
select throws_like('select * from public.member_cash_event_terms','permission denied%','service cannot read member terms through view');
select throws_like('select * from app_private.read_member_cash_event_terms()','permission denied for function read_member_cash_event_terms','service cannot bypass view and execute reader');
reset role;

-- Owner-only alternate publication state inside a savepoint; no trigger removal.
savepoint future_publication;
update public.events set published_at=clock_timestamp()+interval '1 day'where id=(select event_id from cash_event_ctx);
set local role authenticated;
select is((select count(*)from public.member_cash_event_terms),0::bigint,'future publication remains hidden despite an open policy window');
select is((select count(*)from app_private.read_member_cash_event_terms()),0::bigint,'direct reader preserves publication-time gate');
reset role;
rollback to future_publication;
release future_publication;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
update cash_event_ctx set receipt=pg_temp.cash_cms('CANCEL');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from mature_ctx))::text,true);
select is((select count(*)from public.member_cash_event_terms),0::bigint,'canonical cancellation removes member terms immediately');
select is((select count(*)from app_private.read_member_cash_event_terms()),0::bigint,'direct reader cannot resurrect cancelled terms');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
set constraints all immediate;
select * from finish();
rollback;
