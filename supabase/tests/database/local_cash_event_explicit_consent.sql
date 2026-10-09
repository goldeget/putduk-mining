begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Owner-only, rollback-only controlled historical fixture. This is neither
-- imported Cloud data nor evidence of thirty days of production operation.
-- Preparation temporarily permits UPDATE of this test member's originals;
-- all installed triggers are restored before the actual canonical writer.
create temporary table mature_ctx(member_id uuid,admin_id uuid,job uuid,earned uuid,activation uuid,
 state uuid,shift interval,credits_before bigint);
insert into mature_ctx values('10639000-0000-4000-8000-000000000001',
 '10639000-0000-4000-8000-000000000002',null,null,null,null,interval '30 days',null);
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
select '10639000-0000-4000-8000-000000000004',admin_id,'synthetic-local-cash-totp','totp','verified',clock_timestamp()-interval '2 seconds',clock_timestamp(),'SYNTHETIC_ONLY_NOT_A_REAL_SECRET'from mature_ctx;
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal,not_after)
select '10639000-0000-4000-8000-000000000005',admin_id,clock_timestamp()-interval '2 seconds',clock_timestamp(),'10639000-0000-4000-8000-000000000004','aal2',clock_timestamp()+interval '2 hours'from mature_ctx;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(gen_random_uuid(),'10639000-0000-4000-8000-000000000005',clock_timestamp()-interval '2 seconds',clock_timestamp(),'totp');
insert into public.admin_sessions(id,user_id,auth_session_id,session_fingerprint,idle_expires_at,absolute_expires_at)
 select c.admin_session,m.admin_id,'10639000-0000-4000-8000-000000000005','synthetic-local-cash-approval',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours'
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
insert into cash_event_ctx(payload,rule,reward,policy)values(jsonb_build_object('slug','synthetic-cash-event-r2','title','로컬 현금 동의 검증','summary','격리 검증용 안내입니다.','body','별도로 동의한 회원의 실제 정산 후 현금 보상 검증을 진행합니다.','cardTitle','로컬 검증','ctaLabel','참여하기','ctaRoute','/events','audience','MEMBERS','segment','ALL_MEMBERS','rewardMode','NONE','participation','내용을 확인한 뒤 직접 참여합니다.','exclusion','행사 취소 후에는 지급하지 않습니다.','startsAt',clock_timestamp()-interval '1 hour','endsAt',clock_timestamp()+interval '1 day'),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select,update on cash_event_ctx to service_role,authenticated;
create function pg_temp.cash_cms(p_operation text)returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare c record;m record;s uuid;k uuid:=gen_random_uuid();proof text;result jsonb;begin
 select * into c from pg_temp.cash_event_ctx;select * into m from pg_temp.mature_ctx;select admin_session into s from pg_temp.cash_ctx;
 proof:='SYNTHETIC-CMS-PROOF:'||k;perform public.issue_admin_step_up(s,m.admin_id,'LIVEOPS_CONTENT',proof,600);
 return public.manage_liveops_content(p_operation,'EVENT',(c.receipt->>'contentId')::uuid,(c.receipt->>'revisionId')::uuid,c.receipt->>'digest',
 case when p_operation='CREATE_DRAFT'then c.payload else null end,m.admin_id,s,'10639000-0000-4000-8000-000000000005','aal2',proof,'격리 검증용 안내 내용을 승인하고 처리합니다.',k::text);
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
insert into app_private.local_cash_configuration values(true,'putduk-mining-review-r2-20261009-e-200642',true);
create temporary table cash_terms as select p.id,p.digest,p.content_revision_id from app_private.local_cash_policies p;
grant select on cash_terms,mature_ctx to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from mature_ctx))::text,true);
select public.participate_published_event(event_id,revision,gen_random_uuid(),gen_random_uuid())from cash_event_ctx;
reset role;
select is((select count(*)from app_private.local_cash_consents),0::bigint,'legacy NONE join never implies cash consent');
set local role authenticated;
select throws_like($$select public.participate_published_event(event_id,revision,gen_random_uuid(),gen_random_uuid(),repeat('0',64))from cash_event_ctx$$,'LOCAL_CASH_EXPLICIT_TERMS_MISMATCH','wrong cash terms acknowledgement fails closed');
select is((select public.participate_published_event(event_id,revision,gen_random_uuid(),gen_random_uuid(),(select digest from cash_terms))->>'cashConsentRecorded'from cash_event_ctx),'true','actual authenticated canonical command records explicit versioned cash consent');
reset role;
select is((select count(*)from app_private.local_cash_consents),1::bigint,'exact immutable consent original exists once');
select set_config('request.jwt.claims','{"role":"service_role"}',true);

