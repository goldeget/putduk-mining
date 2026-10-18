begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Owner-only, rollback-only controlled historical fixture. This is neither
-- imported Cloud data nor evidence of thirty days of production operation.
-- Preparation temporarily permits UPDATE of this test member's originals;
-- all installed triggers are restored before the actual canonical writer.
create temporary table held_ctx(member_id uuid,admin_id uuid,job uuid,earned uuid,activation uuid,
 state uuid,shift interval,credits_before bigint);
insert into held_ctx values('10639100-0000-4000-8000-000000000001',
 '10639100-0000-4000-8000-000000000002',null,null,null,null,interval '31 days',null);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select person,'authenticated','authenticated',person::text||'@mature-controlled.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from held_ctx cross join lateral unnest(array[member_id,admin_id]) person;
insert into public.user_roles(user_id,role,granted_by) select admin_id,'ADMIN',admin_id from held_ctx;
select public.bootstrap_user(member_id) from held_ctx;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select,update on held_ctx to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.approve_deposit_request(public.create_deposit_request(member_id,'KRW',200000,'controlled-held-deposit'),
 admin_id,200000,'controlled-held-credit','Synthetic local historical fixture source only',gen_random_uuid()) from held_ctx;
set constraints all immediate;
set constraints all deferred;
reset role;
create temporary table held_request_ctx(policy_id uuid,bank_id uuid,logical jsonb,withdrawal uuid);
insert into public.withdrawal_policies(currency,destination_type,version,is_enabled,minimum_amount_atomic,
 fee_atomic,destination_config,effective_at,approved_by,allows_welcome_reward)
select 'KRW','KRW_BANK',10639101,true,1,0,'{}',clock_timestamp(),admin_id,false from held_ctx;
insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,
 display_hint,verification_status,verified_at,protection_until)
select member_id,'KRW_BANK',decode(repeat('ae',32),'hex'),encode(extensions.digest(member_id::text,'sha256'),'hex'),
 'Owner-only synthetic verified destination', 'VERIFIED',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day' from held_ctx;
insert into held_request_ctx(policy_id,bank_id) select p.id,d.id from public.withdrawal_policies p
 cross join public.withdrawal_destinations d where p.version=10639101 and d.user_id=(select member_id from held_ctx);
grant select,update on held_request_ctx to service_role,authenticated;
grant select on held_ctx to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',member_id)::text,true) from held_ctx;
set local role authenticated;
update held_request_ctx set logical=public.prepare_withdrawal_logical_request((select member_id from held_ctx),
 'KRW_BANK',30000,policy_id,10639101,null,bank_id,'{"version":1,"source":"PRINCIPAL","confirmed":true}');
set constraints all immediate;set constraints all deferred;reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
update held_request_ctx set withdrawal=public.hold_withdrawal_logical_request((select member_id from held_ctx),
 logical->>'key','KRW_BANK',bank_id,30000);
set constraints all immediate;set constraints all deferred;reset role;
update held_ctx set activation=(select id from app_private.funding_engine_activations where user_id=member_id),
 state=(select id from app_private.funding_engine_state where user_id=member_id);
create temporary table mature_fixture_triggers as
select n.nspname,c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and
 ((n.nspname='app_private' and c.relname in('funding_engine_epochs','funding_engine_activations',
 'funding_condition_originals','funding_engine_state_receipts','funding_principal_boundary_preparations','funding_principal_boundary_completions','funding_withdrawal_clock_admissions','funding_principal_recovery_intent_originals','economy_policy_receipts','economy_policy_publications','funding_portion_transitions',
 'funding_portion_clock_receipts','funding_cycle_windows','funding_earned_receipts'))
 or(n.nspname='public' and c.relname in('money_source_movements','ledger_transactions','funding_principal_lots','funding_principal_revisions','funding_principal_recovery_allocations','withdrawal_requests','audit_logs','outbox_events')));
