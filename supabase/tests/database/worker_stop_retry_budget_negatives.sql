begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
-- Owner-only, rollback-only controlled historical fixture. This is neither
-- imported Cloud data nor evidence of thirty days of production operation.
-- Preparation temporarily permits UPDATE of this test member's originals;
-- all installed triggers are restored before the actual canonical writer.
create temporary table mature_ctx(member_id uuid,admin_id uuid,job uuid,earned uuid,activation uuid,
 state uuid,shift interval,credits_before bigint);
insert into mature_ctx values('10639000-0000-4000-8000-000000000001',
 '10639000-0000-4000-8000-000000000002',null,null,null,null,interval '31 days',null);
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
   v:=to_jsonb(((v#>>'{}')::bigint-2678400000000)::text);
  else v:=pg_temp.shift_controlled_input(v);end if;
  r:=r||jsonb_build_object(k,v);end loop;
  if r ? 'principal_original_digest' and r ? 'credit_originals' then
   r:=r||jsonb_build_object('principal_original_digest',app_private.funding_engine_digest(r->'credit_originals'));end if;
  return r;
 elsif jsonb_typeof(p)='array' then select coalesce(jsonb_agg(pg_temp.shift_controlled_input(value)),'[]') into r from jsonb_array_elements(p);return r;
 end if;return p;end$$;
update app_private.funding_engine_epochs set introduced_at=introduced_at-interval '32 days' where version=1;
update public.money_source_movements set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update public.ledger_transactions set posted_at=posted_at-interval '31 days' where member_user_id=(select member_id from mature_ctx);
update public.funding_principal_lots set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update public.funding_principal_revisions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_cycle_windows set cycle_started_at=cycle_started_at-interval '31 days',cycle_end=cycle_end-interval '31 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_clock_receipts set effective_at=effective_at-interval '31 days',resumed_at=resumed_at-interval '31 days'
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set effective_at=effective_at-interval '31 days',
 input_original=pg_temp.shift_controlled_input(input_original) where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_activations set input_digest=app_private.funding_engine_digest(input_original)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals set effective_at=effective_at-interval '31 days',inputs=pg_temp.shift_controlled_input(inputs)
 where user_id=(select member_id from mature_ctx);
update app_private.funding_condition_originals c set input_digest=app_private.funding_engine_digest(app_private.funding_condition_snapshot(c))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_portion_transitions t set input_digest=app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(t))
 where user_id=(select member_id from mature_ctx);
update app_private.funding_engine_state_receipts set cursor_at=cursor_at-interval '31 days' where user_id=(select member_id from mature_ctx);
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

select public.schedule_due_funding_jobs(25,null);
update mature_ctx set job=(select f.job_id from app_private.funding_engine_jobs f
 join app_private.funding_engine_state s on s.id=f.expected_state_id where s.user_id=mature_ctx.member_id);
select is((select max_attempts from public.system_jobs where id=(select job from mature_ctx)),12,'canonical immutable retry cap is retained');
select id from public.claim_system_jobs('ordinary-1',1,120);
select public.fail_system_job(job,'ordinary-1','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-2',1,120);
select public.fail_system_job(job,'ordinary-2','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-3',1,120);
select public.fail_system_job(job,'ordinary-3','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-4',1,120);
select public.fail_system_job(job,'ordinary-4','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-5',1,120);
select public.fail_system_job(job,'ordinary-5','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-6',1,120);
select public.fail_system_job(job,'ordinary-6','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-7',1,120);
select public.fail_system_job(job,'ordinary-7','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-8',1,120);
select public.fail_system_job(job,'ordinary-8','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-9',1,120);
select public.fail_system_job(job,'ordinary-9','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-10',1,120);
select public.fail_system_job(job,'ordinary-10','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select id from public.claim_system_jobs('ordinary-11',1,120);
select public.fail_system_job(job,'ordinary-11','LOCAL_SYNTHETIC_RETRY','RETRYABLE',0) from mature_ctx;
select is((select app_private.worker_chargeable_attempts(job,11) from mature_ctx),11::bigint,'actual ordinary retries consume canonical budget without changing the sealed job');
select id from public.claim_system_jobs('forged-stop-error',1,120);
select throws_ok($$update public.system_job_attempts set started_at=started_at-interval '1 day'
 where job_id=(select job from mature_ctx)$$,'55000','WORKER_ATTEMPT_ORIGINAL_IMMUTABLE',
 'raw service cannot backdate the sealed funding attempt');
select throws_ok($$update public.system_job_attempts set status='RETRYABLE_FAILED',error_code='SAFE_MODE_ACTIVE',
 error_class='SAFE_MODE_DEFERRED',completed_at=clock_timestamp() where job_id=(select job from mature_ctx)$$,
 '55000','WORKER_CANONICAL_PAUSE_FENCE_REQUIRED','raw labels cannot fabricate a canonical pause exemption');
select ok(not has_table_privilege('service_role','app_private.worker_attempt_start_originals','INSERT')
 and not has_table_privilege('service_role','app_private.worker_pause_exemptions','INSERT')
 and not has_function_privilege('service_role','app_private.seal_worker_pause_attempt()','execute'),
 'private attempt authority has no raw service writer or callable definer');
select ok(not app_private.worker_funding_pause_observed((select started_at from public.system_job_attempts where job_id=(select job from mature_ctx) and status='RUNNING')),
 'absence of a genuine current or canonical historical pause cannot exempt retry');
-- Historical inert audit deliberately lacks command_version, idempotency seal
-- and source outbox. All canonical audit triggers remain enabled.
insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata)
select admin_id,'ADMIN','SAFE_MODE_ENABLED','SAFE_MODE','NEW_MINING','Synthetic legacy audit cannot waive retry budget',gen_random_uuid(),
 jsonb_build_object('id',gen_random_uuid(),'is_paused',true,'starts_at',clock_timestamp(),'request_id',gen_random_uuid()),
 jsonb_build_object('idempotency_key','unbound-legacy-pause','request_hash',repeat('a',64)) from mature_ctx;
select ok(not app_private.worker_funding_pause_observed((select started_at from public.system_job_attempts where job_id=(select job from mature_ctx) and status='RUNNING')),
 'unbound inert audit without original idempotency and source seal cannot exempt retry');
select is((select public.fail_system_job(job,'forged-stop-error','SAFE_MODE_ACTIVE','RETRYABLE',0)::text from mature_ctx),
 'DEAD_LETTER','forged SAFE_MODE_ACTIVE consumes the actual canonical retry budget');
select is((select error_class from public.system_job_attempts where job_id=(select job from mature_ctx) and attempt_number=12),
 'RETRYABLE','forged error cannot acquire DB-only deferred class');
select throws_ok($$update public.system_job_attempts set error_class='SAFE_MODE_DEFERRED'
 where job_id=(select job from mature_ctx)$$,'55000','WORKER_CANONICAL_PAUSE_FENCE_REQUIRED',
 'completed ordinary failure cannot be relabeled into an exemption');
select is((select app_private.worker_chargeable_attempts(job,12) from mature_ctx),12::bigint,
 'charge counter reads sealed exemptions and still charges the actual failed attempt');
select is((select count(*) from public.claim_system_jobs('no-forged-retry',1,120)),0::bigint,'false pause reason cannot regain admission');
select is((select count(*) from public.mining_reward_credits),0::bigint,'forged error test creates no reward');
select * from finish();rollback;