set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',100000,'controlled-mature-deposit'),
 admin_id,100000,'controlled-mature-credit','Synthetic local historical fixture source only',gen_random_uuid()) from mature_ctx;
set constraints all immediate;
set constraints all deferred;
reset role;
update mature_ctx set activation=(select id from app_private.funding_engine_activations where user_id=member_id),
 state=(select id from app_private.funding_engine_state where user_id=member_id);
create temporary table mature_fixture_triggers as
select n.nspname,c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and
 ((n.nspname='app_private' and c.relname in('funding_engine_epochs','funding_engine_activations',
 'funding_condition_originals','funding_engine_state_receipts','funding_portion_transitions',
 'funding_portion_clock_receipts','funding_cycle_windows'))
 or(n.nspname='public' and c.relname in('money_source_movements','ledger_transactions','funding_principal_lots','funding_principal_revisions','audit_logs','outbox_events')));
do $$declare t record;begin
 if current_user<>'postgres' then raise exception 'OWNER_ONLY_SYNTHETIC_HISTORY';end if;
 for t in select * from mature_fixture_triggers loop
 execute format('alter table %I.%I disable trigger %I',t.nspname,t.relname,t.tgname);end loop;
end$$;
create function pg_temp.shift_controlled_input(p jsonb) returns jsonb language plpgsql as $$
declare k text;v jsonb;r jsonb;begin
 if jsonb_typeof(p)='object' then
 r:='{}';for k,v in select * from jsonb_each(p) loop
  if k in('first_credit_at_microseconds','credit_at_microseconds','effective_at_microseconds') and v#>>'{}' ~ '^[0-9]+$' then
   v:=to_jsonb(((v#>>'{}')::bigint-2592000000000)::text);
  else v:=pg_temp.shift_controlled_input(v);end if;
  r:=r||jsonb_build_object(k,v);end loop;
  if r ? 'principal_original_digest' and r ? 'credit_originals' then
   r:=r||jsonb_build_object('principal_original_digest',app_private.funding_engine_digest(r->'credit_originals'));end if;
  return r;
 elsif jsonb_typeof(p)='array' then select coalesce(jsonb_agg(pg_temp.shift_controlled_input(value)),'[]') into r from jsonb_array_elements(p);return r;
 end if;return p;end$$;
update app_private.funding_engine_epochs set introduced_at=introduced_at-interval '32 days' where version=1;
update public.money_source_movements set effective_at=effective_at-interval '30 days' where user_id=(select member_id from mature_ctx);
update public.ledger_transactions set posted_at=posted_at-interval '30 days' where member_user_id=(select member_id from mature_ctx);
update public.funding_principal_lots set effective_at=effective_at-interval '30 days' where user_id=(select member_id from mature_ctx);
update public.funding_principal_revisions set effective_at=effective_at-interval '30 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_cycle_windows set cycle_started_at=cycle_started_at-interval '30 days',cycle_end=cycle_end-interval '30 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_clock_receipts set effective_at=effective_at-interval '30 days',resumed_at=resumed_at-interval '30 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions set effective_at=effective_at-interval '30 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set effective_at=effective_at-interval '30 days',
 input_original=pg_temp.shift_controlled_input(input_original) where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set input_digest=app_private.funding_engine_digest(input_original)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals set effective_at=effective_at-interval '30 days',inputs=pg_temp.shift_controlled_input(inputs)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals c set input_digest=app_private.funding_engine_digest(app_private.funding_condition_snapshot(c))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions t set input_digest=app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(t))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_state_receipts set cursor_at=cursor_at-interval '30 days' where user_id=(select member_id from mature_ctx);
with originals as(
 select id,audit_id,source_event_id,input_digest,app_private.funding_activation_snapshot(a) snapshot from app_private.funding_engine_activations a where user_id=(select member_id from mature_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_condition_snapshot(c) from app_private.funding_condition_originals c where user_id=(select member_id from mature_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_portion_transition_snapshot(t) from app_private.funding_portion_transitions t where user_id=(select member_id from mature_ctx))
update public.audit_logs a set after_state=o.snapshot,metadata=a.metadata||jsonb_build_object('input_digest',o.input_digest,
 'fixture_provenance','OWNER_ONLY_CONTROLLED_HISTORY_ROLLBACK') from originals o where a.id=o.audit_id;
with originals as(
 select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_engine_activations where user_id=(select member_id from mature_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_condition_originals where user_id=(select member_id from mature_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_portion_transitions where user_id=(select member_id from mature_ctx))
update public.outbox_events e set payload=jsonb_build_object('user_id',o.user_id,'audit_id',o.audit_id,'input_digest',o.input_digest)
 from originals o where e.id=o.source_event_id;
set constraints all immediate;
set constraints all deferred;
do $$declare t record;begin for t in select * from mature_fixture_triggers loop
 execute format('alter table %I.%I %s trigger %I',t.nspname,t.relname,
 case t.tgenabled when 'O' then 'enable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'disable' end,t.tgname);
end loop;end$$;
select ok(not exists(select 1 from mature_fixture_triggers f join pg_namespace n on n.nspname=f.nspname
 join pg_class c on c.relnamespace=n.oid and c.relname=f.relname join pg_trigger t on t.tgrelid=c.oid and t.tgname=f.tgname
 where t.tgenabled<>f.tgenabled),'all installed source and integrity guards restored before canonical completion');
set local role service_role;
select lives_ok($$select app_private.read_cycle_retention_components(s.id,c.cycle_end) from app_private.funding_engine_state s
 join app_private.funding_cycle_windows c on c.id=s.cycle_id where s.user_id=(select member_id from mature_ctx)$$,
 'controlled mature history passes source-seal and portion-clock reconstruction');
update mature_ctx set job=app_private.prepare_default_funding_job(activation),credits_before=(select count(*) from public.mining_reward_credits);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from mature_ctx);
set local role service_role;
select id from public.claim_system_jobs('controlled-mature-worker',1,300);
reset role;
create function pg_temp.inject_rollover_fault() returns trigger language plpgsql as $$begin
 if new.user_id=(select member_id from mature_ctx) then raise exception 'LOCAL_ROLLOVER_FAULT';end if;return new;end$$;
create trigger local_rollover_fault before insert on app_private.funded_mining_mission_originals for each row execute function pg_temp.inject_rollover_fault();
set local role service_role;
select throws_like($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,
 'LOCAL_ROLLOVER_FAULT','mission-original fault rejects the entire canonical terminal transaction');
select is((select count(*) from public.mining_reward_credits),(select credits_before from mature_ctx),
 'next-window fault rolls back the wallet credit rather than leaving a paid closed cycle');
select is((select count(*) from app_private.funding_earned_receipts where job_id=(select job from mature_ctx)),0::bigint,
 'next-window fault rolls back the earned receipt');
reset role;
drop trigger local_rollover_fault on app_private.funded_mining_mission_originals;
set local role service_role;
select lives_ok($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,
 'actual installed canonical worker writer settles controlled thirty-day maturity');
update mature_ctx set earned=(select id from app_private.funding_earned_receipts where job_id=job);
select is((select amount_atomic from app_private.funding_earned_receipts where id=(select earned from mature_ctx)),15000::bigint,
 'approved 15 percent retention pays exactly 15000 on a synthetic 100000 source and zero allocation');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from mature_ctx),
 'terminal retention creates one authoritative wallet-linked reward credit');
select ok((select cycle_closed from app_private.funding_engine_state_receipts where id=(select next_state_id from app_private.funding_earned_receipts where id=(select earned from mature_ctx))),
 'terminal state closes at the exact original fixed cycle end');
select ok((select component_original is not null from app_private.funding_retention_qualifications where earned_receipt_id=(select earned from mature_ctx)),
 'terminal payment stores exact source and eligible-time component evidence');
select lives_ok($$set constraints all immediate$$,'real service role deferred seals and balanced source invariants accept terminal payment');
set constraints all deferred;
select lives_ok($$select public.complete_system_job(job,'controlled-mature-worker') from mature_ctx$$,'response-loss retry replays terminal receipt');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from mature_ctx),'terminal replay creates no second credit');
select ok((select not s.cycle_closed and s.cursor_at=old.cycle_end and c.cycle_started_at=old.cycle_end and c.cycle_end=old.cycle_end+interval '30 days'
 from app_private.funding_engine_state s join app_private.funding_cycle_windows c on c.id=s.cycle_id
 join app_private.funding_cycle_windows old on old.user_id=s.user_id and old.cycle_ordinal=0 where s.user_id=(select member_id from mature_ctx)),
 'canonical terminal completion atomically opens the next fixed window with no gap');
select is((select count(*) from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx)),1::bigint,
 'terminal retry does not repeat cycle rollover');
select throws_like($$update public.outbox_events set payload='{}' where id=(select source_event_id from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx))$$,
 'FUNDING_ROLLOVER_ENVELOPE_IMMUTABLE','rollover source event payload cannot be rewritten by service');