do $$declare t record;begin
 if current_user<>'postgres' then raise exception 'OWNER_ONLY_SYNTHETIC_HISTORY';end if;
 for t in select * from mature_fixture_triggers loop
 execute format('alter table %I.%I disable trigger %I',t.nspname,t.relname,t.tgname);end loop;
end$$;
create function pg_temp.shift_controlled_input(p jsonb) returns jsonb language plpgsql as $$
declare k text;v jsonb;r jsonb;begin
 if jsonb_typeof(p)='object' then
 r:='{}';for k,v in select * from jsonb_each(p) loop
  if k='policy_effective_from_microseconds' and v#>>'{}' ~ '^[0-9]+$' then v:=to_jsonb(((v#>>'{}')::bigint-2764800000000)::text);
   elsif k in('first_credit_at_microseconds','credit_at_microseconds','effective_at_microseconds','clock_at_microseconds','resumed_at_microseconds') and v#>>'{}' ~ '^[0-9]+$' then
   v:=to_jsonb(((v#>>'{}')::bigint-2678400000000)::text);
  else v:=pg_temp.shift_controlled_input(v);end if;
  r:=r||jsonb_build_object(k,v);end loop;
  if r ? 'principal_original_digest' and r ? 'credit_originals' then
   r:=r||jsonb_build_object('principal_original_digest',app_private.funding_engine_digest(r->'credit_originals'));end if;
  if r ? 'recovery_original_digest' and r ? 'recovery_originals' then
 r:=jsonb_set(r,'{recovery_original_digest}',to_jsonb(app_private.funding_engine_digest(r->'recovery_originals')));end if;
 if r ? 'portion_clock_original_digest' and r ? 'portion_clock_originals' then
 r:=jsonb_set(r,'{portion_clock_original_digest}',to_jsonb(app_private.funding_engine_digest(r->'portion_clock_originals')));end if;
 return r;
 elsif jsonb_typeof(p)='array' then select coalesce(jsonb_agg(pg_temp.shift_controlled_input(value)),'[]') into r from jsonb_array_elements(p);return r;
 end if;return p;end$$;
update app_private.funding_engine_epochs set introduced_at=introduced_at-interval '32 days' where version=1;
update public.money_source_movements set effective_at=effective_at-interval '31 days' where user_id=(select member_id from held_ctx);
update public.ledger_transactions set posted_at=posted_at-interval '31 days' where member_user_id=(select member_id from held_ctx);
update public.funding_principal_lots set effective_at=effective_at-interval '31 days' where user_id=(select member_id from held_ctx);
update public.funding_principal_recovery_allocations set effective_at=effective_at-interval '31 days' where user_id=(select member_id from held_ctx);
-- The identical owner-approved seed policy is time-positioned before this synthetic
-- history inside this rollback-only fixture; config, tiers and amounts never change.
update app_private.economy_policy_publications set effective_from=effective_from-interval '32 days',published_at=published_at-interval '32 days'
 where id in(select (inputs->>'policy_publication_id')::uuid from app_private.funding_condition_originals where user_id=(select member_id from held_ctx));
update app_private.economy_policy_receipts set effective_from=effective_from-interval '32 days' where policy_id in(
 select policy_id from app_private.economy_policy_publications where id in(select (inputs->>'policy_publication_id')::uuid from app_private.funding_condition_originals where user_id=(select member_id from held_ctx)));
update public.audit_logs a set after_state=jsonb_set(after_state,'{effectiveFrom}',coalesce(to_jsonb(r.effective_from),'null'::jsonb))
 ||case when r.state='PUBLISHED' then jsonb_build_object('publishedAt',(select published_at from app_private.economy_policy_publications where receipt_id=r.id)) else '{}'::jsonb end
 from app_private.economy_policy_receipts r where r.audit_id=a.id and r.policy_id in(select policy_id from app_private.economy_policy_publications
 where id in(select (inputs->>'policy_publication_id')::uuid from app_private.funding_condition_originals where user_id=(select member_id from held_ctx)));
update public.withdrawal_requests set hold_posted_at=hold_posted_at-interval '31 days' where user_id=(select member_id from held_ctx);
update app_private.funding_earned_receipts set settled_from=settled_from-interval '31 days',settled_to=settled_to-interval '31 days' where user_id=(select member_id from held_ctx);
update app_private.funding_earned_receipts e set input_digest=app_private.funding_engine_digest(app_private.funding_earned_snapshot(e)) where user_id=(select member_id from held_ctx);
update public.ledger_transactions set created_at=created_at-interval '31 days',metadata=jsonb_set(metadata,'{admitted_at_microseconds}',to_jsonb(((metadata->>'admitted_at_microseconds')::bigint-2678400000000)::text))
 where member_user_id=(select member_id from held_ctx) and metadata ? 'admitted_at_microseconds';
update app_private.funding_withdrawal_clock_admissions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from held_ctx);
update app_private.funding_withdrawal_clock_admissions a set input_digest=app_private.funding_engine_digest(app_private.funding_withdrawal_clock_snapshot(a)) where user_id=(select member_id from held_ctx);
update app_private.funding_principal_boundary_preparations set effective_at=effective_at-interval '31 days',recorded_at=recorded_at-interval '31 days',old_input_original=pg_temp.shift_controlled_input(old_input_original)
 where user_id=(select member_id from held_ctx);
update app_private.funding_principal_boundary_preparations b set input_digest=app_private.funding_engine_digest(app_private.funding_principal_preparation_snapshot(b)) where user_id=(select member_id from held_ctx);
update app_private.funding_principal_boundary_completions set effective_at=effective_at-interval '31 days',recorded_at=recorded_at-interval '31 days',input_original=pg_temp.shift_controlled_input(input_original)
 where user_id=(select member_id from held_ctx);
update app_private.funding_principal_boundary_completions b set input_digest=app_private.funding_engine_digest(app_private.funding_principal_completion_snapshot(b)) where user_id=(select member_id from held_ctx);
update app_private.funding_principal_recovery_intent_originals set prepared_at=prepared_at-interval '31 days',source_inputs=pg_temp.shift_controlled_input(source_inputs),
 engine_epoch_at=(select introduced_at from app_private.funding_engine_epochs where version=1) where user_id=(select member_id from held_ctx);
update app_private.funding_principal_recovery_intent_originals i set input_digest=app_private.funding_engine_digest(app_private.funding_principal_recovery_intent_snapshot(i)) where user_id=(select member_id from held_ctx);
update public.audit_logs set created_at=created_at-interval '31 days' where id in(select audit_id from app_private.funding_principal_recovery_intent_originals where user_id=(select member_id from held_ctx));
update public.outbox_events set created_at=created_at-interval '31 days',occurred_at=occurred_at-interval '31 days' where id in(select source_event_id from app_private.funding_principal_recovery_intent_originals where user_id=(select member_id from held_ctx));
update public.audit_logs set created_at=created_at-interval '31 days' where id in(select audit_id from app_private.funding_withdrawal_clock_admissions where user_id=(select member_id from held_ctx));
update public.outbox_events set created_at=created_at-interval '31 days',occurred_at=occurred_at-interval '31 days' where id in(select source_event_id from app_private.funding_withdrawal_clock_admissions where user_id=(select member_id from held_ctx));
update public.funding_principal_revisions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from held_ctx);
update app_private.funding_cycle_windows set cycle_started_at=cycle_started_at-interval '31 days',cycle_end=cycle_end-interval '31 days'
 where user_id=(select member_id from held_ctx);
update app_private.funding_portion_clock_receipts set effective_at=effective_at-interval '31 days',resumed_at=resumed_at-interval '31 days'
 where user_id=(select member_id from held_ctx);
update app_private.funding_portion_transitions set effective_at=effective_at-interval '31 days' where user_id=(select member_id from held_ctx);
update app_private.funding_engine_activations set effective_at=effective_at-interval '31 days',
 input_original=pg_temp.shift_controlled_input(input_original) where user_id=(select member_id from held_ctx);
update app_private.funding_engine_activations set input_digest=app_private.funding_engine_digest(input_original)
 where user_id=(select member_id from held_ctx);
update app_private.funding_condition_originals set effective_at=effective_at-interval '31 days',inputs=pg_temp.shift_controlled_input(inputs)
 where user_id=(select member_id from held_ctx);
update app_private.funding_condition_originals c set input_digest=app_private.funding_engine_digest(app_private.funding_condition_snapshot(c))
 where user_id=(select member_id from held_ctx);
update app_private.funding_portion_transitions t set input_digest=app_private.funding_engine_digest(app_private.funding_portion_transition_snapshot(t))
 where user_id=(select member_id from held_ctx);
update app_private.funding_engine_state_receipts set cursor_at=cursor_at-interval '31 days' where user_id=(select member_id from held_ctx);
with originals as(
 select id,audit_id,source_event_id,input_digest,app_private.funding_activation_snapshot(a) snapshot from app_private.funding_engine_activations a where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_condition_snapshot(c) from app_private.funding_condition_originals c where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_principal_recovery_intent_snapshot(i) from app_private.funding_principal_recovery_intent_originals i where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_earned_snapshot(e) from app_private.funding_earned_receipts e where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_withdrawal_clock_snapshot(a) from app_private.funding_withdrawal_clock_admissions a where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_principal_preparation_snapshot(b) from app_private.funding_principal_boundary_preparations b where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_principal_completion_snapshot(b) from app_private.funding_principal_boundary_completions b where user_id=(select member_id from held_ctx)
 union all select id,audit_id,source_event_id,input_digest,app_private.funding_portion_transition_snapshot(t) from app_private.funding_portion_transitions t where user_id=(select member_id from held_ctx))
update public.audit_logs a set after_state=o.snapshot,metadata=a.metadata||jsonb_build_object('input_digest',o.input_digest,
 'fixture_provenance','OWNER_ONLY_CONTROLLED_HISTORY_ROLLBACK') from originals o where a.id=o.audit_id;
with originals as(
 select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_engine_activations where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_condition_originals where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_principal_recovery_intent_originals where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_earned_receipts where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_withdrawal_clock_admissions where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_principal_boundary_preparations where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_principal_boundary_completions where user_id=(select member_id from held_ctx)
 union all select id,source_event_id,input_digest,audit_id,user_id from app_private.funding_portion_transitions where user_id=(select member_id from held_ctx))
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
 join app_private.funding_cycle_windows c on c.id=s.cycle_id where s.user_id=(select member_id from held_ctx)$$,
 'controlled mature history passes source-seal and portion-clock reconstruction');
