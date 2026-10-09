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
 '10639000-0000-4000-8000-000000000002',null,null,null,null,interval '61 days',null);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@mature-controlled.putduk.test','',
 statement_timestamp(),case when person=(select member_id from mature_ctx)then '{"provider":"email","providers":["email"]}'::jsonb else '{}'::jsonb end,
case when person=(select member_id from mature_ctx)then jsonb_build_object('signup_source','PUBLIC_V1','login_id','cash_native_r2_1',
'legal_name','합성 검증 회원','date_of_birth','1990-01-01','phone_e164','+821099990641','recovery_email',person::text||'@mature-controlled.putduk.test',
'service_terms_version','TERMS-KO-2026-09-27','service_terms_granted',true,'privacy_version','PRIVACY-KO-2026-09-27','privacy_granted',true,
'marketing_version','MARKETING-KO-2026-09-27','marketing_granted',false)else '{}'::jsonb end,
statement_timestamp(),statement_timestamp(),'','','',''
from mature_ctx cross join lateral unnest(array[member_id,admin_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from mature_ctx;
select public.bootstrap_user(member_id) from mature_ctx;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select,update on mature_ctx to service_role;
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
   v:=to_jsonb(((v#>>'{}')::bigint-5270400000000)::text);
  else v:=pg_temp.shift_controlled_input(v);end if;
  r:=r||jsonb_build_object(k,v);end loop;
  if r ? 'principal_original_digest' and r ? 'credit_originals' then
   r:=r||jsonb_build_object('principal_original_digest',app_private.funding_engine_digest(r->'credit_originals'));end if;
  return r;
 elsif jsonb_typeof(p)='array' then select coalesce(jsonb_agg(pg_temp.shift_controlled_input(value)),'[]') into r from jsonb_array_elements(p);return r;
 end if;return p;end$$;
update app_private.funding_engine_epochs set introduced_at=introduced_at-interval '62 days' where version=1;
update public.money_source_movements set effective_at=effective_at-interval '61 days' where user_id=(select member_id from mature_ctx);
update public.ledger_transactions set posted_at=posted_at-interval '61 days' where member_user_id=(select member_id from mature_ctx);
update public.funding_principal_lots set effective_at=effective_at-interval '61 days' where user_id=(select member_id from mature_ctx);
update public.funding_principal_revisions set effective_at=effective_at-interval '61 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_cycle_windows set cycle_started_at=cycle_started_at-interval '61 days',cycle_end=cycle_end-interval '61 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_clock_receipts set effective_at=effective_at-interval '61 days',resumed_at=resumed_at-interval '61 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions set effective_at=effective_at-interval '61 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set effective_at=effective_at-interval '61 days',
 input_original=pg_temp.shift_controlled_input(input_original) where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set input_digest=app_private.funding_engine_digest(input_original)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals set effective_at=effective_at-interval '61 days',inputs=pg_temp.shift_controlled_input(inputs)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals c set input_digest=app_private.funding_engine_digest(app_private.funding_condition_snapshot(c))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions t set input_digest=app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(t))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_state_receipts set cursor_at=cursor_at-interval '61 days' where user_id=(select member_id from mature_ctx);
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

set constraints all deferred;
-- All following users, funding and approvals are synthetic, rollback-only.
-- Mature financial sources above are controlled historical fixtures. Shift the
-- genuine signup source together, with installed guards restored immediately.
create temporary table cash_signup_guards as select n.nspname,c.relname,t.tgname,t.tgenabled from pg_trigger t
 join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and
 n.nspname='public'and c.relname in('user_identity_profiles','user_consent_records','member_timeline_events','outbox_events');
do $$declare t record;begin for t in select * from cash_signup_guards loop execute format('alter table %I.%I disable trigger %I',t.nspname,t.relname,t.tgname);end loop;end$$;
update auth.users set created_at=created_at-interval '62 days'where id=(select member_id from mature_ctx);
update public.user_identity_profiles set created_at=created_at-interval '62 days'where user_id=(select member_id from mature_ctx);
update public.user_consent_records set captured_at=captured_at-interval '62 days'where user_id=(select member_id from mature_ctx);
update public.member_timeline_events set occurred_at=occurred_at-interval '62 days',created_at=created_at-interval '62 days'
 where user_id=(select member_id from mature_ctx)and event_type='MEMBER_PROFILE_CAPTURED';
update public.outbox_events set occurred_at=occurred_at-interval '62 days',created_at=created_at-interval '62 days'
 where event_type='MEMBER_PROFILE_CAPTURED.v1'and aggregate_id=(select member_id from mature_ctx);
do $$declare t record;begin for t in select * from cash_signup_guards loop execute format('alter table %I.%I %s trigger %I',t.nspname,t.relname,
 case t.tgenabled when 'O'then 'enable'when 'A'then 'enable always'when 'R'then 'enable replica'else 'disable'end,t.tgname);end loop;end$$;
create temporary table cash_ctx(referrer uuid,referral uuid,policy uuid,program uuid,signup uuid,mission uuid,source uuid,review uuid,admin_session uuid,pilot uuid);
insert into cash_ctx values('10639000-0000-4000-8000-000000000003',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
 (select id from public.outbox_events where event_type='MEMBER_PROFILE_CAPTURED.v1'and aggregate_id=(select member_id from mature_ctx)),
 (select id from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx)and source_type='MINING_SETTLEMENT_COMPLETED.v1'),
 (select outbox_id from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx)and source_type='MINING_SETTLEMENT_COMPLETED.v1'),null,gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select referrer,'authenticated','authenticated','local-cash-referrer@putduk.test','{}','{}',clock_timestamp()-interval '63 days',clock_timestamp()from cash_ctx;
select public.bootstrap_user(referrer)from cash_ctx;
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
-- Actual KYC source rows and history for both participants, never caller booleans.
insert into public.kyc_cases(user_id,status,risk_level,decided_at,reviewed_by)
 select u,'APPROVED','LOW',clock_timestamp(),m.admin_id from mature_ctx m cross join cash_ctx c
 cross join lateral unnest(array[m.member_id,c.referrer])u;
insert into public.kyc_status_history(case_id,to_status,actor_user_id,reason,request_id,created_at)
 select id,'APPROVED',reviewed_by,'Synthetic LOCAL_QA KYC decision',gen_random_uuid(),decided_at from public.kyc_cases
 where user_id in(select member_id from mature_ctx union all select referrer from cash_ctx);
insert into public.referral_program_versions(id,version,stage_1_reward_atomic,stage_2_reward_atomic,rule_payload,effective_at,approved_by)
 select c.program,9200642,5000,5000,'{"stage_2":"distinct actual settlement 24h after stage 1; no first paid cycle requirement"}',
 clock_timestamp()-interval '70 days',m.admin_id from cash_ctx c cross join mature_ctx m;
insert into public.referral_attributions(id,referrer_user_id,referred_user_id,invite_code,attributed_at)
 select c.referral,c.referrer,m.member_id,'SYNTHETIC-R2-REFERRAL',e.occurred_at+interval '1 second'
 from cash_ctx c cross join mature_ctx m join public.outbox_events e on e.aggregate_id=m.member_id and e.event_type='MEMBER_PROFILE_CAPTURED.v1';
do $$declare p app_private.local_cash_policies%rowtype;a public.referral_attributions%rowtype;o app_private.local_referral_attribution_originals%rowtype;
 pilot app_private.local_cash_pilot_originals%rowtype;
begin
 select cash_ctx.pilot into pilot.id from cash_ctx;pilot.starts_at:=clock_timestamp()-interval '63 days';pilot.ends_at:=pilot.starts_at+interval '30 days';
 pilot.referral_funded_ceiling_atomic:=10000;pilot.event_funded_ceiling_atomic:=1000;pilot.approval_audit_id:=gen_random_uuid();
 pilot.snapshot:=pg_temp.cash_approval('LOCAL_CASH_PILOT_APPROVED',pilot.id,jsonb_build_object('approval_audit_id',pilot.approval_audit_id,
 'pilot',to_jsonb(pilot)-array['snapshot','digest']));
 perform pg_temp.cash_write_approval('LOCAL_CASH_PILOT_APPROVED',pilot.id,pilot.approval_audit_id,pilot.snapshot);
 pilot.digest:=app_private.funding_engine_digest(pilot.snapshot);insert into app_private.local_cash_pilot_originals select pilot.*;
 select policy into p.id from cash_ctx;p.kind:='REFERRAL';select program into p.referral_program_id from cash_ctx;
 p.pilot_id:=pilot.id;p.starts_at:=pilot.starts_at;p.ends_at:=pilot.ends_at;p.source_type:='MINING_SETTLEMENT_COMPLETED.v1';
 p.terms_version:=1;p.terms_ko:='추천인에게 실제 자격 검증 후 5,000원씩 두 번 지급합니다. 후속 정산과 위험 재검사가 필요합니다.';
 select admin_id into p.approved_by from mature_ctx;p.approval_audit_id:=gen_random_uuid();p.created_at:=clock_timestamp();
 -- Approval helper first binds its one-use grant, then exact policy snapshot is audited.
 p.snapshot:=pg_temp.cash_approval('LOCAL_CASH_POLICY_APPROVED',p.id,jsonb_build_object('approval_audit_id',p.approval_audit_id));
 p.step_up_grant_id:=(p.snapshot->>'step_up_grant_id')::uuid;
 p.snapshot:=p.snapshot||jsonb_build_object('policy',to_jsonb(p)-array['snapshot','digest'],'scope','LOCAL_QA','risk_model','NATIVE_SAME_TX_R2_V1',
 'stage_2_delay_hours','24','program',(select to_jsonb(r)from public.referral_program_versions r where id=p.referral_program_id));
 perform pg_temp.cash_write_approval('LOCAL_CASH_POLICY_APPROVED',p.id,p.approval_audit_id,p.snapshot);
 p.digest:=app_private.funding_engine_digest(p.snapshot);insert into app_private.local_cash_policies select p.*;
 select * into a from public.referral_attributions where id=(select referral from cash_ctx);
 o.referral_id:=a.id;select signup into o.signup_event_id from cash_ctx;o.approval_audit_id:=gen_random_uuid();
 o.snapshot:=pg_temp.cash_approval('LOCAL_REFERRAL_ATTRIBUTION_APPROVED',a.id,jsonb_build_object('approval_audit_id',o.approval_audit_id,
 'attribution',to_jsonb(a),'signup_original_digest',app_private.funding_engine_digest(app_private.read_member_profile_capture_original(o.signup_event_id))));
 perform pg_temp.cash_write_approval('LOCAL_REFERRAL_ATTRIBUTION_APPROVED',a.id,o.approval_audit_id,o.snapshot);
 o.digest:=app_private.funding_engine_digest(o.snapshot);insert into app_private.local_referral_attribution_originals select o.*;
end$$;

insert into app_private.local_cash_configuration values(true,'putduk-mining-review-r2-20261009-e-200642',true);
grant select,update on cash_ctx to service_role;
select lives_ok($$select app_private.assert_local_cash_policy(policy)from cash_ctx$$,'exact synthetic policy approval, native program and grant original validate');
select lives_ok($$select app_private.assert_local_referral_attribution(referral)from cash_ctx$$,'native signup capture and immutable referral attribution are bound');
select is((select count(*)from app_private.local_cash_originals),0::bigint,'empty funded budget starts with no cash credit');
update public.outbox_events set available_at='infinity'where id<>(select source from cash_ctx);
set local role service_role;
select throws_like($$insert into app_private.local_cash_budget_tranches default values$$,'permission denied for table local_cash_budget_tranches','service cannot manufacture a funded reward budget');
select throws_like($$select app_private.post_local_cash_pending(gen_random_uuid())$$,'permission denied for function post_local_cash_pending','service cannot call generic internal amount writer');
select is((select count(*)from public.claim_outbox_events('cash-native',1,300)),1::bigint,'actual outbox claim leases canonical settlement');
select throws_like($$select public.complete_outbox_event(source,'cash-wrong-worker')from cash_ctx$$,'OUTBOX_LEASE_NOT_OWNED','cash source rejects wrong durable lease owner');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_like($$select public.complete_outbox_event(source,'cash-native')from cash_ctx$$,'LOCAL_CASH_CLOSED_SERVICE_REQUIRED','cash source rejects service connection with inconsistent JWT role');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.complete_outbox_event(source,'cash-native')from cash_ctx$$,'empty budget retains eligibility and completes valid original source');
reset role;
select is((select count(*)from app_private.local_cash_originals),0::bigint,'empty budget creates no wallet or journal credit');
select is((select count(*)from app_private.local_cash_pending where status='PENDING_BUDGET'),1::bigint,'qualified referral survives as durable PENDING_BUDGET');
select is((select count(*)from app_private.local_cash_review_originals),1::bigint,'closed durable retry source is created once');
update cash_ctx set review=(select event_id from app_private.local_cash_review_originals order by generation desc limit 1);
select throws_like($$update app_private.local_cash_review_originals set snapshot='{}'$$,'%append-only%','retry original cannot be rewritten even by owner');
select throws_like($$update public.outbox_events set payload='{}'where id=(select review from cash_ctx)$$,'LOCAL_CASH_SOURCE_ENVELOPE_IMMUTABLE','retry source envelope remains sealed');

create function pg_temp.add_cash_tranche(p_amount bigint)returns uuid language plpgsql as $$
declare t app_private.local_cash_budget_tranches%rowtype;
begin
 t.id:=gen_random_uuid();select policy into t.policy_id from cash_ctx;t.synthetic_pool_id:=gen_random_uuid();t.amount_atomic:=p_amount;
 t.starts_at:=clock_timestamp()-interval '1 minute';t.ends_at:=clock_timestamp()+interval '1 day';t.approval_audit_id:=gen_random_uuid();
 t.snapshot:=pg_temp.cash_approval('LOCAL_CASH_TRANCHE_APPROVED',t.id,jsonb_build_object('approval_audit_id',t.approval_audit_id,
 'tranche',to_jsonb(t)-array['snapshot','digest'],'funding_kind','SYNTHETIC_LOCAL_QA_TREASURY'));
 perform pg_temp.cash_write_approval('LOCAL_CASH_TRANCHE_APPROVED',t.id,t.approval_audit_id,t.snapshot);
 t.digest:=app_private.funding_engine_digest(t.snapshot);insert into app_private.local_cash_budget_tranches select t.*;return t.id;
end;$$;
select pg_temp.add_cash_tranche(10000);
select lives_ok('set constraints all immediate','funded tranche and global pilot original validate before qualification retry');
set constraints all deferred;
select throws_like($$select pg_temp.add_cash_tranche(1);set constraints all immediate$$,
 'LOCAL_CASH_GLOBAL_PILOT_FUNDED_CEILING','additional funding cannot exceed approved pilot ceiling across its policies');
create function pg_temp.cash_component_stop(p_paused boolean,p_key text)returns void language plpgsql as $$begin
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 select admin_id,'ADMIN',case when p_paused then 'SAFE_MODE_ENABLED'else 'SAFE_MODE_DISABLED'end,'SAFE_MODE','REFERRAL_PAYOUT',
 'Synthetic local cash component stop verification',gen_random_uuid(),jsonb_build_object('command_version',1,'idempotency_key',p_key,
 'component','REFERRAL_PAYOUT','is_paused',p_paused,'review_at',null,'expected_request_id',(select request_id from public.safe_mode_controls where component='REFERRAL_PAYOUT'))from mature_ctx;
end;$$;
select pg_temp.cash_component_stop(true,'cash-referral-pause');
update public.outbox_events set available_at='-infinity'where id=(select review from cash_ctx);
set local role service_role;
select id from public.claim_outbox_events('cash-stopped',1,300);
select lives_ok($$select public.complete_outbox_event(review,'cash-stopped')from cash_ctx$$,'matching referral component pause retains qualification without paying');
reset role;
select is((select status from app_private.local_cash_pending),'PENDING_CONTROL','component pause is a durable pending control state');
select is((select count(*)from app_private.local_cash_originals),0::bigint,'component pause consumes no reserved or paid cash');
select pg_temp.cash_component_stop(false,'cash-referral-resume');
update cash_ctx set review=(select event_id from app_private.local_cash_review_originals order by generation desc limit 1);
insert into public.risk_flags(user_id,flag_code,severity,source_type,evidence,model_version)
 select referrer,'SHARED_IP','HIGH','SYNTHETIC_LOCAL_QA','{}','qa-native'from cash_ctx;
select is(app_private.read_local_cash_risk(array[(select referrer from cash_ctx),(select member_id from mature_ctx)])->>'decision','CLEAR','shared IP alone never denies qualified members');
insert into public.risk_flags(user_id,flag_code,severity,source_type,evidence,model_version)
 select referrer,'SYNTHETIC_HIGH_RISK','HIGH','SYNTHETIC_LOCAL_QA','{}','qa-native'from cash_ctx;
update public.outbox_events set available_at='-infinity'where id=(select review from cash_ctx);
set local role service_role;
select id from public.claim_outbox_events('cash-risk',1,300);
select lives_ok($$select public.complete_outbox_event(review,'cash-risk')from cash_ctx$$,'same-transaction native risk on referrer defers cash safely');
reset role;
select is((select status from app_private.local_cash_pending),'AUTO_HOLD','risk hold is durable and does not lose qualification');
select is((select count(*)from app_private.local_cash_budget_allocations),0::bigint,'risk hold consumes no approved budget');
update public.risk_flags set resolved_at=clock_timestamp(),resolution_reason='Synthetic risk cleared for rollback test'where flag_code='SYNTHETIC_HIGH_RISK';
update cash_ctx set review=(select event_id from app_private.local_cash_review_originals order by generation desc limit 1);
update public.outbox_events set available_at='-infinity'where id=(select review from cash_ctx);
set local role service_role;
select id from public.claim_outbox_events('cash-paid',1,300);
reset role;
create function pg_temp.local_cash_fault()returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_CASH_POSTING_FAULT';end;$$;
create trigger synthetic_cash_fault before insert on public.wallet_ledger for each row execute function pg_temp.local_cash_fault();
set local role service_role;
select throws_like($$select public.complete_outbox_event(review,'cash-paid')from cash_ctx$$,'SYNTHETIC_CASH_POSTING_FAULT','late wallet fault rolls back every reservation and financial write');
reset role;
drop trigger synthetic_cash_fault on public.wallet_ledger;
select is((select count(*)from app_private.local_cash_originals),0::bigint,'failed posting leaves zero cash originals');
select is((select count(*)from app_private.local_cash_budget_allocations),0::bigint,'failed posting releases entire budget reservation');
select is((select count(*)from public.referral_reward_claims),0::bigint,'failed posting leaves no paid or pending claim');
set local role service_role;
select lives_ok($$select public.complete_outbox_event(review,'cash-paid')from cash_ctx$$,'same leased retry performs actual source-bound synthetic referral payout');
select lives_ok('set constraints all immediate','same-transaction deferred cash and financial integrity all pass');
set constraints all deferred;
reset role;
select is((select sum(amount_atomic)from app_private.local_cash_originals),5000::numeric,'referrer-only stage one pays exactly approved 5000 KRW');
select is((select sum(amount_atomic)from app_private.local_cash_referral_obligations),5000::numeric,'stage one also commits exact 5000 for future stage two');
select is((select sum(al.amount_atomic)from app_private.local_cash_budget_allocations al)+(select sum(b.amount_atomic)from app_private.local_cash_referral_obligations b),10000::numeric,
 'first payout and future obligation reserve the full approved maximum, preventing unfunded second-stage promises');
select is((select count(*)from public.money_source_movements where origin_code='REFERRAL_REWARD'and source_bucket='BONUS'),1::bigint,'actual bonus provenance exists once');
select is((select count(*)from public.referral_reward_claims where beneficiary_user_id=(select member_id from mature_ctx)),0::bigint,'referred member is not silently made reward beneficiary');
select is((select sum(case side when 'DEBIT'then amount_atomic else -amount_atomic end)from public.ledger_entries where transaction_id=(select ledger_transaction_id from app_private.local_cash_originals)),0::numeric,'actual cash journal is balanced');
select throws_like($$update public.referral_reward_claims set amount_atomic=1 where status='PAID'$$,'LOCAL_CASH_PAID_CLAIM_IMMUTABLE','accepted native paid claim cannot be altered');
select throws_like($$update app_private.local_cash_originals set risk_snapshot='{}'$$,'%append-only%','accepted risk and original are immutable');
select throws_like($$update public.outbox_events set payload='{}'where event_type='REFERRAL_REWARD_PAID.v1'$$,'LOCAL_CASH_SOURCE_ENVELOPE_IMMUTABLE','accepted paid envelope cannot be rewritten');
update public.outbox_events set status='PROCESSING',lease_owner='cash-response-loss',lease_expires_at=clock_timestamp()+interval '5 minutes',processed_at=null where id=(select source from cash_ctx);
set local role service_role;
select lives_ok($$select public.complete_outbox_event(source,'cash-response-loss')from cash_ctx$$,'same canonical mission replay cannot create stage two before 24h or pay stage one twice');
reset role;
select is((select count(*)from app_private.local_cash_originals),1::bigint,'replay preserves exactly one actual cash credit');
select is((select count(*)from app_private.local_cash_pending where stage='STAGE_2'),0::bigint,'same mission and too-early activity never qualify stage two');
select ok(not has_function_privilege('authenticated','app_private.consume_local_cash_source(uuid,text)','EXECUTE'),'member cannot directly execute closed cash consumer');
select ok(not has_table_privilege('service_role','app_private.local_cash_originals','INSERT'),'service has no raw original writer grant');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.prosecdef and p.proname like '%cash%'),'no new public cash SECURITY DEFINER alias');