select throws_like($$update public.audit_logs set metadata='{}' where id=(select audit_id from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx))$$,
 'permission denied for table audit_logs','service has no UPDATE grant on the rollover audit original');
reset role;
select throws_like($$update public.audit_logs set metadata='{}' where id=(select audit_id from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx))$$,
 '%append-only%','even the native owner cannot rewrite a sealed rollover audit with guards enabled');
set local role service_role;
select ok((select s.base_used_num=0 and s.retention_used_num=0 and s.carry_num=(e.calculation->>'carryNum')::numeric
 from app_private.funding_engine_state s join app_private.funding_earned_receipts e on e.id=(select earned from mature_ctx)
 where s.user_id=(select member_id from mature_ctx)), 'new cycle resets used capacities and preserves only exact carry');
select lives_ok($$select app_private.prepare_default_funding_job(activation) from mature_ctx$$,
 'existing canonical scheduler can prepare a following-cycle job without a new money alias');
update mature_ctx set job=app_private.prepare_default_funding_job(activation);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from mature_ctx);
set local role service_role;
select id from public.claim_system_jobs('controlled-mature-worker-next',1,300);
select lives_ok($$select public.complete_system_job(job,'controlled-mature-worker-next') from mature_ctx$$,
 'canonical writer advances the next cycle with its actual current portion sources');
