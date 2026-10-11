begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local time zone 'UTC';
-- Regression scope: real canonical terminal writer and rollover on controlled
-- relative history; fixed Spring/Fall dates below exercise the actual window
-- INSERT guard. Synthetic history is rollback-only, never live maturity proof.
-- Full financial-source dates remain relative to the server clock. On the
-- 2026-10-11 audit, its next NY cycle crosses the November DST boundary.

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
set local time zone 'America/New_York';
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
select ok((select not s.cycle_closed and s.cursor_at=old.cycle_end and c.cycle_started_at=old.cycle_end and c.cycle_end=old.cycle_end+30*interval '24 hours'
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
select ok((select s.base_used_num=0 and s.retention_used_num=0 and s.carry_num=(e.calculation->>'carryNum')::numeric and s.carry_den=(e.calculation->>'carryDen')::numeric
 from app_private.funding_engine_state s join app_private.funding_earned_receipts e on e.id=(select earned from mature_ctx)
 where s.user_id=(select member_id from mature_ctx)), 'new cycle resets used capacities and preserves only exact carry');

-- Direct invocation must recover the original next state in every timezone.
select is((select app_private.open_next_funding_cycle(earned) from mature_ctx),
 (select id from app_private.funding_engine_state where user_id=(select member_id from mature_ctx)),
 'NY direct rollover retry returns the existing source-bound next state');
set local time zone 'UTC';
select is((select app_private.open_next_funding_cycle(earned) from mature_ctx),
 (select id from app_private.funding_engine_state where user_id=(select member_id from mature_ctx)),
 'UTC direct rollover retry returns the same next state');
set local time zone 'Asia/Seoul';
select is((select app_private.open_next_funding_cycle(earned) from mature_ctx),
 (select id from app_private.funding_engine_state where user_id=(select member_id from mature_ctx)),
 'KST direct rollover retry returns the same next state');
select is((select count(*) from app_private.funding_cycle_rollovers where user_id=(select member_id from mature_ctx)),1::bigint,
 'timezone replay does not create a second rollover receipt');
select is((select count(*) from app_private.funding_cycle_windows where user_id=(select member_id from mature_ctx)),2::bigint,
 'timezone replay preserves exactly the original and following windows');
select is((select count(*) from public.mining_reward_credits),(select credits_before+1 from mature_ctx),
 'timezone replay does not create another verified wallet credit');
select is((select extract(epoch from c.cycle_end-c.cycle_started_at)::bigint
 from app_private.funding_engine_state s join app_private.funding_cycle_windows c on c.id=s.cycle_id
 where s.user_id=(select member_id from mature_ctx)),2592000::bigint,
 'actual generated next cycle lasts exactly 720 hours');
select lives_ok($$set constraints all immediate$$,
 'cross-timezone replay still satisfies deferred original and balanced-ledger guards');
reset role;

-- Static definition regression is separate from the actual NY writer above.
-- A clock-relative financial fixture may stop crossing DST in another month.
-- Keep the final installed rollover arithmetic fixed even on such test dates;
-- this assertion does not claim a fixed-date financial writer was exercised.
select ok(
 lower(pg_get_functiondef('app_private.open_next_funding_cycle(uuid)'::regprocedure))
  ~ '30[[:space:]]*\*[[:space:]]*interval[[:space:]]+''24 hours'''
 and lower(pg_get_functiondef('app_private.open_next_funding_cycle(uuid)'::regprocedure))
  !~ 'interval[[:space:]]+''30 days''',
 'installed rollover uses fixed 24-hour multiplication (static definition regression)');

-- Calendar days intentionally differ from fixed hours in the two deterministic
-- NY vectors. These INSERTs invoke the installed production window guard with
-- new synthetic FK subjects and all guards enabled; no sealed sources mutate.
create temporary table rollover_dst_vectors(
 user_id uuid, zone text, starts_at timestamptz, expected_calendar_seconds bigint);
insert into rollover_dst_vectors values
 ('10639100-0000-4000-8000-000000000001','America/New_York','2026-03-01 00:00:00-05',2588400),
 ('10639100-0000-4000-8000-000000000002','America/New_York','2026-10-15 00:00:00-04',2595600),
 ('10639100-0000-4000-8000-000000000003','UTC','2026-03-01 00:00:00+00',2592000),
 ('10639100-0000-4000-8000-000000000004','Asia/Seoul','2026-03-01 00:00:00+09',2592000);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select user_id,'authenticated','authenticated',user_id::text||'@rollover-dst.putduk.test','',
 statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp(),'','','',''
from rollover_dst_vectors;
grant select on rollover_dst_vectors to service_role;
create function pg_temp.check_rollover_fixed_window(p_user uuid,p_zone text,p_start timestamptz,p_calendar_seconds bigint)
returns setof text language plpgsql security invoker set search_path=pg_catalog,extensions as $regression$
begin
 perform set_config('TimeZone',p_zone,true);
 return next extensions.is(extract(epoch from (p_start+interval '30 days')-p_start)::bigint,
  p_calendar_seconds,p_zone||' fixed date proves calendar interval behavior');
 return next extensions.is(extract(epoch from (p_start+30*interval '24 hours')-p_start)::bigint,
  2592000::bigint,p_zone||' fixed date measures exactly 720 hours');
 if p_calendar_seconds<>2592000 then
  return next extensions.throws_ok(format(
   'insert into app_private.funding_cycle_windows(user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end) values(%L,0,30,%L,%L)',
   p_user,p_start,p_start+interval '30 days'),
   '22023','FUNDING_CYCLE_DURATION_INVALID',p_zone||' actual window guard rejects calendar-length DST drift');
 end if;
 return next extensions.lives_ok(format(
  'insert into app_private.funding_cycle_windows(user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end) values(%L,0,30,%L,%L)',
  p_user,p_start,p_start+30*interval '24 hours'),p_zone||' actual installed window guard accepts fixed 720 hours');
 return next extensions.is((select extract(epoch from cycle_end-cycle_started_at)::bigint
  from app_private.funding_cycle_windows where user_id=p_user),2592000::bigint,
  p_zone||' actual stored boundary has fixed duration');

end;
$regression$;
grant execute on function pg_temp.check_rollover_fixed_window(uuid,text,timestamptz,bigint) to service_role;
set local role service_role;
select pg_temp.check_rollover_fixed_window(user_id,zone,starts_at,expected_calendar_seconds)
from rollover_dst_vectors order by user_id;
reset role;
set local time zone 'UTC';
select * from finish();
rollback;