set local role service_role;
select lives_ok('set constraints all immediate','flush all accepted native deferred seals before owner-only observation fixture');
set constraints all deferred;reset role;
-- OWNER-ONLY CONTROLLED OBSERVATION HISTORY, rollback-only. No runtime clock override.
-- First actual canonical cycle is 31 days in the past. Preserve that business
-- clock; move only its recorded/accepted observation and first payout 3 days
-- back, rebind every affected source seal, then restore all original guards.
create temporary table cash_history_guards as select n.nspname,c.relname,t.tgname,t.tgenabled from pg_trigger t
 join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and
 ((n.nspname='app_private'and c.relname in('funding_earned_receipts','funded_mining_mission_originals','funded_mining_mission_epoch',
 'local_cash_approval_originals','local_cash_policies','local_cash_budget_tranches','local_cash_pending','local_cash_originals',
 'local_cash_referral_obligations','local_cash_review_originals','domain_notification_originals'))
 or(n.nspname='public'and c.relname in('system_jobs','system_job_attempts','audit_logs','outbox_events','referral_program_versions',
 'referral_qualifications','referral_reward_claims','ledger_transactions','wallet_ledger','money_source_movements','kyc_cases','kyc_status_history',
 'notifications','notification_deliveries','admin_step_up_grants','risk_flags','admin_sessions','user_roles')));