select is((select amount_atomic from app_private.funding_earned_receipts where job_id=(select job from mature_ctx)),0::bigint,
 'next-cycle early tick does not catch up or repeat previous retention');
select lives_ok($$set constraints all immediate$$,'next-cycle earned state and carry chain pass native integrity');
reset role;

-- Inspect originals with native owner privileges; service receives no raw SELECT.
select is((select count(*) from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx)),2::bigint,'first actual positive balanced earning seals two business originals once');
select is((select count(*) from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx) and source_type='MINING_STARTED.v1'),1::bigint,'activation plus positive actual earning confirms one start');
select is((select count(*) from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx) and source_type='MINING_SETTLEMENT_COMPLETED.v1'),1::bigint,'zero following-cycle tick creates no completed positive settlement original');
select ok((select bool_and(o.observed_at=e.recorded_at and o.effective_at=case when o.source_type='MINING_STARTED.v1' then a.effective_at else e.settled_to end) from app_private.funded_mining_mission_originals o join app_private.funding_earned_receipts e on e.id=o.earned_receipt_id join app_private.funding_engine_activations a on a.id=o.activation_id where o.user_id=(select member_id from mature_ctx)),'actual business clock and delayed positive observation are separate');
select lives_ok($proof$select app_private.assert_funded_mining_mission_original(id) from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx)$proof$,'all new originals validate real completion fence and balanced existing ledger');
select throws_like($proof$update public.outbox_events set payload='{}' where id=(select outbox_id from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx) limit 1)$proof$,'MINING_MISSION_OUTBOX_IMMUTABLE','business original cannot be rewritten even by owner');
select throws_like($proof$update app_private.funded_mining_mission_originals set snapshot='{}' where user_id=(select member_id from mature_ctx)$proof$,'%append-only%','private originals are append-only');
create function pg_temp.read_mission(p_id uuid) returns jsonb language sql security definer set search_path=pg_catalog as $proof$select app_private.read_nonmoney_mission_original(p_id)$proof$;
grant execute on function pg_temp.read_mission(uuid) to service_role;
create temporary table local_mining_sources as select outbox_id,source_type,user_id from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx);
grant select on local_mining_sources to service_role;
set local role service_role;
select ok((select bool_and((pg_temp.read_mission(outbox_id)->>'member_id')::uuid=user_id and pg_temp.read_mission(outbox_id)->>'source_type'=source_type) from local_mining_sources),'ID-only nonmoney validator derives actual owner and type from source');
select throws_like($proof$select * from app_private.funded_mining_mission_originals$proof$,'permission denied for table funded_mining_mission_originals','service has no private original raw SELECT');
select throws_like($proof$select app_private.read_nonmoney_mission_original(outbox_id) from local_mining_sources$proof$,'permission denied for function read_nonmoney_mission_original','service cannot directly invoke closed qualification reader');
reset role;