update held_ctx set job=app_private.prepare_default_funding_job(activation),credits_before=(select count(*) from public.mining_reward_credits);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from held_ctx);
set local role service_role;
select id from public.claim_system_jobs('controlled-held-worker',1,300);
reset role;
create function pg_temp.inject_rollover_fault() returns trigger language plpgsql as $$begin
 if new.user_id=(select member_id from held_ctx) then raise exception 'LOCAL_ROLLOVER_FAULT';end if;return new;end$$;
create trigger local_rollover_fault before insert on app_private.funding_cycle_rollovers for each row execute function pg_temp.inject_rollover_fault();
set local role service_role;
select throws_like($$select public.complete_system_job(job,'controlled-held-worker') from held_ctx$$,
 'LOCAL_ROLLOVER_FAULT','next-window fault rejects the entire canonical terminal transaction');
select is((select count(*) from public.mining_reward_credits),(select credits_before from held_ctx),
 'next-window fault rolls back the wallet credit rather than leaving a paid closed cycle');
select is((select count(*) from app_private.funding_earned_receipts where job_id=(select job from held_ctx)),0::bigint,
 'next-window fault rolls back the earned receipt');
reset role;
drop trigger local_rollover_fault on app_private.funding_cycle_rollovers;
set local role service_role;
select lives_ok($$select public.complete_system_job(job,'controlled-held-worker') from held_ctx$$,
 'actual installed canonical worker writer settles controlled thirty-day maturity');
