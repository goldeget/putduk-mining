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
-- Claim only this rollback fixture's newly sealed sources through the real lease RPC.
insert into app_private.nonmoney_executor_configuration(singleton,local_qa_enabled,project_identity)values(true,true,'putduk-mining-local-recovery-20261009-fi');
update public.outbox_events set available_at='infinity' where id not in(select outbox_id from local_mining_sources);
set local role service_role;
select is((select count(*) from public.claim_outbox_events('mining-original-native',2,300)),2::bigint,'actual worker claims both originals with durable leases');
select lives_ok($proof$select public.complete_outbox_event(outbox_id,'mining-original-native') from local_mining_sources$proof$,'closed canonical consumer validates both actual mining originals');
select lives_ok($proof$set constraints all immediate$proof$,'new source and worker effects pass deferred native integrity');
reset role;
select is((select count(*) from public.member_event_awards where user_id=(select member_id from mature_ctx)),0::bigint,'source alone creates no award without current approved policy and valid join');
select is((select count(*) from public.outbox_events where id in(select outbox_id from local_mining_sources) and status='PROCESSED'),2::bigint,'two source receipts complete through the canonical worker command');
select * from finish();
rollback;