-- Current native source completion uses actual lease/closed payout dispatcher.
set constraints all deferred;
insert into app_private.nonmoney_executor_configuration(singleton,local_qa_enabled,project_identity)values(true,true,'putduk-mining-local-recovery-20261009-fi');
update cash_event_ctx set source=(select outbox_id from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx)and source_type='MINING_SETTLEMENT_COMPLETED.v1');
update public.outbox_events set available_at='infinity'where id<>(select source from cash_event_ctx);
update public.outbox_events set available_at='-infinity'where id=(select source from cash_event_ctx);
set local role service_role;
select is((select id from public.claim_outbox_events('cash-event-positive',1,300)),(select source from cash_event_ctx),'worker claims exact current event qualifying canonical source');
reset role;
create function pg_temp.cash_event_fault()returns trigger language plpgsql as $$begin if new.entry_type::text='EVENT_REWARD'then raise exception 'SYNTHETIC_EVENT_LATE_FAULT';end if;return new;end;$$;
create trigger synthetic_event_fault before insert on public.wallet_ledger for each row execute function pg_temp.cash_event_fault();
set local role service_role;
select throws_like($$select public.complete_outbox_event(source,'cash-event-positive')from cash_event_ctx$$,'SYNTHETIC_EVENT_LATE_FAULT','event late fault atomically rolls back budget, claim and credit');
reset role;
drop trigger synthetic_event_fault on public.wallet_ledger;
select is((select count(*)from app_private.local_cash_originals),0::bigint,'failed event money leaves no immutable paid original');
select is((select count(*)from app_private.local_cash_budget_allocations),0::bigint,'failed event money consumes no budget');
set local role service_role;
select lives_ok($$select public.complete_outbox_event(source,'cash-event-positive')from cash_event_ctx$$,'actual current canonical source pays exact explicitly consented event reward');
select lives_ok('set constraints all immediate','actual event payment satisfies all native deferred originals and provenance');set constraints all deferred;
reset role;
select is((select sum(amount_atomic)from app_private.local_cash_originals),1000::numeric,'exact approved event amount is actually posted');
select is((select count(*)from public.event_reward_claims where status='PAID'),1::bigint,'one native paid event claim exists');
select is((select count(*)from public.money_source_movements where origin_code='EVENT_REWARD'and source_bucket='BONUS'),1::bigint,'event credits exact native BONUS provenance');
update cash_event_ctx set paid=(select source_event_id from app_private.local_cash_originals);
update public.outbox_events set status='PROCESSING',lease_owner='cash-event-replay',lease_expires_at=clock_timestamp()+interval '5 minutes',processed_at=null where id=(select source from cash_event_ctx);
set local role service_role;
select lives_ok($$select public.complete_outbox_event(source,'cash-event-replay')from cash_event_ctx$$,'event source replay cannot exceed one claim or consume exhausted budget twice');
reset role;
select is((select sum(amount_atomic)from app_private.local_cash_budget_allocations),1000::numeric,'replay leaves budget exactly exhausted once');
set local role service_role;
update cash_event_ctx set receipt=pg_temp.cash_cms('CANCEL');
reset role;
select is((select status::text from public.events where id=(select event_id from cash_event_ctx)),'CANCELLED','canonical reviewed cancellation is recorded');
set local role service_role;
select lives_ok($$select app_private.assert_money_source_credit_complete(m)from public.money_source_movements m where origin_code='EVENT_REWARD'$$,'prior legitimate event BONUS survives later canonical cancellation');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',(select member_id from mature_ctx))::text,true);
select throws_like($$select public.participate_published_event(event_id,revision,gen_random_uuid(),gen_random_uuid(),(select digest from cash_terms))from cash_event_ctx$$,'EVENT_NOT_AVAILABLE','canonical cancellation blocks new cash consent even with former digest');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.outbox_events set available_at='-infinity'where id=(select paid from cash_event_ctx);
set local role service_role;
select id from public.claim_outbox_events('cash-event-notice',1,300);
select lives_ok($$select public.complete_outbox_event(paid,'cash-event-notice')from cash_event_ctx$$,'paid event notification reuses historical original after cancellation');
select lives_ok('set constraints all immediate','cancelled event retains accepted immutable financial integrity');
reset role;
select is((select count(*)from public.notifications where source_event_id=(select paid from cash_event_ctx)and user_id=(select member_id from mature_ctx)),1::bigint,'event notification belongs only to actually paid member');
select * from finish();rollback;