update held_ctx set earned=(select id from app_private.funding_earned_receipts where job_id=job);
select is((select amount_atomic from app_private.funding_earned_receipts where id=(select earned from held_ctx)),25500::bigint,
 'terminal HELD 30000 is excluded while the AVAILABLE 170000 portion receives exactly 25500');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from held_ctx),
 'terminal retention creates one authoritative wallet-linked reward credit');
select ok((select cycle_closed from app_private.funding_engine_state_receipts where id=(select next_state_id from app_private.funding_earned_receipts where id=(select earned from held_ctx))),
 'terminal state closes at the exact original fixed cycle end');
select ok((select component_original is not null from app_private.funding_retention_qualifications where earned_receipt_id=(select earned from held_ctx)),
 'terminal payment stores exact source and eligible-time component evidence');
select lives_ok($$set constraints all immediate$$,'real service role deferred seals and balanced source invariants accept terminal payment');
set constraints all deferred;
select lives_ok($$select public.complete_system_job(job,'controlled-held-worker') from held_ctx$$,'response-loss retry replays terminal receipt');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from held_ctx),'terminal replay creates no second credit');
select ok((select not s.cycle_closed and s.cursor_at=old.cycle_end and c.cycle_started_at=old.cycle_end and c.cycle_end=old.cycle_end+interval '30 days'
 from app_private.funding_engine_state s join app_private.funding_cycle_windows c on c.id=s.cycle_id
 join app_private.funding_cycle_windows old on old.user_id=s.user_id and old.cycle_ordinal=0 where s.user_id=(select member_id from held_ctx)),
 'canonical terminal completion atomically opens the next fixed window with no gap');