create function pg_temp.cash_shift_observation_json(p jsonb)returns jsonb language plpgsql as $$
declare k text;v jsonb;r jsonb;begin
 if jsonb_typeof(p)='object'then r:='{}';for k,v in select * from jsonb_each(p)loop r:=r||jsonb_build_object(k,pg_temp.cash_shift_observation_json(v));end loop;return r;
 elsif jsonb_typeof(p)='array'then select coalesce(jsonb_agg(pg_temp.cash_shift_observation_json(value)),'[]')into r from jsonb_array_elements(p);return r;
 elsif jsonb_typeof(p)='string'and(p#>>'{}')~'^202[0-9]-[0-9]{2}-[0-9]{2}T'then return to_jsonb((p#>>'{}')::timestamptz-interval '3 days');end if;return p;end;$$;
create function pg_temp.cash_cohere_observation_history()returns void language plpgsql security definer set search_path=pg_catalog as $$
declare guard_row record;f jsonb;notice_row app_private.domain_notification_originals%rowtype;
begin
 if current_user<>'postgres'or current_setting('role',true)<>'service_role'then raise exception 'OWNER_ONLY_SYNTHETIC_HISTORY';end if;
 for guard_row in select * from pg_temp.cash_history_guards loop execute format('alter table %I.%I disable trigger %I',guard_row.nspname,guard_row.relname,guard_row.tgname);end loop;
 update app_private.funded_mining_mission_epoch set introduced_at=introduced_at-interval '4 days';
 update app_private.funding_earned_receipts set recorded_at=recorded_at-interval '3 days',fence_expires_at=fence_expires_at-interval '3 days'where id=(select earned from pg_temp.mature_ctx);
 update public.system_jobs set started_at=started_at-interval '3 days',lease_expires_at=lease_expires_at-interval '3 days',completed_at=completed_at-interval '3 days',created_at=created_at-interval '3 days',updated_at=updated_at-interval '3 days'where id=(select job from pg_temp.mature_ctx);
 update public.system_job_attempts set completed_at=completed_at-interval '3 days',started_at=started_at-interval '3 days'where job_id=(select job from pg_temp.mature_ctx);
 update app_private.funding_earned_receipts e set input_digest=app_private.funding_engine_digest(app_private.funding_earned_snapshot(e))where id=(select earned from pg_temp.mature_ctx);
 update public.audit_logs a set after_state=app_private.funding_earned_snapshot(e),metadata=a.metadata||jsonb_build_object('input_digest',e.input_digest),created_at=created_at-interval '3 days'
 from app_private.funding_earned_receipts e where a.id=e.audit_id;
 update public.outbox_events b set payload=jsonb_build_object('user_id',e.user_id,'audit_id',e.audit_id,'input_digest',e.input_digest),created_at=b.created_at-interval '3 days'
 from app_private.funding_earned_receipts e where b.id=e.source_event_id;
 update app_private.funded_mining_mission_originals m set observed_at=e.recorded_at,snapshot=app_private.funded_mining_mission_snapshot(m.source_type,e)
 from app_private.funding_earned_receipts e where e.id=m.earned_receipt_id;
 update app_private.funded_mining_mission_originals set digest=app_private.funding_engine_digest(snapshot);
 update public.outbox_events b set created_at=m.observed_at,payload=jsonb_build_object('user_id',m.user_id,'original_id',m.id,'earned_receipt_id',m.earned_receipt_id,'settlement_id',m.settlement_id,'digest',m.digest)
 from app_private.funded_mining_mission_originals m where b.id=m.outbox_id;
 update auth.users set created_at=created_at-interval '3 days',updated_at=updated_at-interval '3 days'where id=(select admin_id from pg_temp.mature_ctx);
 update auth.sessions set created_at=created_at-interval '3 days',updated_at=updated_at-interval '3 days',not_after=not_after-interval '3 days';
 update auth.mfa_factors set created_at=created_at-interval '3 days',updated_at=updated_at-interval '3 days';
 update auth.mfa_amr_claims set created_at=created_at-interval '3 days',updated_at=updated_at-interval '3 days';
 update public.admin_sessions set created_at=created_at-interval '3 days',last_seen_at=last_seen_at-interval '3 days',idle_expires_at=idle_expires_at-interval '3 days',absolute_expires_at=absolute_expires_at-interval '3 days';
 update public.user_roles set granted_at=granted_at-interval '3 days';
 update public.risk_flags set created_at=created_at-interval '3 days',resolved_at=resolved_at-interval '3 days';
 update public.kyc_cases set opened_at=opened_at-interval '3 days',decided_at=decided_at-interval '3 days';
 update public.kyc_status_history set created_at=created_at-interval '3 days';
 update public.referral_program_versions set created_at=created_at-interval '3 days';
 update app_private.local_cash_policies set created_at=created_at-interval '3 days';
 update app_private.local_cash_policies p set snapshot=jsonb_set(jsonb_set(snapshot,'{policy}',to_jsonb(p)-array['snapshot','digest']),'{program}',(select to_jsonb(r)from public.referral_program_versions r where r.id=p.referral_program_id));
 update app_private.local_cash_policies set digest=app_private.funding_engine_digest(snapshot);
 update app_private.local_cash_budget_tranches set starts_at=starts_at-interval '3 days',ends_at=ends_at-interval '3 days';
 update app_private.local_cash_budget_tranches t set snapshot=jsonb_set(snapshot,'{tranche}',to_jsonb(t)-array['snapshot','digest']);
 update app_private.local_cash_budget_tranches set digest=app_private.funding_engine_digest(snapshot);
 update public.audit_logs a set after_state=p.snapshot from app_private.local_cash_policies p where a.id=p.approval_audit_id;
 update public.audit_logs a set after_state=t.snapshot from app_private.local_cash_budget_tranches t where a.id=t.approval_audit_id;
 update public.audit_logs set created_at=created_at-interval '3 days'where target_type='LOCAL_QA_CASH';
 update public.admin_step_up_grants g set issued_at=issued_at-interval '3 days',expires_at=expires_at-interval '3 days',consumed_at=consumed_at-interval '3 days'
 where id in(select step_up_grant_id from app_private.local_cash_approval_originals);
 update app_private.local_cash_approval_originals o set captured_at=captured_at-interval '3 days',
 source_snapshot=jsonb_set(jsonb_set(source_snapshot,'{audit}',to_jsonb(a)),'{grant}',to_jsonb(g))from public.audit_logs a,public.admin_step_up_grants g where a.id=o.audit_id and g.id=o.step_up_grant_id;
 update app_private.local_cash_approval_originals set digest=app_private.funding_engine_digest(source_snapshot);
 update app_private.local_cash_pending set created_at=created_at-interval '3 days';
 update app_private.local_cash_originals set effective_at=effective_at-interval '3 days',risk_snapshot=pg_temp.cash_shift_observation_json(risk_snapshot);
 update app_private.local_cash_referral_obligations set committed_at=committed_at-interval '3 days';
 update app_private.local_cash_review_originals set available_at=available_at-interval '3 days';
 update app_private.local_cash_review_originals r set snapshot=to_jsonb(r)-array['snapshot','digest'];
 update app_private.local_cash_review_originals set digest=app_private.funding_engine_digest(snapshot);
 update public.outbox_events b set payload=jsonb_build_object('review_original_id',r.event_id,'digest',r.digest),created_at=b.created_at-interval '3 days',occurred_at=b.occurred_at-interval '3 days'
 from app_private.local_cash_review_originals r where b.id=r.event_id;
 update app_private.local_cash_originals c set snapshot=app_private.local_cash_snapshot(c);
 update app_private.local_cash_originals set digest=app_private.funding_engine_digest(snapshot);
 update public.referral_qualifications q set evidence=c.snapshot,decided_at=c.effective_at from app_private.local_cash_originals c join public.referral_reward_claims rc on rc.id=c.claim_id where q.id=rc.qualification_id;
 update public.referral_reward_claims rc set paid_at=c.effective_at from app_private.local_cash_originals c where c.claim_id=rc.id;
 update public.ledger_transactions j set posted_at=c.effective_at,metadata=jsonb_build_object('cash_original_id',c.id,'digest',c.digest,'scope','LOCAL_QA')from app_private.local_cash_originals c where c.ledger_transaction_id=j.id;
 update public.wallet_ledger w set created_at=c.effective_at from app_private.local_cash_originals c where c.wallet_ledger_id=w.id;
 update public.money_source_movements mv set effective_at=c.effective_at from app_private.local_cash_originals c where c.source_event_id=mv.source_event_id;
 update public.audit_logs a set after_state=c.snapshot,created_at=c.effective_at,metadata=jsonb_build_object('scope','LOCAL_QA','original_digest',c.digest)from app_private.local_cash_originals c where a.id=c.audit_id;
 update public.outbox_events b set occurred_at=c.effective_at,created_at=c.effective_at,payload=jsonb_set(b.payload,'{digest}',to_jsonb(c.digest))from app_private.local_cash_originals c where b.id=c.source_event_id;
 for notice_row in select * from app_private.domain_notification_originals loop
 f:=app_private.read_domain_notification_original(notice_row.source_event_id);
 update public.notifications set scheduled_at=scheduled_at-interval '3 days',created_at=created_at-interval '3 days'where id=notice_row.notification_id;
 update public.notification_deliveries set sent_at=sent_at-interval '3 days',created_at=created_at-interval '3 days'where id=notice_row.delivery_id;
 with rebound as(select d.source_event_id,f->>'source_digest' as source_digest,d.created_at-interval '3 days'as created_at,
 d.snapshot||jsonb_build_object('source_digest',f->>'source_digest','created_at',d.created_at-interval '3 days',
 'notification',(select to_jsonb(n)-'read_at'from public.notifications n where n.id=d.notification_id),
 'in_app_delivery',(select to_jsonb(nd)from public.notification_deliveries nd where nd.id=d.delivery_id))as snapshot
 from app_private.domain_notification_originals d where d.source_event_id=notice_row.source_event_id)
 update app_private.domain_notification_originals d set source_digest=r.source_digest,created_at=r.created_at,snapshot=r.snapshot,
 digest=app_private.funding_engine_digest(r.snapshot)from rebound r where d.source_event_id=r.source_event_id;
 end loop;
 set constraints all immediate;set constraints all deferred;
 for guard_row in select * from pg_temp.cash_history_guards loop execute format('alter table %I.%I %s trigger %I',guard_row.nspname,guard_row.relname,
 case guard_row.tgenabled when 'O'then 'enable'when 'A'then 'enable always'when 'R'then 'enable replica'else 'disable'end,guard_row.tgname);end loop;
 perform app_private.assert_funded_mining_mission_original(id)from app_private.funded_mining_mission_originals;
 perform app_private.assert_local_cash_posting(id,true)from app_private.local_cash_originals;
 perform app_private.assert_domain_notification(source_event_id)from app_private.domain_notification_originals;
end;$$;
grant execute on function pg_temp.cash_cohere_observation_history()to service_role;
set local role service_role;
select lives_ok('select pg_temp.cash_cohere_observation_history()','controlled historical first payout restores all source, cash and notification seals');
reset role;
select ok(not exists(select 1 from cash_history_guards f join pg_namespace n on n.nspname=f.nspname join pg_class c on c.relnamespace=n.oid and c.relname=f.relname join pg_trigger t on t.tgrelid=c.oid and t.tgname=f.tgname where t.tgenabled<>f.tgenabled),'every original guard restored after controlled history preparation');
select ok((select effective_at<clock_timestamp()-interval '24 hours'from app_private.local_cash_originals),'controlled first payout is older than 24h, not a real elapsed-time observation');
set constraints all deferred;
set local role service_role;
update mature_ctx set job=app_private.prepare_default_funding_job(activation);
reset role;
update public.system_jobs set available_at=clock_timestamp()where id=(select job from mature_ctx);
set local role service_role;
select id from public.claim_system_jobs('cash-stage2-current-native',1,300);
select lives_ok($$select public.complete_system_job(job,'cash-stage2-current-native')from mature_ctx$$,'current native canonical writer produces a distinct second positive settlement');
select lives_ok('set constraints all immediate','current second-cycle native source seals all validate');set constraints all deferred;
reset role;
update cash_ctx set source=(select outbox_id from app_private.funded_mining_mission_originals where user_id=(select member_id from mature_ctx)and source_type='MINING_SETTLEMENT_COMPLETED.v1'order by effective_at desc limit 1);
update public.outbox_events set available_at='infinity'where id<>(select source from cash_ctx);
update public.outbox_events set available_at='-infinity'where id=(select source from cash_ctx);
set local role service_role;
select id from public.claim_outbox_events('cash-stage2-current-native',1,300);
select lives_ok($$select public.complete_outbox_event(source,'cash-stage2-current-native')from cash_ctx$$,'distinct eligible native settlement consumes original reserved stage2 obligation after tranche expiry');
select lives_ok('set constraints all immediate','both referral stages retain exact financial source integrity');set constraints all deferred;
reset role;
select is((select sum(amount_atomic)from app_private.local_cash_originals),10000::numeric,'two actual source-backed stages pay referrer exactly maximum 10000');
select is((select count(*)from app_private.local_cash_originals),2::bigint,'stage2 creates exactly one additional native cash original');
select is((select sum(amount_atomic)from app_private.local_cash_budget_allocations),10000::numeric,'stage2 uses previously funded obligation without new budget');
select is((select count(*)from app_private.local_cash_budget_allocations where obligation_id is not null),1::bigint,'exact original reserved obligation is consumed once');
select ok((select bool_and(ends_at<clock_timestamp())from app_private.local_cash_budget_tranches),'expired recruitment funding still honors its already reserved second-stage benefit');
select * from finish();rollback;