select is((select count(*) from app_private.funding_cycle_rollovers where user_id=(select member_id from held_ctx)),1::bigint,
 'terminal retry does not repeat cycle rollover');
select throws_like($$update public.outbox_events set payload='{}' where id=(select source_event_id from app_private.funding_cycle_rollovers where user_id=(select member_id from held_ctx))$$,
 'FUNDING_ROLLOVER_ENVELOPE_IMMUTABLE','rollover source event payload cannot be rewritten by service');
select throws_like($$update public.audit_logs set metadata='{}' where id=(select audit_id from app_private.funding_cycle_rollovers where user_id=(select member_id from held_ctx))$$,
 'permission denied for table audit_logs','service has no UPDATE grant on the rollover audit original');
reset role;
select throws_like($$update public.audit_logs set metadata='{}' where id=(select audit_id from app_private.funding_cycle_rollovers where user_id=(select member_id from held_ctx))$$,
 '%append-only%','even the native owner cannot rewrite a sealed rollover audit with guards enabled');
set local role service_role;
select ok((select s.base_used_num=0 and s.retention_used_num=0 and s.carry_num=(e.calculation->>'carryNum')::numeric
 from app_private.funding_engine_state s join app_private.funding_earned_receipts e on e.id=(select earned from held_ctx)
 where s.user_id=(select member_id from held_ctx)), 'new cycle resets used capacities and preserves only exact carry');
select ok((select exists(select 1 from app_private.funding_portion_clock_state where user_id=member_id and status='HELD') from held_ctx),
 'terminal payment and rollover preserve HOLD rather than silently release principal');
update held_ctx set job=app_private.prepare_default_funding_job(activation);
reset role;
update public.system_jobs set available_at=clock_timestamp() where id=(select job from held_ctx);
set local role service_role;
select id from public.claim_system_jobs('controlled-held-worker-next',1,300);
select lives_ok($$select public.complete_system_job(job,'controlled-held-worker-next') from held_ctx$$,
 'canonical writer advances the next cycle with its actual current portion sources');
select is((select amount_atomic from app_private.funding_earned_receipts where job_id=(select job from held_ctx)),0::bigint,
 'next-cycle early tick does not catch up or repeat previous retention');
select lives_ok($$set constraints all immediate$$,'next-cycle earned state and carry chain pass native integrity');
reset role;
select * from finish();
rollback;
